#!/usr/bin/env python3
"""
Secret Rotation Module for Homelab Environment

This script automates the rotation of secrets stored in HashiCorp Vault including:
- Database credentials
- API keys
- TLS certificates

It validates new secrets before deployment, coordinates updates across dependent
services, logs all events, and sends alerts on failures.

Designed to be deployed as a Kubernetes CronJob.
"""

import os
import sys
import time
import logging
import json
import hvac
import datetime
import requests
import yaml
import base64
from typing import Dict, List, Any, Optional, Tuple
from kubernetes import client, config
from kubernetes.client.rest import ApiException
import smtplib
from email.mime.text import MIMEText

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/secret-rotation.log')
    ]
)
logger = logging.getLogger('secret-rotation')

# Secret rotation configuration
CONFIG_PATH = os.environ.get('CONFIG_PATH', '/etc/secret-rotation/config.yaml')
VAULT_ADDR = os.environ.get('VAULT_ADDR', 'http://vault.vault.svc.cluster.local:8200')
VAULT_ROLE = os.environ.get('VAULT_ROLE', 'secret-rotation')
ALERT_EMAILS = os.environ.get('ALERT_EMAILS', '').split(',')
SMTP_SERVER = os.environ.get('SMTP_SERVER', 'smtp.example.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USERNAME = os.environ.get('SMTP_USERNAME', '')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
ROTATION_HISTORY_PATH = '/var/lib/secret-rotation/history'

class SecretRotator:
    """Main class for handling secret rotation operations."""

    def __init__(self):
        """Initialize the secret rotator with Vault and Kubernetes clients."""
        self.vault_client = None
        self.kube_api = None
        self.config = self._load_config()
        self._setup_vault_client()
        self._setup_kubernetes_client()

        # Ensure history directory exists
        os.makedirs(ROTATION_HISTORY_PATH, exist_ok=True)

    def _load_config(self) -> dict:
        """Load rotation configuration from YAML file."""
        try:
            with open(CONFIG_PATH, 'r') as f:
                config = yaml.safe_load(f)
            logger.info(f"Loaded configuration from {CONFIG_PATH}")
            return config
        except Exception as e:
            logger.error(f"Failed to load config: {str(e)}")
            self._send_alert(f"Secret rotation configuration error",
                            f"Failed to load configuration: {str(e)}")
            sys.exit(1)

    def _setup_vault_client(self):
        """Set up and authenticate the Vault client using Kubernetes auth."""
        try:
            # Initialize Vault client
            self.vault_client = hvac.Client(url=VAULT_ADDR)

            # Get service account token for Vault authentication
            with open('/var/run/secrets/kubernetes.io/serviceaccount/token', 'r') as f:
                jwt = f.read()

            # Authenticate to Vault using Kubernetes auth method
            auth_resp = self.vault_client.auth.kubernetes.login(
                role=VAULT_ROLE,
                jwt=jwt
            )

            if not self.vault_client.is_authenticated():
                raise Exception("Vault authentication failed")

            logger.info("Successfully authenticated to Vault")

        except Exception as e:
            logger.error(f"Failed to set up Vault client: {str(e)}")
            self._send_alert("Secret rotation Vault authentication error",
                            f"Failed to authenticate to Vault: {str(e)}")
            sys.exit(1)

    def _setup_kubernetes_client(self):
        """Set up the Kubernetes client for in-cluster configuration."""
        try:
            config.load_incluster_config()
            self.kube_api = client.CoreV1Api()
            logger.info("Successfully set up Kubernetes client")
        except Exception as e:
            logger.error(f"Failed to set up Kubernetes client: {str(e)}")
            self._send_alert("Secret rotation Kubernetes client error",
                           f"Failed to set up Kubernetes client: {str(e)}")
            sys.exit(1)

    def run_rotation(self):
        """Run the entire secret rotation process."""
        logger.info("Starting secret rotation process")

        # Rotation timestamp
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

        # Track overall rotation status
        success_count = 0
        failure_count = 0
        rotation_summary = []

        # Process each secret type
        for secret_type in ['database', 'api_keys', 'certificates']:
            if secret_type in self.config:
                for secret in self.config[secret_type]:
                    try:
                        logger.info(f"Processing {secret_type} secret: {secret['name']}")
                        result = self._rotate_secret(secret_type, secret)
                        rotation_summary.append({
                            'name': secret['name'],
                            'type': secret_type,
                            'success': result['success'],
                            'message': result['message']
                        })

                        if result['success']:
                            success_count += 1
                        else:
                            failure_count += 1

                    except Exception as e:
                        error_msg = f"Error rotating {secret_type} secret {secret['name']}: {str(e)}"
                        logger.error(error_msg)
                        self._send_alert(f"Secret rotation error for {secret['name']}", error_msg)
                        rotation_summary.append({
                            'name': secret['name'],
                            'type': secret_type,
                            'success': False,
                            'message': str(e)
                        })
                        failure_count += 1

        # Log rotation summary
        self._log_rotation_history(timestamp, rotation_summary)

        # Send summary notification
        summary_msg = f"Secret rotation completed with {success_count} successes and {failure_count} failures"
        logger.info(summary_msg)

        if failure_count > 0:
            self._send_alert("Secret rotation summary - with failures",
                           f"{summary_msg}\n\nDetails:\n{json.dumps(rotation_summary, indent=2)}")

        return {
            'success_count': success_count,
            'failure_count': failure_count,
            'summary': rotation_summary
        }

    def _rotate_secret(self, secret_type: str, secret_config: dict) -> dict:
        """
        Rotate a specific secret based on its type and configuration.

        Args:
            secret_type: Type of secret (database, api_keys, certificates)
            secret_config: Configuration for this specific secret

        Returns:
            Dict containing success status and message
        """
        secret_name = secret_config['name']
        vault_path = secret_config['vault_path']

        try:
            # 1. Get the current secret for backup
            current_secret = self._get_current_secret(vault_path)

            # 2. Generate new secret
            if secret_type == 'database':
                new_secret = self._generate_db_credentials(secret_config)
            elif secret_type == 'api_keys':
                new_secret = self._generate_api_key(secret_config)
            elif secret_type == 'certificates':
                new_secret = self._rotate_certificate(secret_config)
            else:
                return {'success': False, 'message': f"Unknown secret type: {secret_type}"}

            # 3. Validate the new secret
            valid, message = self._validate_secret(secret_type, secret_config, new_secret)
            if not valid:
                return {'success': False, 'message': f"Validation failed: {message}"}

            # 4. Store the new secret in Vault
            self._update_vault_secret(vault_path, new_secret)
            logger.info(f"Updated secret {secret_name} in Vault")

            # 5. Update the secret in Kubernetes if configured
            if 'kubernetes_secrets' in secret_config:
                self._update_kubernetes_secrets(secret_config['kubernetes_secrets'], new_secret)
                logger.info(f"Updated Kubernetes secrets for {secret_name}")

            # 6. Notify dependent services if configured
            if 'dependent_services' in secret_config:
                self._notify_dependent_services(secret_config['dependent_services'], secret_name)
                logger.info(f"Notified dependent services for {secret_name}")

            # 7. Log the successful rotation
            self._audit_log(f"Successfully rotated {secret_type} secret: {secret_name}")

            return {'success': True, 'message': f"Successfully rotated {secret_name}"}

        except Exception as e:
            error_msg = f"Failed to rotate {secret_name}: {str(e)}"
            logger.error(error_msg)
            self._audit_log(error_msg, level='ERROR')
            return {'success': False, 'message': error_msg}

    def _get_current_secret(self, vault_path: str) -> dict:
        """Get the current secret from Vault for backup purposes."""
        try:
            response = self.vault_client.secrets.kv.v2.read_secret_version(
                path=vault_path.lstrip('secret/') if vault_path.startswith('secret/') else vault_path
            )
            return response['data']['data']
        except Exception as e:
            logger.warning(f"Could not retrieve current secret at {vault_path}: {str(e)}")
            return {}

    def _generate_db_credentials(self, config: dict) -> dict:
        """Generate new database credentials based on configuration."""
        import secrets
        import string

        # Get password policy from config or use defaults
        min_length = config.get('password_min_length', 16)
        use_special = config.get('password_use_special', True)

        # Generate a secure random password
        chars = string.ascii_letters + string.digits
        if use_special:
            chars += "!@#$%^&*()-_=+[]{}|;:,.<>?"

        # Create a strong password with required length
        password = ''.join(secrets.choice(chars) for _ in range(min_length))

        # If using Vault's database secret engine for managed rotation
        if config.get('use_vault_db_engine', False):
            db_mount = config.get('db_mount_point', 'database')
            db_role = config['db_role']

            try:
                # Request Vault to rotate the database credentials
                self.vault_client.secrets.database.rotate_role_credentials(
                    name=db_role,
                    mount_point=db_mount
                )

                # Get the new credentials
                response = self.vault_client.secrets.database.generate_credentials(
                    name=db_role,
                    mount_point=db_mount
                )

                return {
                    'username': response['data']['username'],
                    'password': response['data']['password']
                }
            except Exception as e:
                logger.error(f"Failed to use Vault DB engine for rotation: {str(e)}")
                # Fall back to self-managed rotation

        # Self-managed rotation logic
        username = config.get('username', config['name'].lower())
        return {
            'username': username,
            'password': password,
            'host': config.get('host', ''),
            'port': config.get('port', ''),
            'database': config.get('database', ''),
            'rotated_at': datetime.datetime.now().isoformat()
        }

    def _generate_api_key(self, config: dict) -> dict:
        """Generate a new API key based on configuration."""
        import secrets
        import string

        key_length = config.get('key_length', 32)
        key_prefix = config.get('key_prefix', '')

        # Generate a cryptographically secure API key
        if config.get('use_uuid', False):
            import uuid
            new_key = str(uuid.uuid4())
        else:
            charset = string.ascii_letters + string.digits
            new_key = ''.join(secrets.choice(charset) for _ in range(key_length))

        # Add prefix if specified
        if key_prefix:
            new_key = f"{key_prefix}{new_key}"

        return {
            'api_key': new_key,
            'service': config.get('service', ''),
            'environment': config.get('environment', 'production'),
            'created_by': 'secret-rotation',
            'created_at': datetime.datetime.now().isoformat(),
            'expires_at': (datetime.datetime.now() + datetime.timedelta(days=config.get('expiry_days', 90))).isoformat()
        }

    def _rotate_certificate(self, config: dict) -> dict:
        """Rotate a TLS certificate."""
        # Check if using cert-manager
        if config.get('use_cert_manager', True):
            return self._rotate_cert_manager_cert(config)
        # Otherwise use Vault PKI engine
        else:
            return self._rotate_vault_pki_cert(config)

    def _rotate_cert_manager_cert(self, config: dict) -> dict:
        """Rotate a certificate managed by cert-manager."""
        try:
            # Get the cert-manager Certificate resource
            namespace = config['namespace']
            cert_name = config['cert_name']

            # Create a custom resource API client
            api_instance = client.CustomObjectsApi()

            # Get the current certificate
            cert = api_instance.get_namespaced_custom_object(
                group="cert-manager.io",
                version="v1",
                namespace=namespace,
                plural="certificates",
                name=cert_name
            )

            # Annotate the certificate to trigger renewal
            patch = {
                "metadata": {
                    "annotations": {
                        "cert-manager.io/renew": "true"
                    }
                }
            }

            api_instance.patch_namespaced_custom_object(
                group="cert-manager.io",
                version="v1",
                namespace=namespace,
                plural="certificates",
                name=cert_name,
                body=patch
            )

            logger.info(f"Triggered cert-manager to renew certificate {cert_name}")

            # Wait for the certificate to be renewed
            max_wait = 60  # seconds
            for _ in range(max_wait):
                cert = api_instance.get_namespaced_custom_object(
                    group="cert-manager.io",
                    version="v1",
                    namespace=namespace,
                    plural="certificates",
                    name=cert_name
                )

                if "status" in cert and "conditions" in cert["status"]:
                    for condition in cert["status"]["conditions"]:
                        if condition["type"] == "Ready" and condition["status"] == "True":
                            logger.info(f"Certificate {cert_name} renewed successfully")

                            # Get the secret containing the certificate
                            secret_name = cert["spec"]["secretName"]
                            secret = self.kube_api.read_namespaced_secret(
                                name=secret_name,
                                namespace=namespace
                            )

                            # Decode the certificate data
                            cert_data = {
                                "tls.crt": base64.b64decode(secret.data["tls.crt"]).decode(),
                                "tls.key": base64.b64decode(secret.data["tls.key"]).decode(),
                                "ca.crt": base64.b64decode(secret.data["ca.crt"]).decode() if "ca.crt" in secret.data else None,
                                "renewed_at": datetime.datetime.now().isoformat()
                            }

                            return cert_data

                time.sleep(1)

            raise Exception(f"Timeout waiting for certificate {cert_name} to be renewed")

        except ApiException as e:
            error_msg = f"Kubernetes API error when rotating certificate: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def _rotate_vault_pki_cert(self, config: dict) -> dict:
        """Rotate a certificate using Vault's PKI engine."""
        try:
            pki_mount = config.get('pki_mount_point', 'pki')
            pki_role = config['pki_role']
            common_name = config['common_name']
            ttl = config.get('ttl', '8760h')  # Default 1 year
            alt_names = config.get('alt_names', [])
            ip_sans = config.get('ip_sans', [])

            # Issue a new certificate
            cert_data = self.vault_client.secrets.pki.issue_certificate(
                mount_point=pki_mount,
                name=pki_role,
                common_name=common_name,
                ttl=ttl,
                alt_names=','.join(alt_names) if alt_names else None,
                ip_sans=','.join(ip_sans) if ip_sans else None
            )

            # Extract the certificate data
            result = {
                'certificate': cert_data['data']['certificate'],
                'private_key': cert_data['data']['private_key'],
                'ca_chain': '\n'.join(cert_data['data']['ca_chain']) if 'ca_chain' in cert_data['data'] else None,
                'issuing_ca': cert_data['data']['issuing_ca'],
                'serial_number': cert_data['data']['serial_number'],
                'expiration': cert_data['data']['expiration'],
                'renewed_at': datetime.datetime.now().isoformat()
            }

            logger.info(f"Generated new certificate for {common_name} with serial {result['serial_number']}")
            return result

        except Exception as e:
            error_msg = f"Failed to issue certificate from Vault: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def _validate_secret(self, secret_type: str, config: dict, new_secret: dict) -> Tuple[bool, str]:
        """
        Validate the new secret before deployment.

        Args:
            secret_type: Type of secret (database, api_keys, certificates)
            config: Secret configuration
            new_secret: The new secret to validate

        Returns:
            Tuple of (is_valid, message)
        """
        try:
            # Basic validation checks
            if secret_type == 'database':
                if 'password' not in new_secret or not new_secret['password']:
                    return False, "Database password is empty"

                # Check password complexity
                if len(new_secret['password']) < config.get('password_min_length', 16):
                    return False, "Password does not meet minimum length requirement"

                # Test connection if validation endpoint is configured
                if 'validation_endpoint' in config:
                    return self._test_db_connection(config, new_secret)

            elif secret_type == 'api_keys':
                if 'api_key' not in new_secret or not new_secret['api_key']:
                    return False, "API key is empty"

                # Check key complexity
                min_length = config.get('key_length', 32)
                if len(new_secret['api_key']) < min_length:
                    return False, f"API key does not meet minimum length of {min_length}"

                # Validate key format if needed
                key_format = config.get('key_format')
                if key_format == 'uuid' and not self._is_valid_uuid(new_secret['api_key']):
                    return False, "API key is not a valid UUID"

            elif secret_type == 'certificates':
                if 'certificate' in new_secret and not new_secret['certificate']:
                    return False, "Certificate is empty"

                if 'tls.crt' in new_secret and not new_secret['tls.crt']:
                    return False, "Certificate is empty"

                # Additional certificate validation could be performed here

            return True, "Validation successful"

        except Exception as e:
            return False, f"Validation error: {str(e)}"

    def _test_db_connection(self, config: dict, credentials: dict) -> Tuple[bool, str]:
        """Test database connection with new credentials."""
        validation_endpoint = config['validation_endpoint']

        try:
            response = requests.post(
                validation_endpoint,
                json={
                    'host': credentials.get('host', config.get('host', '')),
                    'port': credentials.get('port', config.get('port', '')),
                    'database': credentials.get('database', config.get('database', '')),
                    'username': credentials['username'],
                    'password': credentials['password']
                },
                timeout=10
            )

            if response.status_code == 200:
                return True, "Database connection successful"
            else:
                return False, f"Database connection failed: {response.text}"

        except Exception as e:
            return False, f"Database validation error: {str(e)}"

    def _is_valid_uuid(self, value: str) -> bool:
        """Check if string is a valid UUID."""
        import uuid
        try:
            uuid.UUID(value)
            return True
        except ValueError:
            return False

    def _update_vault_secret(self, path: str, data: dict):
        """Update a secret in Vault."""
        try:
            # Remove the 'secret/' prefix if present for KV v2
            path = path.lstrip('secret/') if path.startswith('secret/') else path

            # Write the secret to Vault KV store
            self.vault_client.secrets.kv.v2.create_or_update_secret(
                path=path,
                secret=data
            )

            logger.info(f"Updated secret at {path} in Vault")

        except Exception as e:
            error_msg = f"Failed to update Vault secret at {path}: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def _update_kubernetes_secrets(self, secret_configs: List[dict], new_data: dict):
        """
        Update Kubernetes secrets with the new secret data.

        Args:
            secret_configs: List of K8s secret configurations
            new_data: The new secret data
        """
        for secret_config in secret_configs:
            try:
                namespace = secret_config['namespace']
                name = secret_config['name']

                # Get the current secret
                try:
                    secret = self.kube_api.read_namespaced_secret(name=name, namespace=namespace)
                    secret_exists = True
                except ApiException as e:
                    if e.status == 404:
                        secret_exists = False
                        secret = client.V1Secret(
                            metadata=client.V1ObjectMeta(
                                name=name,
                                namespace=namespace
                            ),
                            type='Opaque',
                            data={}
                        )
                    else:
                        raise

                # Update the secret data
                secret_data = {}
                for k8s_key, data_key in secret_config['key_mapping'].items():
                    if data_key in new_data:
                        # Convert to string if needed and then encode in base64
                        value = str(new_data[data_key])
                        secret_data[k8s_key] = base64.b64encode(value.encode()).decode()

                # Update the secret with new data
                secret.data = {**secret.data, **secret_data} if secret.data else secret_data

                # Update or create the secret
                if secret_exists:
                    self.kube_api.replace_namespaced_secret(name=name, namespace=namespace, body=secret)
                    logger.info(f"Updated Kubernetes secret {namespace}/{name}")
                else:
                    self.kube_api.create_namespaced_secret(namespace=namespace, body=secret)
                    logger.info(f"Created Kubernetes secret {namespace}/{name}")

                # Restart dependent deployments if specified
                if 'restart_deployments' in secret_config and secret_config['restart_deployments']:
                    self._restart_deployments(namespace, secret_config['restart_deployments'])

            except ApiException as e:
                error_msg = f"Kubernetes API error updating secret: {str(e)}"
                logger.error(error_msg)
                raise Exception(error_msg)

    def _restart_deployments(self, namespace: str, deployments: List[str]):
        """
        Restart deployments by patching them with a new annotation.

        Args:
            namespace: The Kubernetes namespace
            deployments: List of deployment names to restart
        """
        apps_api = client.AppsV1Api()

        for deployment_name in deployments:
            try:
                # Patch the deployment with a restart annotation
                timestamp = datetime.datetime.now().isoformat()
                patch = {
                    "spec": {
                        "template": {
                            "metadata": {
                                "annotations": {
                                    "secret-rotated-at": timestamp
                                }
                            }
                        }
                    }
                }

                apps_api.patch_namespaced_deployment(
                    name=deployment_name,
                    namespace=namespace,
                    body=patch
                )

                logger.info(f"Triggered restart of deployment {namespace}/{deployment_name}")

            except ApiException as e:
                logger.error(f"Failed to restart deployment {deployment_name}: {str(e)}")
                # Continue with other deployments even if one fails

    def _notify_dependent_services(self, services: List[dict], secret_name: str):
        """
        Notify dependent services about the secret rotation.

        Args:
            services: List of service configurations
            secret_name: Name of the rotated secret
        """
        for service in services:
            try:
                notification_type = service.get('type', 'webhook')

                if notification_type == 'webhook':
                    self._notify_webhook(service, secret_name)
                elif notification_type == 'kafka':
                    self._notify_kafka(service, secret_name)
                elif notification_type == 'redis':
                    self._notify_redis(service, secret_name)
                else:
                    logger.warning(f"Unknown notification type: {notification_type}")

            except Exception as e:
                logger.error(f"Failed to notify service {service.get('name', 'unknown')}: {str(e)}")
                # Continue with other notifications even if one fails

    def _notify_webhook(self, service: dict, secret_name: str):
        """Send a webhook notification."""
        endpoint = service['endpoint']
        headers = service.get('headers', {})

        # Prepare the payload
        payload = {
            'event': 'secret_rotated',
            'secret_name': secret_name,
            'timestamp': datetime.datetime.now().isoformat(),
            'service': service.get('name', 'unknown')
        }

        # Add custom data if provided
        if 'payload_extra' in service:
            payload.update(service['payload_extra'])

        # Send the webhook
        response = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=10
        )

        if response.status_code not in (200, 201, 202, 204):
            logger.warning(f"Webhook notification returned status {response.status_code}: {response.text}")

    def _notify_kafka(self, service: dict, secret_name: str):
        """Send a Kafka notification."""
        try:
            from kafka import KafkaProducer
            import json

            # Connect to Kafka
            bootstrap_servers = service['bootstrap_servers']
            topic = service['topic']

            producer = KafkaProducer(
                bootstrap_servers=bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode('utf-8')
            )

            # Prepare the message
            message = {
                'event': 'secret_rotated',
                'secret_name': secret_name,
                'timestamp': datetime.datetime.now().isoformat(),
                'service': service.get('name', 'unknown')
            }

            # Add custom data if provided
            if 'message_extra' in service:
                message.update(service['message_extra'])

            # Send the message
            producer.send(topic, message)
            producer.flush()

            logger.info(f"Sent Kafka notification to topic {topic}")

        except ImportError:
            logger.error("Kafka library not installed. Cannot send Kafka notification.")
        except Exception as e:
            logger.error(f"Failed to send Kafka notification: {str(e)}")

    def _notify_redis(self, service: dict, secret_name: str):
        """Send a Redis notification."""
        try:
            import redis
            import json

            # Connect to Redis
            host = service['host']
            port = service.get('port', 6379)
            db = service.get('db', 0)
            password = service.get('password')

            r = redis.Redis(host=host, port=port, db=db, password=password)

            # Prepare the message
            message = {
                'event': 'secret_rotated',
                'secret_name': secret_name,
                'timestamp': datetime.datetime.now().isoformat(),
                'service': service.get('name', 'unknown')
            }

            # Add custom data if provided
            if 'message_extra' in service:
                message.update(service['message_extra'])

            # Send as pub/sub message
            if service.get('use_pubsub', True):
                channel = service['channel']
                r.publish(channel, json.dumps(message))
                logger.info(f"Published Redis message to channel {channel}")

            # Set as a key with expiration
            if 'key_prefix' in service:
                key = f"{service['key_prefix']}:{secret_name}"
                expire_seconds = service.get('expire_seconds', 86400)  # Default 1 day
                r.setex(key, expire_seconds, json.dumps(message))
                logger.info(f"Set Redis key {key} with expiration {expire_seconds}s")

        except ImportError:
            logger.error("Redis library not installed. Cannot send Redis notification.")
        except Exception as e:
            logger.error(f"Failed to send Redis notification: {str(e)}")

    def _audit_log(self, message: str, level: str = 'INFO'):
        """Log an audit event."""
        log_data = {
            'timestamp': datetime.datetime.now().isoformat(),
            'level': level,
            'message': message,
            'component': 'secret-rotation',
            'user': VAULT_ROLE
        }

        # Write to local audit log
        with open('/var/log/secret-rotation-audit.log', 'a') as f:
            f.write(json.dumps(log_data) + '\n')

        # If configured, send to external audit system
        if self.config.get('audit', {}).get('enabled', False):
            self._send_audit_log_external(log_data)

    def _send_audit_log_external(self, log_data: dict):
        """Send audit log to external system if configured."""
        audit_config = self.config.get('audit', {})
        audit_type = audit_config.get('type', 'http')

        try:
            if audit_type == 'http':
                requests.post(
                    audit_config['endpoint'],
                    json=log_data,
                    headers=audit_config.get('headers', {}),
                    timeout=5
                )
            elif audit_type == 'syslog':
                # This would require additional syslog configuration
                import syslog
                syslog.syslog(syslog.LOG_INFO, json.dumps(log_data))
        except Exception as e:
            logger.error(f"Failed to send audit log to external system: {str(e)}")

    def _log_rotation_history(self, timestamp: str, summary: List[dict]):
        """Log rotation history to a file for tracking."""
        history_file = os.path.join(ROTATION_HISTORY_PATH, f"rotation-{timestamp}.json")

        history_data = {
            'timestamp': timestamp,
            'summary': summary
        }

        with open(history_file, 'w') as f:
            json.dump(history_data, f, indent=2)

    def _send_alert(self, subject: str, message: str):
        """Send an alert email about rotation problems."""
        if not ALERT_EMAILS or not ALERT_EMAILS[0]:
            logger.warning("No alert email addresses configured, cannot send alert")
            return

        try:
            if not SMTP_USERNAME or not SMTP_PASSWORD:
                logger.warning("SMTP credentials not configured, cannot send alert email")
                return

            # Create message
            msg = MIMEText(message)
            msg['Subject'] = f"[Homelab Secret Rotation] {subject}"
            msg['From'] = SMTP_USERNAME
            msg['To'] = ', '.join(ALERT_EMAILS)

            # Send email
            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                server.starttls()
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
                server.send_message(msg)

            logger.info(f"Sent alert email: {subject}")

        except Exception as e:
            logger.error(f"Failed to send alert email: {str(e)}")

def main():
    """Main entry point for the script when run as a CronJob."""
    try:
        rotator = SecretRotator()
        result = rotator.run_rotation()

        logger.info(f"Secret rotation completed: {result['success_count']} succeeded, {result['failure_count']} failed")

        # Exit with error if any rotations failed
        if result['failure_count'] > 0:
            sys.exit(1)

    except Exception as e:
        logger.error(f"Secret rotation failed with error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
