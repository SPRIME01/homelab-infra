#!/usr/bin/env python3
"""
Security Response Automation for Homelab

This script provides automated responses to security incidents in a homelab environment.
It implements automated actions while maintaining caution and requiring human verification
for critical operations.

Features:
- Temporary IP blocking for suspicious addresses
- Isolation of potentially compromised containers
- Automated credential rotation for compromised accounts
- Forensic data capture for security incidents
- Execution of predefined response playbooks for common security events
"""

import os
import re
import sys
import json
import time
import uuid
import socket
import argparse
import ipaddress
import smtplib
import subprocess
import threading
import logging
import getpass
import hashlib
import datetime
import tempfile
from pathlib import Path
from typing import Dict, List, Set, Tuple, Any, Optional, Union, Callable
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("/var/log/homelab/security-response.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("homelab-security-response")

# Default configuration
DEFAULT_CONFIG = {
    "general": {
        "workspace_dir": "/var/lib/homelab/security-response",
        "log_dir": "/var/log/homelab",
        "admin_email": "admin@homelab.local",
        "verification_timeout": 300,  # seconds to wait for human verification
        "dry_run": False,  # If True, don't actually execute actions, just log
    },
    "network": {
        "block_duration": 3600,  # seconds (1 hour)
        "block_method": "iptables",  # or "ufw", "firewalld"
        "trusted_ips": ["192.168.1.0/24"],
        "critical_hosts": ["192.168.1.1", "192.168.1.2"],  # Never block these
        "max_auto_block_score": 70,  # Auto-block if score exceeds this (0-100)
    },
    "container": {
        "engine": "docker",  # or "podman"
        "isolation_network": "isolation-network",
        "auto_isolate_score": 90,  # Auto-isolate if score exceeds this (0-100)
        "critical_containers": ["pihole", "router", "proxy"],  # Never isolate these
    },
    "credentials": {
        "auto_rotate_score": 0,  # Don't auto-rotate by default (0-100)
        "rotation_methods": {
            "system_user": {
                "enabled": True,
                "script": "/home/sprime01/homelab/homelab-infra/scripts/rotate-user-password.sh"
            },
            "ssh_keys": {
                "enabled": True,
                "script": "/home/sprime01/homelab/homelab-infra/scripts/rotate-ssh-keys.sh"
            },
            "service_tokens": {
                "enabled": True,
                "script": "/home/sprime01/homelab/homelab-infra/scripts/rotate-service-token.sh"
            }
        }
    },
    "forensics": {
        "capture_dir": "/var/lib/homelab/security-forensics",
        "max_capture_size_gb": 2,
        "tools": {
            "tcpdump": "/usr/sbin/tcpdump",
            "memory_dump": "/usr/bin/memory-dump",
            "process_capture": "/usr/bin/ps"
        },
        "auto_capture": True
    },
    "playbooks": {
        "dir": "/home/sprime01/homelab/homelab-infra/security-playbooks",
        "auto_execute_score": 0,  # Don't auto-execute by default (0-100)
        "available": {
            "brute_force": "respond-to-brute-force.sh",
            "malware_detection": "respond-to-malware.sh",
            "data_exfiltration": "respond-to-exfiltration.sh",
            "ransomware": "respond-to-ransomware.sh",
            "unauthorized_access": "respond-to-unauthorized-access.sh"
        }
    },
    "notification": {
        "methods": {
            "email": {
                "enabled": True,
                "smtp_server": "localhost",
                "smtp_port": 25,
                "sender": "security-response@homelab.local",
                "recipients": ["admin@homelab.local"]
            },
            "slack": {
                "enabled": False,
                "webhook_url": ""
            },
            "sms": {
                "enabled": False,
                "api_key": "",
                "phone_numbers": []
            }
        }
    }
}


class SecurityEvent:
    """Represents a security event requiring a response"""

    def __init__(self, event_type: str, source: str, details: Dict[str, Any], severity: int = 50):
        self.id = str(uuid.uuid4())
        self.event_type = event_type
        self.source = source
        self.details = details
        self.severity = severity  # 0-100
        self.timestamp = datetime.datetime.now()
        self.status = "new"
        self.response_actions = []
        self.verification_status = "pending"
        self.verification_user = None
        self.verification_time = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary for serialization"""
        return {
            "id": self.id,
            "event_type": self.event_type,
            "source": self.source,
            "details": self.details,
            "severity": self.severity,
            "timestamp": self.timestamp.isoformat(),
            "status": self.status,
            "response_actions": self.response_actions,
            "verification_status": self.verification_status,
            "verification_user": self.verification_user,
            "verification_time": self.verification_time.isoformat() if self.verification_time else None
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SecurityEvent':
        """Create event instance from dictionary"""
        event = cls(
            event_type=data["event_type"],
            source=data["source"],
            details=data["details"],
            severity=data["severity"]
        )
        event.id = data["id"]
        event.timestamp = datetime.datetime.fromisoformat(data["timestamp"])
        event.status = data["status"]
        event.response_actions = data["response_actions"]
        event.verification_status = data["verification_status"]
        event.verification_user = data["verification_user"]
        if data["verification_time"]:
            event.verification_time = datetime.datetime.fromisoformat(data["verification_time"])
        return event


class ResponseAction:
    """Base class for security response actions"""

    def __init__(self, event: SecurityEvent, config: Dict[str, Any]):
        self.event = event
        self.config = config
        self.id = str(uuid.uuid4())
        self.name = self.__class__.__name__
        self.status = "pending"
        self.requires_verification = True
        self.verification_status = "pending"
        self.result = None
        self.start_time = None
        self.end_time = None
        self.error = None

    def requires_human_verification(self) -> bool:
        """Determine if this action requires human verification before execution"""
        return self.requires_verification

    def execute(self) -> bool:
        """Execute the response action"""
        self.start_time = datetime.datetime.now()
        self.status = "in_progress"

        try:
            # Check if we're in dry run mode
            if self.config["general"]["dry_run"]:
                logger.info(f"DRY RUN: Would execute {self.name} for event {self.event.id}")
                self.result = "Skipped (dry run mode)"
                self.status = "completed"
                return True

            # Execute the actual action
            result = self._execute_impl()
            self.result = result
            self.status = "completed"
            return True

        except Exception as e:
            self.error = str(e)
            self.status = "failed"
            logger.error(f"Error executing action {self.name}: {e}", exc_info=True)
            return False
        finally:
            self.end_time = datetime.datetime.now()

    def _execute_impl(self) -> Any:
        """Implementation of the actual action, to be overridden by subclasses"""
        raise NotImplementedError("Subclasses must implement _execute_impl")

    def to_dict(self) -> Dict[str, Any]:
        """Convert action to dictionary for serialization"""
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "requires_verification": self.requires_verification,
            "verification_status": self.verification_status,
            "result": self.result,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "error": self.error
        }


class BlockIPAction(ResponseAction):
    """Action to block a suspicious IP address"""

    def __init__(self, event: SecurityEvent, config: Dict[str, Any], ip_address: str, duration: int = None):
        super().__init__(event, config)
        self.ip_address = ip_address
        self.duration = duration or config["network"]["block_duration"]

        # Auto-determine verification requirements based on severity and configuration
        block_score = config["network"]["max_auto_block_score"]
        self.requires_verification = event.severity <= block_score

        # Check if this is a critical host that should never be blocked
        try:
            ip_obj = ipaddress.ip_address(ip_address)
            for critical in config["network"]["critical_hosts"]:
                if ip_obj == ipaddress.ip_address(critical):
                    self.requires_verification = True
                    break

            # Check if IP is in trusted networks
            for trusted_net in config["network"]["trusted_ips"]:
                if ip_obj in ipaddress.ip_network(trusted_net):
                    self.requires_verification = True
                    break
        except ValueError:
            # If IP parsing failed, require verification
            self.requires_verification = True

    def _execute_impl(self) -> str:
        """Implement IP blocking using the configured method"""
        logger.info(f"Blocking IP address {self.ip_address} for {self.duration} seconds")

        # Check the method to use for blocking
        method = self.config["network"]["block_method"].lower()

        if method == "iptables":
            # Block using iptables
            subprocess.run([
                "sudo", "iptables", "-A", "INPUT", "-s", self.ip_address, "-j", "DROP"
            ], check=True)

            # Schedule unblock job
            unblock_time = time.time() + self.duration
            unblock_cmd = f"echo 'sudo iptables -D INPUT -s {self.ip_address} -j DROP' | at now + {self.duration} seconds"
            subprocess.run(unblock_cmd, shell=True, check=True)

            return f"IP {self.ip_address} blocked with iptables until {datetime.datetime.fromtimestamp(unblock_time)}"

        elif method == "ufw":
            # Block using ufw
            subprocess.run([
                "sudo", "ufw", "deny", "from", self.ip_address, "to", "any"
            ], check=True)

            # Schedule unblock job
            unblock_time = time.time() + self.duration
            unblock_cmd = f"echo 'sudo ufw delete deny from {self.ip_address} to any' | at now + {self.duration} seconds"
            subprocess.run(unblock_cmd, shell=True, check=True)

            return f"IP {self.ip_address} blocked with ufw until {datetime.datetime.fromtimestamp(unblock_time)}"

        elif method == "firewalld":
            # Block using firewalld
            subprocess.run([
                "sudo", "firewall-cmd", "--add-rich-rule=rule family='ipv4' source address='{self.ip_address}' drop"
            ], check=True)

            # Schedule unblock job
            unblock_time = time.time() + self.duration
            unblock_cmd = f"echo 'sudo firewall-cmd --remove-rich-rule=\"rule family=ipv4 source address={self.ip_address} drop\"' | at now + {self.duration} seconds"
            subprocess.run(unblock_cmd, shell=True, check=True)

            return f"IP {self.ip_address} blocked with firewalld until {datetime.datetime.fromtimestamp(unblock_time)}"

        else:
            raise ValueError(f"Unsupported blocking method: {method}")


class IsolateContainerAction(ResponseAction):
    """Action to isolate a potentially compromised container"""

    def __init__(self, event: SecurityEvent, config: Dict[str, Any], container_id: str):
        super().__init__(event, config)
        self.container_id = container_id

        # Auto-determine verification requirements based on severity and configuration
        isolate_score = config["container"]["auto_isolate_score"]
        self.requires_verification = event.severity <= isolate_score

        # Always require verification for critical containers
        container_name = self._get_container_name()
        if container_name and any(critical in container_name for critical in config["container"]["critical_containers"]):
            self.requires_verification = True

    def _get_container_name(self) -> Optional[str]:
        """Get container name from ID"""
        try:
            engine = self.config["container"]["engine"]
            if engine == "docker":
                result = subprocess.run(
                    ["docker", "inspect", "--format", "{{.Name}}", self.container_id],
                    capture_output=True, text=True, check=True
                )
                return result.stdout.strip().lstrip('/')
            elif engine == "podman":
                result = subprocess.run(
                    ["podman", "inspect", "--format", "{{.Name}}", self.container_id],
                    capture_output=True, text=True, check=True
                )
                return result.stdout.strip()
            else:
                return None
        except subprocess.SubprocessError:
            return None

    def _execute_impl(self) -> str:
        """Implement container isolation"""
        logger.info(f"Isolating container {self.container_id}")

        # Get container engine
        engine = self.config["container"]["engine"]
        isolation_network = self.config["container"]["isolation_network"]
        container_name = self._get_container_name() or self.container_id

        # Check if isolation network exists, create if it doesn't
        if engine == "docker":
            network_check = subprocess.run(
                ["docker", "network", "ls", "--filter", f"name={isolation_network}", "--format", "{{.Name}}"],
                capture_output=True, text=True
            )

            if isolation_network not in network_check.stdout:
                # Create isolation network with no external connectivity
                subprocess.run([
                    "docker", "network", "create",
                    "--internal",
                    isolation_network
                ], check=True)

        elif engine == "podman":
            network_check = subprocess.run(
                ["podman", "network", "ls", "--filter", f"name={isolation_network}", "--format", "{{.Name}}"],
                capture_output=True, text=True
            )

            if isolation_network not in network_check.stdout:
                # Create isolation network with no external connectivity
                subprocess.run([
                    "podman", "network", "create",
                    "--internal",
                    isolation_network
                ], check=True)

        # Capture filesystem state before isolation (for evidence)
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        snapshot_dir = Path(self.config["forensics"]["capture_dir"]) / f"container-{container_name}-{timestamp}"
        snapshot_dir.mkdir(parents=True, exist_ok=True)

        # Take container filesystem snapshot
        if engine == "docker":
            subprocess.run([
                "docker", "export", self.container_id, "-o",
                str(snapshot_dir / f"{container_name}-fs.tar")
            ], check=True)

            # Get container logs
            subprocess.run([
                "docker", "logs", self.container_id,
                f">{str(snapshot_dir / f'{container_name}-logs.txt')}"
            ], shell=True, check=True)

            # Disconnect from all networks
            inspect_result = subprocess.run(
                ["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}", self.container_id],
                capture_output=True, text=True, check=True
            )

            networks = json.loads(inspect_result.stdout)
            for network in networks:
                subprocess.run([
                    "docker", "network", "disconnect", "-f", network, self.container_id
                ], check=True)

            # Connect to isolation network
            subprocess.run([
                "docker", "network", "connect", isolation_network, self.container_id
            ], check=True)

        elif engine == "podman":
            subprocess.run([
                "podman", "export", self.container_id, "-o",
                str(snapshot_dir / f"{container_name}-fs.tar")
            ], check=True)

            # Get container logs
            subprocess.run([
                "podman", "logs", self.container_id,
                f">{str(snapshot_dir / f'{container_name}-logs.txt')}"
            ], shell=True, check=True)

            # Disconnect from all networks and connect to isolation
            # Note: Podman networking details might need adjustment based on version
            subprocess.run([
                "podman", "network", "disconnect", "all", self.container_id
            ], check=True)

            subprocess.run([
                "podman", "network", "connect", isolation_network, self.container_id
            ], check=True)

        return f"Container {container_name} ({self.container_id}) isolated to {isolation_network} network. Filesystem snapshot saved to {snapshot_dir}"


class RotateCredentialsAction(ResponseAction):
    """Action to rotate potentially compromised credentials"""

    def __init__(self, event: SecurityEvent, config: Dict[str, Any],
                 credential_type: str, identifier: str, metadata: Dict[str, Any] = None):
        super().__init__(event, config)
        self.credential_type = credential_type
        self.identifier = identifier
        self.metadata = metadata or {}

        # Credential rotation always requires verification by default
        auto_rotate_score = config["credentials"]["auto_rotate_score"]
        self.requires_verification = event.severity <= auto_rotate_score

    def _execute_impl(self) -> str:
        """Implement credential rotation"""
        logger.info(f"Rotating {self.credential_type} credentials for {self.identifier}")

        # Check if rotation method is enabled
        rotation_config = self.config["credentials"]["rotation_methods"].get(self.credential_type)
        if not rotation_config or not rotation_config.get("enabled", False):
            raise ValueError(f"Rotation method {self.credential_type} is not enabled or configured")

        # Get rotation script path
        script_path = rotation_config.get("script")
        if not script_path or not os.path.isfile(script_path):
            raise ValueError(f"Rotation script for {self.credential_type} not found at {script_path}")

        # Create temporary file with metadata
        metadata_file = None
        if self.metadata:
            with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
                json.dump(self.metadata, f)
                metadata_file = f.name

        try:
            # Execute rotation script
            cmd = [script_path, self.identifier]
            if metadata_file:
                cmd.append(metadata_file)

            result = subprocess.run(
                cmd, capture_output=True, text=True, check=True
            )

            # Parse and return new credentials if provided
            if result.stdout.strip():
                # Store the new credentials securely
                credentials_dir = Path(self.config["general"]["workspace_dir"]) / "rotated-credentials"
                credentials_dir.mkdir(parents=True, exist_ok=True)

                # Create a secure file for the new credentials
                timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
                credential_file = credentials_dir / f"{self.credential_type}-{self.identifier}-{timestamp}.json"

                # Store with secure permissions
                with open(credential_file, 'w') as f:
                    f.write(result.stdout)
                os.chmod(credential_file, 0o600)  # Only owner can read/write

                return f"Credentials for {self.credential_type}/{self.identifier} rotated successfully. New credentials stored at {credential_file}"

            return f"Credentials for {self.credential_type}/{self.identifier} rotated successfully"

        finally:
            # Clean up metadata file
            if metadata_file and os.path.exists(metadata_file):
                os.unlink(metadata_file)


class ForensicCaptureAction(ResponseAction):
    """Action to capture forensic data for analysis"""

    def __init__(self, event: SecurityEvent, config: Dict[str, Any],
                 target: str, capture_types: List[str] = None):
        super().__init__(event, config)
        self.target = target
        self.capture_types = capture_types or ["network", "process", "filesystem"]

        # Forensic capture generally doesn't need verification
        self.requires_verification = False

    def _execute_impl(self) -> str:
        """Implement forensic data capture"""
        logger.info(f"Capturing forensic data for {self.target}: {', '.join(self.capture_types)}")

        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        target_safe = re.sub(r'[^a-zA-Z0-9_-]', '_', self.target)

        # Create capture directory
        capture_dir = Path(self.config["forensics"]["capture_dir"]) / f"{target_safe}-{timestamp}"
        capture_dir.mkdir(parents=True, exist_ok=True)

        capture_results = []

        # Capture network traffic if requested
        if "network" in self.capture_types:
            try:
                # Determine if target is an IP, hostname, or container
                if re.match(r'^[0-9.]+$', self.target):
                    # Target is an IP address
                    tcpdump_file = capture_dir / f"{target_safe}-network.pcap"
                    tcpdump_cmd = [
                        self.config["forensics"]["tools"]["tcpdump"],
                        "-i", "any", "-w", str(tcpdump_file),
                        f"host {self.target}", "-c", "10000"  # Capture limited packets
                    ]

                    # Start tcpdump in background
                    tcpdump_proc = subprocess.Popen(
                        tcpdump_cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE
                    )

                    # Let it run for up to 60 seconds
                    try:
                        tcpdump_proc.wait(timeout=60)
                    except subprocess.TimeoutExpired:
                        tcpdump_proc.terminate()
                        try:
                            tcpdump_proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            tcpdump_proc.kill()

                    capture_results.append(f"Network traffic captured to {tcpdump_file}")

                elif self.target.startswith("container:"):
                    # Target is a container
                    container_id = self.target.split(":", 1)[1]
                    container_name = container_id

                    # Get container engine
                    engine = self.config["container"]["engine"]

                    if engine == "docker":
                        # Get container network namespace
                        inspect_result = subprocess.run(
                            ["docker", "inspect", "--format", "{{.State.Pid}}", container_id],
                            capture_output=True, text=True, check=True
                        )
                        container_pid = inspect_result.stdout.strip()

                        # Capture container network traffic
                        tcpdump_file = capture_dir / f"{target_safe}-network.pcap"
                        tcpdump_cmd = [
                            "sudo", self.config["forensics"]["tools"]["tcpdump"],
                            "-i", "any", "-w", str(tcpdump_file),
                            "-c", "10000",  # Capture limited packets
                            "-n"
                        ]

                        # Use nsenter to enter container's network namespace
                        nsenter_cmd = [
                            "sudo", "nsenter", "-t", container_pid, "-n"
                        ] + tcpdump_cmd

                        # Run for up to 60 seconds
                        try:
                            subprocess.run(nsenter_cmd, timeout=60, check=True)
                        except subprocess.TimeoutExpired:
                            pass  # We expect this to time out

                        capture_results.append(f"Container network traffic captured to {tcpdump_file}")

            except Exception as e:
                logger.error(f"Error capturing network traffic: {e}")
                capture_results.append(f"Network capture failed: {e}")

        # Capture process information if requested
        if "process" in self.capture_types:
            try:
                process_file = capture_dir / f"{target_safe}-processes.txt"

                if self.target.startswith("container:"):
                    # Target is a container
                    container_id = self.target.split(":", 1)[1]
                    engine = self.config["container"]["engine"]

                    if engine == "docker":
                        # Get process list from container
                        process_cmd = ["docker", "top", container_id, "auxf"]
                    elif engine == "podman":
                        process_cmd = ["podman", "top", container_id, "auxf"]
                else:
                    # Target is a host
                    process_cmd = ["ps", "auxf"]

                # Capture process information
                with open(process_file, 'w') as f:
                    subprocess.run(process_cmd, stdout=f, check=True)

                capture_results.append(f"Process information captured to {process_file}")

                # Additional process details (open files, connections)
                if not self.target.startswith("container:"):
                    # Get open files with lsof
                    lsof_file = capture_dir / f"{target_safe}-open-files.txt"
                    with open(lsof_file, 'w') as f:
                        subprocess.run(["lsof", "-i"], stdout=f, check=False)

                    # Get netstat information
                    netstat_file = capture_dir / f"{target_safe}-connections.txt"
                    with open(netstat_file, 'w') as f:
                        subprocess.run(["netstat", "-antup"], stdout=f, check=False)

                    capture_results.append(f"Additional process details captured")

            except Exception as e:
                logger.error(f"Error capturing process information: {e}")
                capture_results.append(f"Process capture failed: {e}")

        # Capture filesystem information if requested
        if "filesystem" in self.capture_types:
            try:
                if self.target.startswith("container:"):
                    # Target is a container
                    container_id = self.target.split(":", 1)[1]
                    engine = self.config["container"]["engine"]

                    # Export container filesystem
                    fs_archive = capture_dir / f"{target_safe}-fs.tar"

                    if engine == "docker":
                        subprocess.run(
                            ["docker", "export", "-o", str(fs_archive), container_id],
                            check=True
                        )
                    elif engine == "podman":
                        subprocess.run(
                            ["podman", "export", "-o", str(fs_archive), container_id],
                            check=True
                        )

                    capture_results.append(f"Container filesystem captured to {fs_archive}")

                else:
                    # Target is a host or directory
                    # Just capture file listings and metadata to avoid space issues
                    fs_listing = capture_dir / f"{target_safe}-files.txt"

                    if os.path.isdir(self.target):
                        # Capture listing of specified directory
                        with open(fs_listing, 'w') as f:
                            subprocess.run(
                                ["find", self.target, "-type", "f", "-ls"],
                                stdout=f, check=True
                            )
                    else:
                        # Capture listing of common directories
                        with open(fs_listing, 'w') as f:
                            for directory in ["/tmp", "/var/tmp", "/home"]:
                                f.write(f"\n\n=== Directory: {directory} ===\n\n")
                                try:
                                    subprocess.run(
                                        ["find", directory, "-type", "f", "-mtime", "-2", "-ls"],
                                        stdout=f, check=False
                                    )
                                except subprocess.SubprocessError:
                                    f.write(f"Error listing {directory}\n")

                    capture_results.append(f"Filesystem information captured to {fs_listing}")

                    # Capture file integrity information if available
                    try:
                        aide_file = capture_dir / f"{target_safe}-aide.txt"
                        with open(aide_file, 'w') as f:
                            subprocess.run(["aide", "--check"], stdout=f, stderr=subprocess.STDOUT, check=False)
                        capture_results.append(f"File integrity information captured to {aide_file}")
                    except (subprocess.SubprocessError, FileNotFoundError):
                        # AIDE might not be installed, that's ok
                        pass

            except Exception as e:
                logger.error(f"Error capturing filesystem information: {e}")
                capture_results.append(f"Filesystem capture failed: {e}")

        # Create metadata file with capture information
        metadata = {
            "event_id": self.event.id,
            "event_type": self.event.event_type,
            "target": self.target,
            "capture_types": self.capture_types,
            "timestamp": timestamp,
            "results": capture_results
        }

        with open(capture_dir / "metadata.json", 'w') as f:
            json.dump(metadata, f, indent=2)

        # Check total size and warn if too large
        total_size = sum(f.stat().st_size for f in capture_dir.glob('**/*') if f.is_file())
        size_gb = total_size / (1024 ** 3)

        if size_gb > self.config["forensics"]["max_capture_size_gb"]:
            logger.warning(f"Forensic capture size ({size_gb:.2f} GB) exceeds configured maximum")

        return f"Forensic data captured to {capture_dir}: {'; '.join(capture_results)}"


class ExecutePlaybookAction(ResponseAction):
    """Action to execute a predefined response playbook"""

    def __init__(self, event: SecurityEvent, config: Dict[str, Any],
                 playbook_name: str, parameters: Dict[str, Any] = None):
        super().__init__(event, config)
        self.playbook_name = playbook_name
        self.parameters = parameters or {}

        # Playbook execution generally requires verification
        auto_execute_score = config["playbooks"]["auto_execute_score"]
        self.requires_verification = event.severity <= auto_execute_score

    def _execute_impl(self) -> str:
        """Implement playbook execution"""
        logger.info(f"Executing response playbook: {self.playbook_name}")

        # Check if playbook exists
        available_playbooks = self.config["playbooks"]["available"]
        if self.playbook_name not in available_playbooks:
            raise ValueError(f"Playbook '{self.playbook_name}' not found in available playbooks")

        playbook_script = available_playbooks[self.playbook_name]
        playbook_path = os.path.join(self.config["playbooks"]["dir"], playbook_script)

        if not os.path.isfile(playbook_path):
            raise ValueError(f"Playbook script not found at {playbook_path}")

        # Create parameter file
        parameter_file = None
        if self.parameters:
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
                json.dump(self.parameters, f)
                parameter_file = f.name

        try:
            # Execute playbook
            cmd = [playbook_path]
            if parameter_file:
                cmd.append(parameter_file)

            # Add event ID as parameter
            cmd.append(self.event.id)

            # Execute and capture output
            result = subprocess.run(
                cmd, capture_output=True, text=True, check=True
            )

            return f"Playbook {self.playbook_name} executed successfully: {result.stdout.strip()}"

        finally:
            # Clean up parameter file
            if parameter_file and os.path.exists(parameter_file):
                os.unlink(parameter_file)


class SecurityResponseManager:
    """Manages security response actions and workflows"""

    def __init__(self, config_path: Optional[str] = None):
        # Load configuration
        self.config = DEFAULT_CONFIG.copy()
        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    user_config = json.load(f)
                    self._merge_configs(self.config, user_config)
                logger.info(f"Loaded configuration from {config_path}")
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Error loading config file: {e}")

        # Initialize workspace
        self.workspace_dir = Path(self.config["general"]["workspace_dir"])
        self.events_dir = self.workspace_dir / "events"
        self.actions_dir = self.workspace_dir / "actions"
        self._init_workspace()

        # Initialize notification manager
        self.notification_manager = NotificationManager(self.config)

    def _merge_configs(self, base: Dict, update: Dict) -> None:
        """Recursively merge configuration dictionaries"""
        for key, value in update.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._merge_configs(base[key], value)
            else:
                base[key] = value

    def _init_workspace(self) -> None:
        """Initialize workspace directories"""
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.events_dir.mkdir(parents=True, exist_ok=True)
        self.actions_dir.mkdir(parents=True, exist_ok=True)

        # Make sure forensics dir exists
        Path(self.config["forensics"]["capture_dir"]).mkdir(parents=True, exist_ok=True)

    def handle_security_event(self, event: SecurityEvent) -> str:
        """Process a security event and determine appropriate responses"""
        logger.info(f"Handling security event: {event.event_type} from {event.source} with severity {event.severity}")

        # Save event to disk
        self._save_event(event)

        # Notify about the event
        self.notification_manager.send_event_notification(event)

        # Determine appropriate response actions
        actions = self._determine_response_actions(event)

        # Execute actions that don't require verification
        for action in actions:
            if not action.requires_human_verification():
                result = self._execute_action(action)
                if result:
                    logger.info(f"Automatic action {action.name} completed successfully")
                else:
                    logger.error(f"Automatic action {action.name} failed")
            else:
                logger.info(f"Action {action.name} requires human verification")
                # Save action for later verification
                self._save_action(action)
                # Notify about pending verification
                self.notification_manager.send_verification_notification(event, action)

        return event.id

    def _determine_response_actions(self, event: SecurityEvent) -> List[ResponseAction]:
        """Determine appropriate response actions based on the event"""
        actions = []

        # Determine actions based on event type
        if event.event_type == "suspicious_ip":
            # Block suspicious IP
            ip_address = event.details.get("ip_address")
            if ip_address:
                actions.append(BlockIPAction(event, self.config, ip_address))

                # Capture network traffic from suspicious IP
                if self.config["forensics"]["auto_capture"]:
                    actions.append(ForensicCaptureAction(
                        event, self.config, ip_address, ["network"]
                    ))

        elif event.event_type == "compromised_container":
            # Isolate compromised container
            container_id = event.details.get("container_id")
            if container_id:
                actions.append(IsolateContainerAction(event, self.config, container_id))

                # Capture forensic data from container
                if self.config["forensics"]["auto_capture"]:
                    actions.append(ForensicCaptureAction(
                        event, self.config, f"container:{container_id}",
                        ["network", "process", "filesystem"]
                    ))

        elif event.event_type == "credential_compromise":
            # Rotate compromised credentials
            cred_type = event.details.get("credential_type")
            identifier = event.details.get("identifier")
            if cred_type and identifier:
                actions.append(RotateCredentialsAction(
                    event, self.config, cred_type, identifier, event.details.get("metadata")
                ))

        elif event.event_type == "malware_detection":
            # Execute malware response playbook
            if "malware_detection" in self.config["playbooks"]["available"]:
                actions.append(ExecutePlaybookAction(
                    event, self.config, "malware_detection", event.details
                ))

            # Capture forensic data
            if self.config["forensics"]["auto_capture"]:
                target = event.details.get("target") or event.source
                actions.append(ForensicCaptureAction(
                    event, self.config, target, ["process", "filesystem"]
                ))

        elif event.event_type == "unauthorized_access":
            # Execute unauthorized access playbook
            if "unauthorized_access" in self.config["playbooks"]["available"]:
                actions.append(ExecutePlaybookAction(
                    event, self.config, "unauthorized_access", event.details
                ))

            # Block IP if present
            ip_address = event.details.get("ip_address")
            if ip_address:
                actions.append(BlockIPAction(event, self.config, ip_address))

        elif event.event_type == "data_exfiltration":
            # Execute data exfiltration playbook
            if "data_exfiltration" in self.config["playbooks"]["available"]:
                actions.append(ExecutePlaybookAction(
                    event, self.config, "data_exfiltration", event.details
                ))

            # Block IP if present
            ip_address = event.details.get("destination_ip")
            if ip_address:
                actions.append(BlockIPAction(event, self.config, ip_address))

        # For any event, we can run appropriate playbooks if configured
        playbook = event.details.get("suggested_playbook")
        if playbook and playbook in self.config["playbooks"]["available"]:
            actions.append(ExecutePlaybookAction(
                event, self.config, playbook, event.details
            ))

        return actions

    def _save_event(self, event: SecurityEvent) -> None:
        """Save event to disk"""
        event_file = self.events_dir / f"{event.id}.json"
        with open(event_file, 'w') as f:
            json.dump(event.to_dict(), f, indent=2)

    def _save_action(self, action: ResponseAction) -> None:
        """Save action to disk"""
        action_file = self.actions_dir / f"{action.id}.json"
        with open(action_file, 'w') as f:
            data = {
                "action": action.to_dict(),
                "event_id": action.event.id
            }
            json.dump(data, f, indent=2)

    def _execute_action(self, action: ResponseAction) -> bool:
        """Execute a response action"""
        try:
            result = action.execute()
            self._save_action(action)  # Save updated action state

            # Update event with action result
            event = action.event
            event.response_actions.append({
                "action_id": action.id,
                "name": action.name,
                "status": action.status,
                "result": action.result
            })
            self._save_event(event)

            # Send notification about action result
            self.notification_manager.send_action_notification(action)

            return result
        except Exception as e:
            logger.error(f"Error executing action {action.name}: {e}", exc_info=True)
            return False

    def verify_action(self, action_id: str, approve: bool, user: str) -> bool:
        """Verify a pending action (approve or reject)"""
        # Load action from disk
        action_file = self.actions_dir / f"{action_id}.json"
        if not action_file.exists():
            logger.error(f"Action file not found: {action_id}")
            return False

        try:
            with open(action_file, 'r') as f:
                data = json.load(f)

            # Load corresponding event
            event_id = data.get("event_id")
            event_file = self.events_dir / f"{event_id}.json"

            if not event_file.exists():
                logger.error(f"Event file not found: {event_id}")
                return False

            with open(event_file, 'r') as f:
                event_data = json.load(f)
                event = SecurityEvent.from_dict(event_data)

            # Recreate the action object
            action_type = data["action"]["name"]
            action_class = globals().get(action_type)

            if not action_class:
                logger.error(f"Unknown action type: {action_type}")
                return False

            # We need to reconstruct the action - this is simplified and might need adjustments
            action = action_class(event, self.config, "placeholder")
            action.id = action_id
            action.status = data["action"]["status"]
            action.verification_status = "approved" if approve else "rejected"

            if approve:
                # Execute the action
                result = self._execute_action(action)
                logger.info(f"Verified action {action_id} executed: {result}")
                return result
            else:
                # Update action status to rejected
                action.status = "rejected"
                self._save_action(action)

                # Update event with action result
                event.response_actions.append({
                    "action_id": action.id,
                    "name": action.name,
                    "status": action.status,
                    "result": "Action rejected by user"
                })
                self._save_event(event)

                logger.info(f"Action {action_id} rejected by user {user}")
                return True

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.error(f"Error verifying action {action_id}: {e}", exc_info=True)
            return False

    def list_pending_actions(self) -> List[Dict[str, Any]]:
        """List all actions pending verification"""
        pending = []

        for action_file in self.actions_dir.glob("*.json"):
            try:
                with open(action_file, 'r') as f:
                    data = json.load(f)

                action = data["action"]
                if action["verification_status"] == "pending" and action["requires_verification"]:
                    # Load corresponding event for context
                    event_id = data.get("event_id")
                    event_file = self.events_dir / f"{event_id}.json"

                    event_info = {}
                    if event_file.exists():
                        with open(event_file, 'r') as f:
                            event_data = json.load(f)
                            event_info = {
                                "id": event_data["id"],
                                "type": event_data["event_type"],
                                "source": event_data["source"],
                                "severity": event_data["severity"],
                                "timestamp": event_data["timestamp"]
                            }

                    pending.append({
                        "action_id": action["id"],
                        "action_name": action["name"],
                        "event": event_info,
                        "status": action["status"]
                    })
            except (json.JSONDecodeError, KeyError) as e:
                logger.error(f"Error reading action file {action_file}: {e}")

        return pending

    def clean_old_events(self, days: int = 30) -> int:
        """Clean up events and actions older than specified days"""
        cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
        count = 0

        # Clean up old events
        for event_file in self.events_dir.glob("*.json"):
            try:
                with open(event_file, 'r') as f:
                    data = json.load(f)

                timestamp = datetime.datetime.fromisoformat(data["timestamp"])
                if timestamp < cutoff:
                    event_file.unlink()
                    count += 1
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                logger.error(f"Error reading event file {event_file}: {e}")

        # Clean up corresponding actions
        for action_file in self.actions_dir.glob("*.json"):
            try:
                with open(action_file, 'r') as f:
                    data = json.load(f)

                event_id = data.get("event_id")
                event_file = self.events_dir / f"{event_id}.json"

                if not event_file.exists():
                    action_file.unlink()
            except (json.JSONDecodeError, KeyError) as e:
                logger.error(f"Error reading action file {action_file}: {e}")

        logger.info(f"Cleaned up {count} old events")
        return count


class NotificationManager:
    """Manages notifications for security events and actions"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config

    def send_event_notification(self, event: SecurityEvent) -> None:
        """Send notification about a new security event"""
        subject = f"[SECURITY EVENT] {event.event_type}: {event.severity} severity"
        message = f"""
Security Event Detected

Type: {event.event_type}
Severity: {event.severity}
Source: {event.source}
Time: {event.timestamp.strftime('%Y-%m-%d %H:%M:%S')}

Details:
{json.dumps(event.details, indent=2)}

ID: {event.id}

This is an automated message from your Homelab Security Response System.
"""
        self._send_notification(subject, message, event.severity)

    def send_verification_notification(self, event: SecurityEvent, action: ResponseAction) -> None:
        """Send notification about an action requiring verification"""
        subject = f"[ACTION REQUIRED] Security Response Action Verification"
        message = f"""
Security Response Action Requires Verification

Event Type: {event.event_type}
Severity: {event.severity}
Source: {event.source}
Time: {event.timestamp.strftime('%Y-%m-%d %H:%M:%S')}

Proposed Action: {action.name}
Action ID: {action.id}

To approve this action, run:
python3 {__file__} verify-action --action {action.id} --approve

To reject this action, run:
python3 {__file__} verify-action --action {action.id} --reject

This is an automated message from your Homelab Security Response System.
"""
        self._send_notification(subject, message, event.severity)

    def send_action_notification(self, action: ResponseAction) -> None:
        """Send notification about action execution results"""
        event = action.event
        subject = f"[SECURITY ACTION] {action.name} {action.status.upper()}"
        message = f"""
Security Response Action Completed

Action: {action.name}
Status: {action.status}
Event Type: {event.event_type}
Severity: {event.severity}
Source: {event.source}

Result: {action.result or "No result information"}

Start Time: {action.start_time.strftime('%Y-%m-%d %H:%M:%S') if action.start_time else "N/A"}
End Time: {action.end_time.strftime('%Y-%m-%d %H:%M:%S') if action.end_time else "N/A"}

{f"Error: {action.error}" if action.error else ""}

This is an automated message from your Homelab Security Response System.
"""
        self._send_notification(subject, message, event.severity)

    def _send_notification(self, subject: str, message: str, severity: int = 50) -> None:
        """Send notification through configured channels"""
        # Log the notification
        logger.info(f"Notification: {subject}")

        # Send email if configured
        email_config = self.config["notification"]["methods"]["email"]
        if email_config.get("enabled"):
            self._send_email(subject, message, email_config)

        # Send Slack if configured
        slack_config = self.config["notification"]["methods"]["slack"]
        if slack_config.get("enabled") and slack_config.get("webhook_url"):
            self._send_slack(subject, message, severity, slack_config)

        # Send SMS if configured
        sms_config = self.config["notification"]["methods"]["sms"]
        if sms_config.get("enabled") and sms_config.get("api_key") and sms_config.get("phone_numbers"):
            self._send_sms(subject, message, sms_config)

    def _send_email(self, subject: str, message: str, config: Dict[str, Any]) -> None:
        """Send email notification"""
        try:
            msg = MIMEMultipart()
            msg['Subject'] = subject
            msg['From'] = config["sender"]
            msg['To'] = ", ".join(config["recipients"])

            msg.attach(MIMEText(message))

            with smtplib.SMTP(config["smtp_server"], config["smtp_port"]) as smtp:
                smtp.send_message(msg)

            logger.debug(f"Email notification sent to {config['recipients']}")
        except Exception as e:
            logger.error(f"Failed to send email notification: {e}", exc_info=True)

    def _send_slack(self, subject: str, message: str, severity: int, config: Dict[str, Any]) -> None:
        """Send Slack notification"""
        try:
            # Determine color based on severity
            color = "#36a64f"  # Green for low severity
            if severity >= 70:
                color = "#ff0000"  # Red for high severity
            elif severity >= 40:
                color = "#ff9400"  # Orange for medium severity

            # Format message for Slack
            payload = {
                "attachments": [
                    {
                        "color": color,
                        "title": subject,
                        "text": message,
                        "footer": "Homelab Security Response",
                        "ts": int(time.time())
                    }
                ]
            }

            # Send to webhook
            webhook_url = config["webhook_url"]
            subprocess.run(
                ["curl", "-s", "-X", "POST",
                 "--data-urlencode", f"payload={json.dumps(payload)}",
                 webhook_url],
                check=True
            )

            logger.debug("Slack notification sent")
        except Exception as e:
            logger.error(f"Failed to send Slack notification: {e}", exc_info=True)

    def _send_sms(self, subject: str, message: str, config: Dict[str, Any]) -> None:
        """Send SMS notification - simplified implementation using a hypothetical API"""
        try:
            # This is a placeholder for SMS notification
            # In a real implementation, you'd use a service like Twilio, AWS SNS, etc.
            logger.info(f"SMS would be sent to {config['phone_numbers']} with message: {subject}")

            # Example using a generic SMS API (pseudo-code)
            api_key = config["api_key"]
            for phone in config["phone_numbers"]:
                # Truncate message to fit SMS
                sms_message = f"{subject}: {message[:100]}..." if len(message) > 100 else f"{subject}: {message}"

                # Call SMS API (this is a stub)
                logger.debug(f"Would send SMS to {phone}: {sms_message}")

        except Exception as e:
            logger.error(f"Failed to send SMS notification: {e}", exc_info=True)


def create_sample_event(event_type: str, source: str, details: Dict[str, Any] = None, severity: int = 50) -> SecurityEvent:
    """Helper function to create a sample security event"""
    return SecurityEvent(
        event_type=event_type,
        source=source,
        details=details or {},
        severity=severity
    )


def main() -> None:
    """Main entry point for command-line execution"""
    parser = argparse.ArgumentParser(description="Homelab Security Response Automation")

    # Create subparsers for different commands
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Handle event command
    event_parser = subparsers.add_parser("handle-event", help="Handle a security event")
    event_parser.add_argument("--type", required=True, help="Event type")
    event_parser.add_argument("--source", required=True, help="Event source")
    event_parser.add_argument("--severity", type=int, default=50, help="Event severity (0-100)")
    event_parser.add_argument("--details", help="Event details in JSON format")

    # Verify action command
    verify_parser = subparsers.add_parser("verify-action", help="Verify a pending action")
    verify_parser.add_argument("--action", required=True, help="Action ID to verify")
    verify_parser.add_argument("--approve", action="store_true", help="Approve the action")
    verify_parser.add_argument("--reject", action="store_true", help="Reject the action")
    verify_parser.add_argument("--user", help="User performing verification")

    # List pending actions command
    list_parser = subparsers.add_parser("list-pending", help="List pending actions")

    # Test command
    test_parser = subparsers.add_parser("test", help="Run a test scenario")
    test_parser.add_argument("--scenario", choices=["ip", "container", "credentials", "malware", "all"],
                           default="all", help="Test scenario to run")

    # Clean command
    clean_parser = subparsers.add_parser("clean", help="Clean up old events")
    clean_parser.add_argument("--days", type=int, default=30, help="Age in days for cleanup")

    # Add common arguments
    parser.add_argument("--config", help="Path to configuration file")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument("--dry-run", action="store_true", help="Don't execute actions, just log")

    args = parser.parse_args()

    # Configure logging level
    if args.verbose:
        logger.setLevel(logging.DEBUG)

    # Initialize security response manager
    manager = SecurityResponseManager(config_path=args.config)

    # Override dry run mode if specified
    if args.dry_run:
        manager.config["general"]["dry_run"] = True
        logger.info("Running in dry-run mode - no actions will be executed")

    # Process commands
    if args.command == "handle-event":
        # Parse event details
        details = {}
        if args.details:
            try:
                details = json.loads(args.details)
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON in details: {args.details}")
                sys.exit(1)

        # Create and handle event
        event = SecurityEvent(
            event_type=args.type,
            source=args.source,
            details=details,
            severity=args.severity
        )

        event_id = manager.handle_security_event(event)
        print(f"Event handled with ID: {event_id}")

    elif args.command == "verify-action":
        if not args.approve and not args.reject:
            logger.error("Must specify either --approve or --reject")
            sys.exit(1)

        if args.approve and args.reject:
            logger.error("Cannot both approve and reject an action")
            sys.exit(1)

        user = args.user or getpass.getuser()
        result = manager.verify_action(
            args.action,
            approve=args.approve,
            user=user
        )

        if result:
            action_status = "approved" if args.approve else "rejected"
            print(f"Action {args.action} {action_status} successfully")
        else:
            print(f"Failed to verify action {args.action}")
            sys.exit(1)

    elif args.command == "list-pending":
        pending = manager.list_pending_actions()
        if pending:
            print(f"Found {len(pending)} pending actions:")
            for action in pending:
                event = action["event"]
                print(f"  - {action['action_name']} (ID: {action['action_id']})")
                print(f"    Event: {event['type']} from {event['source']} (Severity: {event['severity']})")
                print(f"    Status: {action['status']}")
                print()
        else:
            print("No pending actions found")

    elif args.command == "test":
        print(f"Running test scenario: {args.scenario}")

        # Run the selected test scenario(s)
        if args.scenario in ["ip", "all"]:
            # Test suspicious IP scenario
            event = create_sample_event(
                "suspicious_ip",
                "firewall",
                {
                    "ip_address": "203.0.113.42",
                    "reason": "Port scanning activity",
                    "ports_scanned": [22, 80, 443, 8080],
                    "timestamp": datetime.datetime.now().isoformat()
                },
                severity=75
            )
            manager.handle_security_event(event)
            print("Suspicious IP scenario triggered")

        if args.scenario in ["container", "all"]:
            # Test compromised container scenario
            event = create_sample_event(
                "compromised_container",
                "container-monitor",
                {
                    "container_id": "test_container_id",
                    "container_name": "test_container",
                    "indicators": ["Unusual network activity", "Modified binary files"],
                    "timestamp": datetime.datetime.now().isoformat()
                },
                severity=85
            )
            manager.handle_security_event(event)
            print("Compromised container scenario triggered")

        if args.scenario in ["credentials", "all"]:
            # Test credential compromise scenario
            event = create_sample_event(
                "credential_compromise",
                "auth-monitor",
                {
                    "credential_type": "system_user",
                    "identifier": "test_user",
                    "indicators": ["Login from unusual location", "Unusual access time"],
                    "timestamp": datetime.datetime.now().isoformat(),
                    "metadata": {
                        "user_id": 1001,
                        "group_id": 1001,
                        "shell": "/bin/bash"
                    }
                },
                severity=65
            )
            manager.handle_security_event(event)
            print("Credential compromise scenario triggered")

        if args.scenario in ["malware", "all"]:
            # Test malware detection scenario
            event = create_sample_event(
                "malware_detection",
                "malware-scanner",
                {
                    "target": "/tmp/suspicious_file.bin",
                    "hash": "aabbccddeeff00112233445566778899",
                    "malware_type": "backdoor",
                    "timestamp": datetime.datetime.now().isoformat(),
                    "suggested_playbook": "malware_detection"
                },
                severity=95
            )
            manager.handle_security_event(event)
            print("Malware detection scenario triggered")

        print("Test scenario(s) completed. Check logs for details and pending actions.")

    elif args.command == "clean":
        count = manager.clean_old_events(args.days)
        print(f"Cleaned up {count} old events and associated actions")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
