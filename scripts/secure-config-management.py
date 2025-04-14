#!/usr/bin/env python3

'''
Secure Configuration Management for Homelab Kubernetes Environments

Installation:
    # Create and activate virtual environment
    python -m venv .venv
    source .venv/bin/activate

    # Install dependencies
    uv add --frozen pyyaml cryptography kubernetes jsonschema

    # Or with pip
    pip install pyyaml cryptography kubernetes jsonschema

Usage:
    # Initialize the configuration system
    python secure-config-management.py init --password YourSecureMasterPassword

    # Save a configuration
    python secure-config-management.py save my-service /path/to/config.yaml

    # Apply to Kubernetes
    python secure-config-management.py apply my-service --namespace my-namespace
'''
import os
import sys
import yaml
import json
import base64
import logging
import argparse
import hashlib
import tempfile
import subprocess
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import kubernetes.client
from kubernetes.client import ApiClient, Configuration
from kubernetes.config import load_kube_config
from jsonschema import validate, ValidationError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('secure-config')

@dataclass
class ConfigPaths:
    """Paths for configuration storage"""
    base_dir: Path
    config_dir: Path
    schema_dir: Path
    secrets_dir: Path
    keys_dir: Path
    history_dir: Path

    @classmethod
    def default(cls) -> 'ConfigPaths':
        base = Path.home() / 'homelab' / 'config'
        return cls(
            base_dir=base,
            config_dir=base / 'configs',
            schema_dir=base / 'schemas',
            secrets_dir=base / 'secrets',
            keys_dir=base / 'keys',
            history_dir=base / 'history'
        )

    def ensure_dirs(self):
        """Create all necessary directories if they don't exist"""
        for path_attr in [self.base_dir, self.config_dir, self.schema_dir,
                         self.secrets_dir, self.keys_dir, self.history_dir]:
            path_attr.mkdir(parents=True, exist_ok=True)


class SecretManager:
    """Handles separation and encryption of secrets"""

    def __init__(self, config_paths: ConfigPaths, master_password: Optional[str] = None):
        self.config_paths = config_paths
        self.master_password = master_password or os.environ.get('HOMELAB_MASTER_PASSWORD')
        if not self.master_password:
            raise ValueError("Master password not provided and HOMELAB_MASTER_PASSWORD not set")

        self.key_file = self.config_paths.keys_dir / "master.key"
        self._ensure_master_key()

    def _ensure_master_key(self):
        """Generate or load the master encryption key"""
        if not self.key_file.exists():
            # Generate a new key derived from the master password
            salt = os.urandom(16)
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=salt,
                iterations=100000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(self.master_password.encode()))

            # Save the key and salt
            with open(self.key_file, 'wb') as f:
                f.write(salt + b'\n' + key)

            logger.info(f"Generated new master key at {self.key_file}")

        # Load the existing key
        with open(self.key_file, 'rb') as f:
            content = f.read().strip().split(b'\n')
            self.salt = content[0]
            self.key = content[1]

        self.fernet = Fernet(self.key)

    def extract_secrets(self, config: Dict) -> Dict:
        """Extract sensitive values from config and replace with references"""
        secrets = {}

        def process_dict(d, path=""):
            result = {}
            for k, v in d.items():
                current_path = f"{path}.{k}" if path else k

                if isinstance(v, dict):
                    result[k] = process_dict(v, current_path)
                elif isinstance(v, list):
                    result[k] = process_list(v, current_path)
                elif isinstance(v, str) and (
                    k.lower().endswith(('password', 'secret', 'key', 'token', 'credential'))
                    or "SECRET" in current_path.upper()
                ):
                    # This is a secret value
                    secret_id = hashlib.sha256(f"{current_path}:{v}".encode()).hexdigest()[:12]
                    result[k] = f"SECRET_REF:{secret_id}"
                    secrets[secret_id] = self.encrypt_value(v)
                    logger.debug(f"Extracted secret at {current_path}")
                else:
                    result[k] = v
            return result

        def process_list(lst, path):
            result = []
            for i, item in enumerate(lst):
                current_path = f"{path}[{i}]"
                if isinstance(item, dict):
                    result.append(process_dict(item, current_path))
                elif isinstance(item, list):
                    result.append(process_list(item, current_path))
                else:
                    result.append(item)
            return result

        processed_config = process_dict(config)
        return processed_config, secrets

    def merge_secrets(self, config: Dict, service_name: str) -> Dict:
        """Merge decrypted secrets back into config"""
        secrets_file = self.config_paths.secrets_dir / f"{service_name}.secrets.yaml"
        if not secrets_file.exists():
            return config

        with open(secrets_file, 'r') as f:
            secrets = yaml.safe_load(f)

        def process_dict(d):
            result = {}
            for k, v in d.items():
                if isinstance(v, dict):
                    result[k] = process_dict(v)
                elif isinstance(v, list):
                    result[k] = process_list(v)
                elif isinstance(v, str) and v.startswith("SECRET_REF:"):
                    secret_id = v.split(":", 1)[1]
                    if secret_id in secrets:
                        result[k] = self.decrypt_value(secrets[secret_id])
                    else:
                        logger.warning(f"Secret reference {secret_id} not found!")
                        result[k] = v
                else:
                    result[k] = v
            return result

        def process_list(lst):
            result = []
            for item in lst:
                if isinstance(item, dict):
                    result.append(process_dict(item))
                elif isinstance(item, list):
                    result.append(process_list(item))
                else:
                    result.append(item)
            return result

        return process_dict(config)

    def encrypt_value(self, value: str) -> str:
        """Encrypt a string value"""
        return self.fernet.encrypt(value.encode()).decode()

    def decrypt_value(self, encrypted: str) -> str:
        """Decrypt a string value"""
        return self.fernet.decrypt(encrypted.encode()).decode()

    def save_secrets(self, secrets: Dict, service_name: str):
        """Save extracted secrets to a file"""
        secrets_file = self.config_paths.secrets_dir / f"{service_name}.secrets.yaml"
        with open(secrets_file, 'w') as f:
            yaml.safe_dump(secrets, f)
        logger.info(f"Saved {len(secrets)} secrets to {secrets_file}")


class ConfigValidator:
    """Validates configurations against JSON schemas"""

    def __init__(self, config_paths: ConfigPaths):
        self.config_paths = config_paths

    def validate(self, config: Dict, service_name: str) -> bool:
        """Validate a configuration against its schema"""
        schema_file = self.config_paths.schema_dir / f"{service_name}.schema.json"
        if not schema_file.exists():
            logger.warning(f"Schema not found for {service_name}, skipping validation")
            return True

        try:
            with open(schema_file, 'r') as f:
                schema = json.load(f)

            validate(instance=config, schema=schema)
            logger.info(f"Configuration for {service_name} validated successfully")
            return True
        except ValidationError as e:
            logger.error(f"Configuration validation failed: {e}")
            return False
        except Exception as e:
            logger.error(f"Error during validation: {e}")
            return False

    def create_schema(self, config: Dict, service_name: str):
        """Generate a basic schema from an existing configuration"""
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": f"{service_name} Configuration Schema",
            "type": "object",
            "properties": self._infer_schema_properties(config),
            "required": list(config.keys())
        }

        schema_file = self.config_paths.schema_dir / f"{service_name}.schema.json"
        with open(schema_file, 'w') as f:
            json.dump(schema, f, indent=2)

        logger.info(f"Created schema at {schema_file}")
        return schema_file

    def _infer_schema_properties(self, obj: Any) -> Dict:
        """Recursively infer JSON schema properties from an object"""
        if isinstance(obj, dict):
            properties = {}
            for k, v in obj.items():
                properties[k] = self._infer_schema_type(v)
            return properties

        return {}

    def _infer_schema_type(self, value: Any) -> Dict:
        """Infer the JSON Schema type definition for a value"""
        if isinstance(value, dict):
            return {
                "type": "object",
                "properties": self._infer_schema_properties(value),
                "required": list(value.keys())
            }
        elif isinstance(value, list):
            if value:
                # Use the first item to infer array items type
                return {
                    "type": "array",
                    "items": self._infer_schema_type(value[0])
                }
            else:
                return {"type": "array"}
        elif isinstance(value, bool):
            return {"type": "boolean"}
        elif isinstance(value, int):
            return {"type": "integer"}
        elif isinstance(value, float):
            return {"type": "number"}
        elif isinstance(value, str):
            if value.startswith("SECRET_REF:"):
                return {
                    "type": "string",
                    "pattern": "^SECRET_REF:[a-f0-9]{12}$"
                }
            else:
                return {"type": "string"}
        else:
            return {"type": "string"}


class ConfigDriftDetector:
    """Detects and reports changes in configurations"""

    def __init__(self, config_paths: ConfigPaths):
        self.config_paths = config_paths

    def save_config_snapshot(self, config: Dict, service_name: str) -> str:
        """Save a timestamped snapshot of the configuration"""
        import time
        timestamp = int(time.time())

        service_history_dir = self.config_paths.history_dir / service_name
        service_history_dir.mkdir(exist_ok=True)

        snapshot_file = service_history_dir / f"{timestamp}.yaml"
        with open(snapshot_file, 'w') as f:
            yaml.safe_dump(config, f)

        # Create a checksum file
        checksum = hashlib.sha256(yaml.safe_dump(config).encode()).hexdigest()
        with open(snapshot_file.with_suffix('.checksum'), 'w') as f:
            f.write(checksum)

        logger.info(f"Saved config snapshot to {snapshot_file}")
        return str(snapshot_file)

    def detect_drift(self, config: Dict, service_name: str) -> Dict[str, Any]:
        """Detect changes between current config and the last known config"""
        service_history_dir = self.config_paths.history_dir / service_name

        if not service_history_dir.exists() or not list(service_history_dir.glob("*.yaml")):
            logger.info(f"No previous configuration found for {service_name}")
            return {"drift_detected": False, "changes": {}, "is_new": True}

        # Get the most recent snapshot
        snapshots = sorted(service_history_dir.glob("*.yaml"),
                         key=lambda p: int(p.stem))
        latest_snapshot = snapshots[-1]

        with open(latest_snapshot, 'r') as f:
            previous_config = yaml.safe_load(f)

        # Compare configs
        changes = self._compare_configs({}, previous_config, config)

        if changes:
            logger.info(f"Configuration drift detected for {service_name}")
            return {"drift_detected": True, "changes": changes, "is_new": False}
        else:
            logger.info(f"No configuration drift detected for {service_name}")
            return {"drift_detected": False, "changes": {}, "is_new": False}

    def _compare_configs(self, changes: Dict, old: Dict, new: Dict, path="") -> Dict:
        """Recursively compare two configurations and identify changes"""
        all_keys = set(old.keys()) | set(new.keys())

        for key in all_keys:
            current_path = f"{path}.{key}" if path else key

            if key not in old:
                changes[current_path] = {"type": "added", "value": new[key]}
            elif key not in new:
                changes[current_path] = {"type": "removed", "value": old[key]}
            elif isinstance(old[key], dict) and isinstance(new[key], dict):
                self._compare_configs(changes, old[key], new[key], current_path)
            elif old[key] != new[key]:
                changes[current_path] = {
                    "type": "modified",
                    "old_value": old[key],
                    "new_value": new[key]
                }

        return changes


class KubernetesConfigManager:
    """Manages secure distribution of configs to Kubernetes"""

    def __init__(self, config_paths: ConfigPaths):
        self.config_paths = config_paths
        # Load Kubernetes configuration
        try:
            load_kube_config()
            self.api_client = ApiClient()
            self.core_v1 = kubernetes.client.CoreV1Api(self.api_client)
            logger.info("Kubernetes client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Kubernetes client: {e}")
            self.api_client = None
            self.core_v1 = None

    def apply_config(self, config: Dict, service_name: str, namespace: str,
                    secret_manager: SecretManager) -> bool:
        """Apply configuration to Kubernetes as ConfigMap and Secret"""
        if not self.core_v1:
            logger.error("Kubernetes client not initialized")
            return False

        try:
            # Split configuration into regular config and sensitive data
            regular_config = {}
            sensitive_config = {}

            for k, v in config.items():
                if isinstance(v, dict):
                    # For nested dictionaries, process them separately
                    reg_conf, sens_conf = self._separate_sensitive(v)
                    if reg_conf:
                        regular_config[k] = reg_conf
                    if sens_conf:
                        sensitive_config[k] = sens_conf
                elif isinstance(v, str) and v.startswith("SECRET_REF:"):
                    # This is a reference to a secret
                    sensitive_config[k] = v
                else:
                    regular_config[k] = v

            # Resolve secret references
            resolved_secrets = {}
            for k, v in sensitive_config.items():
                if isinstance(v, str) and v.startswith("SECRET_REF:"):
                    secret_id = v.split(":", 1)[1]
                    # Get the actual secret value
                    resolved_value = secret_manager.decrypt_value(
                        self._get_secret_by_id(service_name, secret_id, secret_manager)
                    )
                    resolved_secrets[k] = resolved_value
                elif isinstance(v, dict):
                    # Handle nested dictionaries of secrets
                    resolved_secrets[k] = self._resolve_nested_secrets(
                        v, service_name, secret_manager
                    )

            # Create or update ConfigMap
            if regular_config:
                self._apply_configmap(service_name, namespace, regular_config)

            # Create or update Secret
            if resolved_secrets:
                self._apply_secret(service_name, namespace, resolved_secrets)

            logger.info(f"Applied configuration for {service_name} to Kubernetes")
            return True

        except Exception as e:
            logger.error(f"Failed to apply configuration to Kubernetes: {e}")
            return False

    def _separate_sensitive(self, config: Dict) -> tuple:
        """Separate regular config from sensitive data in nested dictionaries"""
        regular = {}
        sensitive = {}

        for k, v in config.items():
            if isinstance(v, dict):
                reg, sens = self._separate_sensitive(v)
                if reg:
                    regular[k] = reg
                if sens:
                    sensitive[k] = sens
            elif isinstance(v, str) and v.startswith("SECRET_REF:"):
                sensitive[k] = v
            elif k.lower().endswith(('password', 'secret', 'key', 'token', 'credential')):
                sensitive[k] = v
            else:
                regular[k] = v

        return regular, sensitive

    def _get_secret_by_id(self, service_name: str, secret_id: str,
                         secret_manager: SecretManager) -> str:
        """Get a secret value by its ID from the secrets storage"""
        secrets_file = self.config_paths.secrets_dir / f"{service_name}.secrets.yaml"

        if not secrets_file.exists():
            raise ValueError(f"Secrets file for {service_name} not found")

        with open(secrets_file, 'r') as f:
            secrets = yaml.safe_load(f)

        if secret_id not in secrets:
            raise ValueError(f"Secret ID {secret_id} not found")

        return secrets[secret_id]

    def _resolve_nested_secrets(self, config: Dict, service_name: str,
                               secret_manager: SecretManager) -> Dict:
        """Recursively resolve secret references in nested dictionaries"""
        result = {}

        for k, v in config.items():
            if isinstance(v, dict):
                result[k] = self._resolve_nested_secrets(v, service_name, secret_manager)
            elif isinstance(v, str) and v.startswith("SECRET_REF:"):
                secret_id = v.split(":", 1)[1]
                result[k] = secret_manager.decrypt_value(
                    self._get_secret_by_id(service_name, secret_id, secret_manager)
                )
            else:
                result[k] = v

        return result

    def _apply_configmap(self, name: str, namespace: str, data: Dict):
        """Create or update a ConfigMap in Kubernetes"""
        # Convert all values to strings
        string_data = {k: self._value_to_string(v) for k, v in data.items()}

        try:
            # Check if ConfigMap exists
            self.core_v1.read_namespaced_config_map(name, namespace)

            # Update existing ConfigMap
            self.core_v1.patch_namespaced_config_map(
                name=name,
                namespace=namespace,
                body=kubernetes.client.V1ConfigMap(
                    api_version="v1",
                    kind="ConfigMap",
                    metadata=kubernetes.client.V1ObjectMeta(name=name),
                    data=string_data
                )
            )
            logger.info(f"Updated ConfigMap {name} in namespace {namespace}")

        except kubernetes.client.rest.ApiException as e:
            if e.status == 404:
                # Create new ConfigMap
                self.core_v1.create_namespaced_config_map(
                    namespace=namespace,
                    body=kubernetes.client.V1ConfigMap(
                        api_version="v1",
                        kind="ConfigMap",
                        metadata=kubernetes.client.V1ObjectMeta(name=name),
                        data=string_data
                    )
                )
                logger.info(f"Created ConfigMap {name} in namespace {namespace}")
            else:
                raise

    def _apply_secret(self, name: str, namespace: str, data: Dict):
        """Create or update a Secret in Kubernetes"""
        # Convert the dictionary to a string or base64 format suitable for Kubernetes
        string_data = {k: self._value_to_string(v) for k, v in data.items()}

        try:
            # Check if Secret exists
            self.core_v1.read_namespaced_secret(name, namespace)

            # Update existing Secret
            self.core_v1.patch_namespaced_secret(
                name=name,
                namespace=namespace,
                body=kubernetes.client.V1Secret(
                    api_version="v1",
                    kind="Secret",
                    metadata=kubernetes.client.V1ObjectMeta(name=name),
                    string_data=string_data
                )
            )
            logger.info(f"Updated Secret {name} in namespace {namespace}")

        except kubernetes.client.rest.ApiException as e:
            if e.status == 404:
                # Create new Secret
                self.core_v1.create_namespaced_secret(
                    namespace=namespace,
                    body=kubernetes.client.V1Secret(
                        api_version="v1",
                        kind="Secret",
                        metadata=kubernetes.client.V1ObjectMeta(name=name),
                        string_data=string_data
                    )
                )
                logger.info(f"Created Secret {name} in namespace {namespace}")
            else:
                raise

    def _value_to_string(self, value: Any) -> str:
        """Convert any value to a string suitable for Kubernetes ConfigMap/Secret"""
        if isinstance(value, dict) or isinstance(value, list):
            return yaml.safe_dump(value)
        else:
            return str(value)

    def verify_deployment(self, service_name: str, namespace: str) -> bool:
        """Verify that configuration has been applied correctly"""
        try:
            # Check ConfigMap
            try:
                self.core_v1.read_namespaced_config_map(service_name, namespace)
                configmap_exists = True
            except kubernetes.client.rest.ApiException:
                configmap_exists = False

            # Check Secret
            try:
                self.core_v1.read_namespaced_secret(service_name, namespace)
                secret_exists = True
            except kubernetes.client.rest.ApiException:
                secret_exists = False

            if configmap_exists or secret_exists:
                logger.info(f"Verified configuration for {service_name} in namespace {namespace}")
                return True
            else:
                logger.warning(f"Configuration for {service_name} not found in namespace {namespace}")
                return False

        except Exception as e:
            logger.error(f"Error verifying deployment: {e}")
            return False


class ConfigManager:
    """Main configuration management class that ties all components together"""

    def __init__(self, config_paths: Optional[ConfigPaths] = None, master_password: Optional[str] = None):
        self.config_paths = config_paths or ConfigPaths.default()
        self.config_paths.ensure_dirs()

        self.secret_manager = SecretManager(self.config_paths, master_password)
        self.validator = ConfigValidator(self.config_paths)
        self.drift_detector = ConfigDriftDetector(self.config_paths)
        self.k8s_manager = KubernetesConfigManager(self.config_paths)

    def load_config(self, service_name: str) -> Dict:
        """Load configuration for a service"""
        config_file = self.config_paths.config_dir / f"{service_name}.yaml"

        if not config_file.exists():
            logger.error(f"Configuration file not found: {config_file}")
            return {}

        with open(config_file, 'r') as f:
            config = yaml.safe_load(f)

        return config

    def save_config(self, config: Dict, service_name: str) -> bool:
        """Save and process a configuration"""
        # Extract secrets
        processed_config, secrets = self.secret_manager.extract_secrets(config)

        # Save the processed config
        config_file = self.config_paths.config_dir / f"{service_name}.yaml"
        with open(config_file, 'w') as f:
            yaml.safe_dump(processed_config, f)

        # Save secrets separately
        self.secret_manager.save_secrets(secrets, service_name)

        # Validate the config
        if not self.validator.validate(processed_config, service_name):
            logger.warning(f"Configuration for {service_name} has validation errors")

        # Check for drift
        drift_result = self.drift_detector.detect_drift(processed_config, service_name)
        if drift_result["drift_detected"]:
            logger.info(f"Detected changes in {len(drift_result['changes'])} fields")

        # Save a snapshot
        self.drift_detector.save_config_snapshot(processed_config, service_name)

        logger.info(f"Configuration for {service_name} saved successfully")
        return True

    def apply_to_kubernetes(self, service_name: str, namespace: str = "default") -> bool:
        """Apply configuration to Kubernetes"""
        config = self.load_config(service_name)
        if not config:
            return False

        # Merge secrets back for complete application
        complete_config = self.secret_manager.merge_secrets(config, service_name)

        # Apply to Kubernetes
        result = self.k8s_manager.apply_config(
            complete_config, service_name, namespace, self.secret_manager
        )

        # Verify deployment
        if result:
            self.k8s_manager.verify_deployment(service_name, namespace)

        return result

    def create_schema_from_config(self, service_name: str) -> bool:
        """Create a schema from an existing configuration"""
        config = self.load_config(service_name)
        if not config:
            return False

        self.validator.create_schema(config, service_name)
        return True


def main():
    parser = argparse.ArgumentParser(description="Secure Configuration Management for Homelab")
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Initialize command
    init_parser = subparsers.add_parser("init", help="Initialize the configuration system")

    # Save config command
    save_parser = subparsers.add_parser("save", help="Save a configuration")
    save_parser.add_argument("service", help="Service name")
    save_parser.add_argument("config_file", help="Path to configuration file")

    # Load config command
    load_parser = subparsers.add_parser("load", help="Load a configuration")
    load_parser.add_argument("service", help="Service name")

    # Apply command
    apply_parser = subparsers.add_parser("apply", help="Apply configuration to Kubernetes")
    apply_parser.add_argument("service", help="Service name")
    apply_parser.add_argument("--namespace", "-n", default="default", help="Kubernetes namespace")

    # Create schema command
    schema_parser = subparsers.add_parser("create-schema", help="Create a schema from configuration")
    schema_parser.add_argument("service", help="Service name")

    # Check drift command
    drift_parser = subparsers.add_parser("check-drift", help="Check for configuration drift")
    drift_parser.add_argument("service", help="Service name")

    # Common arguments
    parser.add_argument("--config-dir", help="Base configuration directory")
    parser.add_argument("--password", help="Master password (or use HOMELAB_MASTER_PASSWORD env var)")

    args = parser.parse_args()

    # Determine config paths
    config_paths = None
    if args.config_dir:
        base = Path(args.config_dir)
        config_paths = ConfigPaths(
            base_dir=base,
            config_dir=base / 'configs',
            schema_dir=base / 'schemas',
            secrets_dir=base / 'secrets',
            keys_dir=base / 'keys',
            history_dir=base / 'history'
        )

    try:
        manager = ConfigManager(config_paths, args.password)

        if args.command == "init":
            manager.config_paths.ensure_dirs()
            logger.info(f"Initialized configuration directories in {manager.config_paths.base_dir}")

        elif args.command == "save":
            with open(args.config_file, 'r') as f:
                config = yaml.safe_load(f)
            manager.save_config(config, args.service)

        elif args.command == "load":
            config = manager.load_config(args.service)
            print(yaml.safe_dump(config))

        elif args.command == "apply":
            manager.apply_to_kubernetes(args.service, args.namespace)

        elif args.command == "create-schema":
            manager.create_schema_from_config(args.service)

        elif args.command == "check-drift":
            config = manager.load_config(args.service)
            drift_result = manager.drift_detector.detect_drift(config, args.service)
            if drift_result["drift_detected"]:
                print(f"Configuration drift detected for {args.service}")
                for path, change in drift_result["changes"].items():
                    print(f"  {path}: {change['type']}")
            else:
                print(f"No drift detected for {args.service}")

        else:
            parser.print_help()

    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
