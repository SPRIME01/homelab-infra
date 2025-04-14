#!/usr/bin/env python3
"""
Lightweight Intrusion Detection System for Homelab

This script provides a resource-efficient intrusion detection system for homelab
environments, analyzing logs, network traffic, and system behavior to detect
potential security threats.

Features:
- Log analysis for suspicious patterns
- Network traffic monitoring
- Privilege escalation detection
- Unauthorized access attempt identification
- Security anomaly alerting
- Integration with existing observability stack
"""

import os
import re
import time
import json
import socket
import logging
import argparse
import ipaddress
import subprocess
import threading
from datetime import datetime, timedelta
from collections import defaultdict, deque
from typing import Dict, List, Set, Tuple, Any, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("/var/log/homelab/ids.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("homelab-ids")

# Constants
DEFAULT_CONFIG = {
    "log_paths": [
        "/var/log/auth.log",
        "/var/log/syslog",
        "/var/log/traefik/access.log",
        "/var/log/apache2/access.log",
    ],
    "network_interfaces": ["eth0", "wlan0"],
    "check_interval": 60,  # seconds
    "ip_whitelist": ["192.168.1.0/24"],
    "suspicious_commands": [
        "chmod +s", "chmod u+s", "chmod g+s",
        "chown root", "usermod -G sudo", "usermod -G wheel",
        "visudo", "iptables -F", "ufw disable",
        "nc -l", "ncat -l", "python -m http.server",
        "curl -O", "wget http", "base64 -d"
    ],
    "alert_thresholds": {
        "failed_logins": 5,
        "ssh_attempts": 3,
        "suspicious_commands": 2,
        "network_scan_attempts": 10,
        "new_services": 1,
        "new_users": 1
    },
    "data_retention_days": 7,
    "observability": {
        "prometheus_pushgateway": "http://localhost:9091",
        "enable_metrics": True,
        "enable_slack": False,
        "slack_webhook": "",
        "enable_email": False,
        "email_to": [],
        "email_from": "ids@homelab.local",
        "smtp_server": "localhost"
    }
}

class DetectionState:
    """Maintains the state needed for detection across runs"""

    def __init__(self, state_file: str = "/var/lib/homelab/ids_state.json"):
        self.state_file = state_file
        self.state_dir = os.path.dirname(state_file)
        self.failed_logins = defaultdict(int)
        self.ssh_attempts = defaultdict(int)
        self.network_connections = defaultdict(int)
        self.known_users = set()
        self.known_services = set()
        self.log_positions = {}
        self.alerts_sent = set()
        self.load_state()

    def load_state(self) -> None:
        """Load the detection state from file"""
        if not os.path.exists(self.state_dir):
            os.makedirs(self.state_dir, exist_ok=True)

        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, 'r') as f:
                    data = json.load(f)
                    self.failed_logins = defaultdict(int, data.get('failed_logins', {}))
                    self.ssh_attempts = defaultdict(int, data.get('ssh_attempts', {}))
                    self.network_connections = defaultdict(int, data.get('network_connections', {}))
                    self.known_users = set(data.get('known_users', []))
                    self.known_services = set(data.get('known_services', []))
                    self.log_positions = data.get('log_positions', {})
                    self.alerts_sent = set(data.get('alerts_sent', []))
                    logger.info(f"Loaded state from {self.state_file}")
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Failed to load state: {e}")
                # Create a backup if file exists but is corrupt
                if os.path.exists(self.state_file):
                    backup_file = f"{self.state_file}.bak.{int(time.time())}"
                    os.rename(self.state_file, backup_file)
                    logger.info(f"Created backup of corrupt state file: {backup_file}")

    def save_state(self) -> None:
        """Save the detection state to file"""
        try:
            data = {
                'failed_logins': dict(self.failed_logins),
                'ssh_attempts': dict(self.ssh_attempts),
                'network_connections': dict(self.network_connections),
                'known_users': list(self.known_users),
                'known_services': list(self.known_services),
                'log_positions': self.log_positions,
                'alerts_sent': list(self.alerts_sent),
                'last_updated': datetime.now().isoformat()
            }

            with open(self.state_file, 'w') as f:
                json.dump(data, f)
                logger.debug(f"Saved state to {self.state_file}")
        except IOError as e:
            logger.error(f"Failed to save state: {e}")

    def clean_old_data(self, days: int = 7) -> None:
        """Remove data older than specified days"""
        cutoff = datetime.now() - timedelta(days=days)
        cutoff_str = cutoff.isoformat()

        # Clean up old alerts
        self.alerts_sent = {
            alert for alert in self.alerts_sent
            if alert.split('|')[0] > cutoff_str
        }

        # We'd clean other time-based data here if we tracked timestamps for each entry
        logger.debug(f"Cleaned state data older than {days} days")


class LogAnalyzer:
    """Analyzes log files for suspicious activities"""

    def __init__(self, state: DetectionState, config: dict):
        self.state = state
        self.config = config
        self.patterns = {
            'failed_login': re.compile(r'Failed password for .* from (\S+)'),
            'ssh_attempt': re.compile(r'.*sshd.*: Invalid user .* from (\S+)'),
            'sudo_command': re.compile(r'sudo:\s+(\S+).* COMMAND=(.*)'),
            'user_add': re.compile(r'useradd.*?(\S+)'),
            'user_mod': re.compile(r'usermod.*?(\S+)'),
            'service_start': re.compile(r'systemd.*: Started (.*)\.'),
            'service_enable': re.compile(r'systemd.*: Enabling (.*)\.'),
        }

    def analyze_logs(self) -> List[Dict[str, Any]]:
        """Analyze log files for suspicious patterns and return alerts"""
        alerts = []

        for log_path in self.config["log_paths"]:
            if not os.path.exists(log_path):
                logger.debug(f"Log file does not exist: {log_path}")
                continue

            last_position = self.state.log_positions.get(log_path, 0)
            current_position = os.path.getsize(log_path)

            # Skip if the file hasn't changed or has been rotated
            if current_position <= last_position:
                logger.debug(f"Log file hasn't changed or was rotated: {log_path}")
                self.state.log_positions[log_path] = current_position
                continue

            try:
                with open(log_path, 'r') as f:
                    f.seek(last_position)
                    new_lines = f.readlines()

                alerts.extend(self._process_log_lines(log_path, new_lines))
                self.state.log_positions[log_path] = current_position
                logger.debug(f"Processed {len(new_lines)} new lines in {log_path}")
            except IOError as e:
                logger.error(f"Error reading log file {log_path}: {e}")

        return alerts

    def _process_log_lines(self, log_path: str, lines: List[str]) -> List[Dict[str, Any]]:
        """Process log lines and detect suspicious patterns"""
        alerts = []
        timestamp = datetime.now().isoformat()

        for line in lines:
            # Check for failed logins
            match = self.patterns['failed_login'].search(line)
            if match:
                ip = match.group(1)
                self.state.failed_logins[ip] += 1
                if self.state.failed_logins[ip] >= self.config["alert_thresholds"]["failed_logins"]:
                    alert_id = f"{timestamp}|failed_login|{ip}"
                    if alert_id not in self.state.alerts_sent:
                        alerts.append({
                            "type": "failed_login",
                            "source": ip,
                            "message": f"Multiple failed login attempts from {ip}",
                            "count": self.state.failed_logins[ip],
                            "log": log_path,
                            "severity": "medium"
                        })
                        self.state.alerts_sent.add(alert_id)

            # Check for SSH brute force attempts
            match = self.patterns['ssh_attempt'].search(line)
            if match:
                ip = match.group(1)
                self.state.ssh_attempts[ip] += 1
                if self.state.ssh_attempts[ip] >= self.config["alert_thresholds"]["ssh_attempts"]:
                    alert_id = f"{timestamp}|ssh_attempt|{ip}"
                    if alert_id not in self.state.alerts_sent:
                        alerts.append({
                            "type": "ssh_attempt",
                            "source": ip,
                            "message": f"Multiple invalid SSH login attempts from {ip}",
                            "count": self.state.ssh_attempts[ip],
                            "log": log_path,
                            "severity": "high"
                        })
                        self.state.alerts_sent.add(alert_id)

            # Check for sudo commands
            match = self.patterns['sudo_command'].search(line)
            if match:
                user = match.group(1)
                command = match.group(2)

                # Check for suspicious commands
                for suspicious_cmd in self.config["suspicious_commands"]:
                    if suspicious_cmd in command:
                        alert_id = f"{timestamp}|suspicious_command|{user}|{suspicious_cmd}"
                        if alert_id not in self.state.alerts_sent:
                            alerts.append({
                                "type": "suspicious_command",
                                "source": user,
                                "message": f"User {user} executed suspicious command: {command}",
                                "command": command,
                                "log": log_path,
                                "severity": "high"
                            })
                            self.state.alerts_sent.add(alert_id)

            # Check for new user additions
            match = self.patterns['user_add'].search(line)
            if match:
                new_user = match.group(1)
                if new_user not in self.state.known_users:
                    self.state.known_users.add(new_user)
                    alert_id = f"{timestamp}|new_user|{new_user}"
                    if alert_id not in self.state.alerts_sent:
                        alerts.append({
                            "type": "new_user",
                            "source": "system",
                            "message": f"New user created: {new_user}",
                            "user": new_user,
                            "log": log_path,
                            "severity": "medium"
                        })
                        self.state.alerts_sent.add(alert_id)

            # Check for new service starts
            match = self.patterns['service_start'].search(line) or self.patterns['service_enable'].search(line)
            if match:
                service = match.group(1)
                if service not in self.state.known_services:
                    self.state.known_services.add(service)
                    alert_id = f"{timestamp}|new_service|{service}"
                    if alert_id not in self.state.alerts_sent:
                        alerts.append({
                            "type": "new_service",
                            "source": "system",
                            "message": f"New service detected: {service}",
                            "service": service,
                            "log": log_path,
                            "severity": "low"
                        })
                        self.state.alerts_sent.add(alert_id)

        return alerts


class NetworkMonitor:
    """Monitors network traffic for suspicious patterns"""

    def __init__(self, state: DetectionState, config: dict):
        self.state = state
        self.config = config
        self.ip_whitelist = [ipaddress.ip_network(net) for net in config["ip_whitelist"]]
        self.connection_history = defaultdict(lambda: deque(maxlen=100))

    def check_network(self) -> List[Dict[str, Any]]:
        """Check for suspicious network activities"""
        alerts = []
        timestamp = datetime.now().isoformat()

        # Get current network connections
        connections = self._get_network_connections()

        # Monitor for port scanning
        scanner_ips = self._detect_port_scanning(connections)
        for ip, ports in scanner_ips.items():
            if len(ports) >= self.config["alert_thresholds"]["network_scan_attempts"]:
                alert_id = f"{timestamp}|port_scan|{ip}"
                if alert_id not in self.state.alerts_sent:
                    alerts.append({
                        "type": "port_scan",
                        "source": ip,
                        "message": f"Potential port scan from {ip}, accessed {len(ports)} different ports",
                        "ports": list(ports),
                        "severity": "high"
                    })
                    self.state.alerts_sent.add(alert_id)

        # Check for unusual outbound connections
        unusual = self._detect_unusual_connections(connections)
        for conn, details in unusual.items():
            alert_id = f"{timestamp}|unusual_connection|{conn}"
            if alert_id not in self.state.alerts_sent:
                alerts.append({
                    "type": "unusual_connection",
                    "source": details["local_ip"],
                    "destination": details["remote_ip"],
                    "message": f"Unusual outbound connection from {details['process']} to {details['remote_ip']}:{details['remote_port']}",
                    "process": details["process"],
                    "severity": "medium"
                })
                self.state.alerts_sent.add(alert_id)

        return alerts

    def _get_network_connections(self) -> List[Dict[str, Any]]:
        """Get current network connections using ss or netstat"""
        connections = []
        try:
            # Try ss command first (more modern)
            output = subprocess.check_output(
                ["ss", "-tunp"],
                stderr=subprocess.STDOUT,
                universal_newlines=True
            )

            for line in output.splitlines()[1:]:  # Skip header
                parts = line.split()
                if len(parts) < 5:
                    continue

                state = parts[0]
                proto = parts[1]

                # Parse local and remote addresses
                local = parts[3]
                remote = parts[4]
                local_ip, local_port = local.rsplit(':', 1)
                remote_ip, remote_port = remote.rsplit(':', 1)

                # Get process info if available
                process = "unknown"
                if len(parts) >= 6 and "users:" in parts[5]:
                    proc_match = re.search(r'users:\(\("([^"]+)"', parts[5])
                    if proc_match:
                        process = proc_match.group(1)

                connections.append({
                    "proto": proto,
                    "state": state,
                    "local_ip": local_ip,
                    "local_port": int(local_port),
                    "remote_ip": remote_ip,
                    "remote_port": int(remote_port),
                    "process": process
                })

        except (subprocess.SubprocessError, ValueError) as e:
            logger.error(f"Error getting network connections: {e}")
            # Fallback to netstat if ss fails
            try:
                output = subprocess.check_output(
                    ["netstat", "-tunp"],
                    stderr=subprocess.STDOUT,
                    universal_newlines=True
                )

                for line in output.splitlines()[2:]:  # Skip headers
                    parts = line.split()
                    if len(parts) < 7:
                        continue

                    proto = parts[0]
                    local = parts[3]
                    remote = parts[4]
                    state = parts[5] if len(parts) > 5 else "UNKNOWN"

                    local_ip, local_port = local.rsplit(':', 1)
                    remote_ip, remote_port = remote.rsplit(':', 1)

                    # Get process info if available
                    process = "unknown"
                    if len(parts) >= 7:
                        proc_match = re.search(r'(\d+)/([^\s]+)', parts[6])
                        if proc_match:
                            process = proc_match.group(2)

                    connections.append({
                        "proto": proto,
                        "state": state,
                        "local_ip": local_ip,
                        "local_port": int(local_port),
                        "remote_ip": remote_ip,
                        "remote_port": int(remote_port),
                        "process": process
                    })
            except (subprocess.SubprocessError, ValueError) as e:
                logger.error(f"Error getting network connections with netstat: {e}")

        return connections

    def _detect_port_scanning(self, connections: List[Dict[str, Any]]) -> Dict[str, Set[int]]:
        """Detect potential port scanning activities"""
        scanner_ips = defaultdict(set)

        # Focus on connections that are being established or in SYN state
        for conn in connections:
            if conn["remote_ip"] == "0.0.0.0" or conn["remote_ip"] == "127.0.0.1":
                continue

            # Skip whitelisted IPs
            if any(ipaddress.ip_address(conn["remote_ip"]) in network for network in self.ip_whitelist):
                continue

            # Track connection attempts by remote IPs
            remote_ip = conn["remote_ip"]
            local_port = conn["local_port"]

            # Add to connection history
            self.connection_history[remote_ip].append((local_port, time.time()))

            # Check for multiple port accesses in a short time
            recent_ports = set()
            cutoff_time = time.time() - 300  # last 5 minutes
            for port, timestamp in self.connection_history[remote_ip]:
                if timestamp > cutoff_time:
                    recent_ports.add(port)

            if len(recent_ports) >= 3:  # If accessing 3+ different ports
                scanner_ips[remote_ip] = recent_ports

        return scanner_ips

    def _detect_unusual_connections(self, connections: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """Detect unusual outbound connections"""
        unusual_connections = {}

        # Get list of known services listening on ports
        listening_ports = set()
        for conn in connections:
            if conn["state"] == "LISTEN":
                listening_ports.add(conn["local_port"])

        # Check for unusual outbound connections
        for conn in connections:
            # Skip loopback and local network connections
            if (conn["remote_ip"] == "0.0.0.0" or
                conn["remote_ip"] == "127.0.0.1" or
                any(ipaddress.ip_address(conn["remote_ip"]) in network for network in self.ip_whitelist)):
                continue

            # Skip established connections to listening services
            if conn["remote_port"] in listening_ports:
                continue

            # Focus on established connections to unusual ports
            if conn["state"] == "ESTABLISHED" and conn["remote_port"] not in [80, 443, 53, 123]:
                conn_key = f"{conn['local_ip']}:{conn['local_port']}-{conn['remote_ip']}:{conn['remote_port']}"
                unusual_connections[conn_key] = conn

        return unusual_connections


class PrivilegeEscalationDetector:
    """Detects potential privilege escalation attempts"""

    def __init__(self, state: DetectionState, config: dict):
        self.state = state
        self.config = config
        self.suid_binaries = set()
        self.sudo_config = set()
        self.last_check = 0

    def check_for_escalation(self) -> List[Dict[str, Any]]:
        """Check for potential privilege escalation vulnerabilities"""
        alerts = []
        timestamp = datetime.now().isoformat()

        # Don't check too frequently to avoid resource consumption
        current_time = time.time()
        if current_time - self.last_check < 3600:  # Once per hour is enough
            return alerts

        self.last_check = current_time

        # Check for new SUID binaries
        new_suid = self._check_suid_binaries()
        for binary in new_suid:
            alert_id = f"{timestamp}|new_suid|{binary}"
            if alert_id not in self.state.alerts_sent:
                alerts.append({
                    "type": "new_suid",
                    "source": "system",
                    "message": f"New SUID binary detected: {binary}",
                    "binary": binary,
                    "severity": "high"
                })
                self.state.alerts_sent.add(alert_id)

        # Check for sudo configuration changes
        sudo_changes = self._check_sudo_config()
        if sudo_changes:
            alert_id = f"{timestamp}|sudo_config_change"
            if alert_id not in self.state.alerts_sent:
                alerts.append({
                    "type": "sudo_config_change",
                    "source": "system",
                    "message": f"Sudo configuration has changed with {len(sudo_changes)} modifications",
                    "changes": sudo_changes,
                    "severity": "high"
                })
                self.state.alerts_sent.add(alert_id)

        # Check for cron job modifications
        cron_changes = self._check_cron_changes()
        if cron_changes:
            alert_id = f"{timestamp}|cron_changes"
            if alert_id not in self.state.alerts_sent:
                alerts.append({
                    "type": "cron_changes",
                    "source": "system",
                    "message": f"Cron job configuration has been modified",
                    "changes": cron_changes,
                    "severity": "medium"
                })
                self.state.alerts_sent.add(alert_id)

        return alerts

    def _check_suid_binaries(self) -> List[str]:
        """Check for new SUID binaries"""
        new_binaries = []
        try:
            output = subprocess.check_output(
                ["find", "/", "-xdev", "-perm", "-4000", "-type", "f"],
                stderr=subprocess.DEVNULL,
                universal_newlines=True
            )

            current_suid = set(output.splitlines())

            # If this is our first run, just store the binaries
            if not self.suid_binaries:
                self.suid_binaries = current_suid
                return []

            # Check for new SUID binaries
            new_binaries = current_suid - self.suid_binaries

            # Update our set of known SUID binaries
            self.suid_binaries = current_suid

        except subprocess.SubprocessError as e:
            logger.error(f"Error checking SUID binaries: {e}")

        return list(new_binaries)

    def _check_sudo_config(self) -> List[str]:
        """Check for changes in sudo configuration"""
        changes = []
        try:
            # Get sudo configuration
            output = subprocess.check_output(
                ["sudo", "-l"],
                stderr=subprocess.DEVNULL,
                universal_newlines=True
            )

            current_config = set(output.splitlines())

            # If this is our first run, just store the config
            if not self.sudo_config:
                self.sudo_config = current_config
                return []

            # Check for changes
            changes = list(current_config - self.sudo_config)
            removed = list(self.sudo_config - current_config)

            if removed:
                changes.extend([f"REMOVED: {item}" for item in removed])

            # Update our set
            self.sudo_config = current_config

        except subprocess.SubprocessError as e:
            logger.debug(f"Error checking sudo config (might need sudo): {e}")

        return changes

    def _check_cron_changes(self) -> List[str]:
        """Check for changes in cron jobs"""
        changes = []
        cron_dirs = ["/etc/cron.d", "/etc/cron.daily", "/etc/cron.hourly", "/etc/cron.monthly", "/etc/cron.weekly"]

        try:
            for cron_dir in cron_dirs:
                if not os.path.exists(cron_dir):
                    continue

                # Get modification time of cron directory
                mod_time = os.stat(cron_dir).st_mtime

                # Check if directory was modified in the last day
                if time.time() - mod_time < 86400:  # 24 hours
                    changes.append(f"Cron directory modified: {cron_dir}")

            # Check if main crontab has been modified
            crontab_files = ["/etc/crontab"]
            for crontab in crontab_files:
                if os.path.exists(crontab):
                    mod_time = os.stat(crontab).st_mtime
                    if time.time() - mod_time < 86400:  # 24 hours
                        changes.append(f"Crontab file modified: {crontab}")

        except OSError as e:
            logger.error(f"Error checking cron changes: {e}")

        return changes


class AlertManager:
    """Manages alerts and integrates with observability systems"""

    def __init__(self, config: dict):
        self.config = config
        self.prometheus_metrics = defaultdict(int)

    def send_alert(self, alert: Dict[str, Any]) -> None:
        """Send alerts to configured destinations"""
        # Log the alert
        logger.warning(f"SECURITY ALERT: {alert['type']} - {alert['message']}")

        # Update Prometheus metrics if enabled
        if self.config["observability"]["enable_metrics"]:
            self._update_prometheus_metrics(alert)

        # Send to Slack if enabled
        if self.config["observability"]["enable_slack"] and self.config["observability"]["slack_webhook"]:
            self._send_slack_alert(alert)

        # Send email if enabled
        if self.config["observability"]["enable_email"] and self.config["observability"]["email_to"]:
            self._send_email_alert(alert)

    def _update_prometheus_metrics(self, alert: Dict[str, Any]) -> None:
        """Update Prometheus metrics for the alert"""
        metric_name = f"homelab_ids_alert_{alert['type']}_total"
        self.prometheus_metrics[metric_name] += 1

        severity_metric = "homelab_ids_alert_severity_total"
        self.prometheus_metrics[f"{severity_metric}{{severity=\"{alert['severity']}\"}}"] += 1

        # Push to Prometheus pushgateway if configured
        if self.config["observability"]["prometheus_pushgateway"]:
            try:
                metrics_text = ""
                for metric, value in self.prometheus_metrics.items():
                    metrics_text += f"{metric} {value}\n"

                subprocess.run(
                    ["curl", "-s", "-X", "POST",
                     "--data", metrics_text,
                     f"{self.config['observability']['prometheus_pushgateway']}/metrics/job/homelab_ids"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except subprocess.SubprocessError as e:
                logger.error(f"Error pushing metrics to Prometheus: {e}")

    def _send_slack_alert(self, alert: Dict[str, Any]) -> None:
        """Send alert to Slack webhook"""
        try:
            webhook_url = self.config["observability"]["slack_webhook"]

            # Format message
            color = {
                "low": "#36a64f",  # green
                "medium": "#ff9400",  # orange
                "high": "#ff0000"  # red
            }.get(alert["severity"], "#ff9400")

            message = {
                "attachments": [
                    {
                        "color": color,
                        "title": f"Security Alert: {alert['type']}",
                        "text": alert["message"],
                        "fields": [
                            {"title": "Severity", "value": alert["severity"], "short": True},
                            {"title": "Source", "value": alert["source"], "short": True}
                        ],
                        "footer": "Homelab IDS",
                        "ts": int(time.time())
                    }
                ]
            }

            subprocess.run(
                ["curl", "-s", "-X", "POST",
                 "--data-urlencode", f"payload={json.dumps(message)}",
                 webhook_url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        except (subprocess.SubprocessError, json.JSONDecodeError) as e:
            logger.error(f"Error sending Slack alert: {e}")

    def _send_email_alert(self, alert: Dict[str, Any]) -> None:
        """Send alert via email"""
        try:
            import smtplib
            from email.mime.text import MIMEText

            # Format email
            subject = f"[SECURITY ALERT] {alert['type']}: {alert['severity']} severity"
            body = f"""
Security Alert from Homelab IDS

Type: {alert['type']}
Severity: {alert['severity']}
Source: {alert['source']}
Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

Message: {alert['message']}

Additional Details:
{json.dumps(alert, indent=2)}

---
This is an automated message from your Homelab Intrusion Detection System.
"""

            msg = MIMEText(body)
            msg['Subject'] = subject
            msg['From'] = self.config["observability"]["email_from"]
            msg['To'] = ", ".join(self.config["observability"]["email_to"])

            # Send email
            smtp = smtplib.SMTP(self.config["observability"]["smtp_server"])
            smtp.send_message(msg)
            smtp.quit()

        except Exception as e:
            logger.error(f"Error sending email alert: {e}")


class IntrusionDetectionSystem:
    """Main IDS class that coordinates detection modules"""

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

        # Initialize state
        self.state = DetectionState()

        # Initialize components
        self.log_analyzer = LogAnalyzer(self.state, self.config)
        self.network_monitor = NetworkMonitor(self.state, self.config)
        self.priv_escalation = PrivilegeEscalationDetector(self.state, self.config)
        self.alert_manager = AlertManager(self.config)

        # Run flags
        self.running = False
        self.should_stop = False

    def _merge_configs(self, base: Dict, update: Dict) -> None:
        """Recursively merge configuration dictionaries"""
        for key, value in update.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._merge_configs(base[key], value)
            else:
                base[key] = value

    def run_once(self) -> None:
        """Run a single scan cycle"""
        alerts = []

        # Check logs for suspicious patterns
        alerts.extend(self.log_analyzer.analyze_logs())

        # Check network for unusual traffic
        alerts.extend(self.network_monitor.check_network())

        # Check for privilege escalation vulnerabilities
        alerts.extend(self.priv_escalation.check_for_escalation())

        # Process and send alerts
        for alert in alerts:
            self.alert_manager.send_alert(alert)

        # Clean up old data
        self.state.clean_old_data(days=self.config["data_retention_days"])

        # Save state
        self.state.save_state()

        if alerts:
            logger.info(f"Found {len(alerts)} security alerts")
        else:
            logger.debug("No security alerts detected")

    def run(self) -> None:
        """Run the IDS in a continuous loop"""
        self.running = True
        self.should_stop = False

        logger.info("Starting Homelab Intrusion Detection System")

        try:
            while not self.should_stop:
                self.run_once()

                # Sleep for the check interval
                check_interval = self.config["check_interval"]
                logger.debug(f"Sleeping for {check_interval} seconds")

                # Use small sleep intervals to allow for graceful shutdown
                for _ in range(int(check_interval / 2)):
                    if self.should_stop:
                        break
                    time.sleep(2)

        except KeyboardInterrupt:
            logger.info("Received keyboard interrupt, shutting down")
        except Exception as e:
            logger.error(f"Error in IDS main loop: {e}", exc_info=True)
        finally:
            self.running = False
            # Save state before exiting
            self.state.save_state()
            logger.info("Intrusion Detection System stopped")

    def stop(self) -> None:
        """Signal the IDS to stop"""
        logger.info("Stopping Intrusion Detection System")
        self.should_stop = True


def main():
    """Main entry point for the IDS"""
    parser = argparse.ArgumentParser(description="Homelab Intrusion Detection System")
    parser.add_argument("-c", "--config", help="Path to configuration file")
    parser.add_argument("-o", "--once", action="store_true", help="Run only once instead of continuous mode")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose logging")
    args = parser.parse_args()

    # Configure logging level
    if args.verbose:
        logger.setLevel(logging.DEBUG)

    # Initialize IDS
    ids = IntrusionDetectionSystem(config_path=args.config)

    if args.once:
        # Run once mode
        ids.run_once()
    else:
        # Run as daemon
        ids.run()


if __name__ == "__main__":
    main()
