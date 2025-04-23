#!/usr/bin/env python3

import os
import subprocess
import logging
import sys
import socket

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
# List of node IPs or hostnames to check connectivity between (fetch dynamically if possible)
NODE_TARGETS = os.getenv("NODE_TARGETS", "").split(',') # e.g., "192.168.1.10,192.168.1.11,192.168.1.12"
# External host to check DNS and external connectivity
EXTERNAL_TARGET_HOST = os.getenv("EXTERNAL_TARGET_HOST", "google.com")
PING_COUNT = os.getenv("PING_COUNT", "3")
PING_TIMEOUT = os.getenv("PING_TIMEOUT", "5") # Seconds for ping command overall
ALERT_COMMAND = os.getenv("ALERT_COMMAND") # Optional command for alerting

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# --- Helper Functions (reuse run_command, send_alert or define here) ---
def run_command(command, check=True, timeout=None):
    # ... (same as in recover_service.py) ...
    logging.info(f"Running command: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            text=True,
            timeout=timeout
        )
        stdout_log = result.stdout.strip()
        if stdout_log: logging.info(f"Command stdout:\n{stdout_log}") # Show ping output
        if result.stderr: logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        logging.error(f"Command timed out after {timeout}s: {' '.join(command)}")
        raise
    except subprocess.CalledProcessError as e:
        logging.error(f"Command failed with exit code {e.returncode}: {' '.join(command)}")
        if e.stderr: logging.error(f"Error output:\n{e.stderr.strip()}")
        raise # Raise for ping failure
    except Exception as e:
        logging.error(f"Failed to run command {' '.join(command)}: {e}")
        raise

def send_alert(message):
    # ... (same as in recover_service.py) ...
    logging.warning(f"ALERT: {message}")
    if ALERT_COMMAND:
        try:
            full_command = f"{ALERT_COMMAND} \"{message}\""
            logging.info(f"Executing alert command: {full_command}")
            subprocess.run(full_command, shell=True, check=True, timeout=30)
        except Exception as e:
            logging.error(f"Failed to send alert using command '{ALERT_COMMAND}': {e}")
    else:
        logging.warning("ALERT_COMMAND not set, only logging alert.")

# --- Main Logic ---
def check_network_connectivity():
    """Performs basic network connectivity and DNS checks."""
    logging.info("Starting network checks...")
    network_ok = True
    node_targets = [t for t in NODE_TARGETS if t]

    # 1. Inter-node connectivity (if targets provided)
    if node_targets:
        logging.info(f"Checking inter-node connectivity to: {node_targets}")
        # This assumes the script runs on one of the nodes or has network access
        # A better approach might use Kubernetes jobs on each node to ping others
        for target in node_targets:
            try:
                # Use -W for timeout per ping, -w for overall deadline
                run_command([
                    "ping", "-c", PING_COUNT, f"-W{int(PING_TIMEOUT)//int(PING_COUNT)}", target
                ], timeout=int(PING_TIMEOUT))
                logging.info(f"Successfully pinged {target}.")
            except Exception as e:
                message = f"Failed to ping node {target}: {e}"
                send_alert(message)
                network_ok = False
    else:
        logging.info("NODE_TARGETS not set, skipping inter-node ping check.")

    # 2. DNS Resolution and External Connectivity
    logging.info(f"Checking DNS resolution and external connectivity to {EXTERNAL_TARGET_HOST}...")
    try:
        ip_address = socket.gethostbyname(EXTERNAL_TARGET_HOST)
        logging.info(f"Successfully resolved {EXTERNAL_TARGET_HOST} to {ip_address}.")
        # Optionally ping the external host too
        run_command([
            "ping", "-c", PING_COUNT, f"-W{int(PING_TIMEOUT)//int(PING_COUNT)}", EXTERNAL_TARGET_HOST
        ], timeout=int(PING_TIMEOUT))
        logging.info(f"Successfully pinged external host {EXTERNAL_TARGET_HOST}.")
    except socket.gaierror:
        message = f"DNS resolution failed for {EXTERNAL_TARGET_HOST}."
        send_alert(message)
        network_ok = False
    except Exception as e:
        message = f"Failed external connectivity check to {EXTERNAL_TARGET_HOST}: {e}"
        send_alert(message)
        network_ok = False

    if not network_ok:
        logging.warning("Network issues detected. Automated recovery is generally unsafe.")
        logging.warning("Consider checking: Node networking services, DNS configuration (CoreDNS logs), Firewall rules, Physical connections.")
        # Example risky command (DO NOT RUN without understanding):
        # run_command(["sudo", "systemctl", "restart", "networking"]) # Highly dependent on OS and setup

    return network_ok

if __name__ == "__main__":
    if not check_network_connectivity():
        sys.exit(1)
    else:
        logging.info("Network checks completed successfully.")
        sys.exit(0)
