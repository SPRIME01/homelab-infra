#!/usr/bin/env python3

import os
import subprocess
import logging
import sys
import time

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
NODE_CHECK_TIMEOUT = os.getenv("NODE_CHECK_TIMEOUT", "10s") # Timeout for kubectl get node status
ALERT_COMMAND = os.getenv("ALERT_COMMAND") # Optional command to run for alerting (e.g., webhook)

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# --- Helper Functions ---
def run_command(command, check=True, timeout=None):
    """Runs a shell command."""
    logging.info(f"Running command: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            text=True,
            timeout=timeout # Add timeout
        )
        if result.stdout:
            logging.info(f"Command stdout:\n{result.stdout.strip()}")
        if result.stderr:
            logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        logging.error(f"Command timed out after {timeout}s: {' '.join(command)}")
        raise
    except subprocess.CalledProcessError as e:
        logging.error(f"Command failed with exit code {e.returncode}: {' '.join(command)}")
        if e.stderr:
            logging.error(f"Error output:\n{e.stderr.strip()}")
        raise
    except Exception as e:
        logging.error(f"Failed to run command {' '.join(command)}: {e}")
        raise

def send_alert(message):
    """Sends an alert using the configured command."""
    logging.warning(f"ALERT: {message}")
    if ALERT_COMMAND:
        try:
            # Example: ALERT_COMMAND="curl -X POST -d 'message=...' http://alert-webhook"
            # Ensure the command handles the message appropriately
            full_command = f"{ALERT_COMMAND} \"{message}\"" # Basic quoting
            logging.info(f"Executing alert command: {full_command}")
            subprocess.run(full_command, shell=True, check=True, timeout=30)
        except Exception as e:
            logging.error(f"Failed to send alert using command '{ALERT_COMMAND}': {e}")
    else:
        logging.warning("ALERT_COMMAND not set, only logging alert.")

# --- Main Logic ---
def check_node_status():
    """Checks the status of Kubernetes nodes."""
    logging.info("Checking Kubernetes node status...")
    unhealthy_nodes = []
    try:
        # Get node name and status condition Ready=True/False/Unknown
        output = run_command([
            "kubectl", "get", "nodes",
            "--context", KUBECTL_CONTEXT,
            "-o", "jsonpath={range .items[*]}{.metadata.name}{' '}{range .status.conditions[?(@.type=='Ready')]}{.status}{'\\n'}{end}{end}"
        ], timeout=int(NODE_CHECK_TIMEOUT.replace('s',''))) # Convert timeout string

        nodes = output.strip().split('\n')
        if not nodes or (len(nodes) == 1 and not nodes[0]):
             logging.warning("Could not retrieve node status or no nodes found.")
             return # Or raise error?

        for node_line in nodes:
            if not node_line.strip(): continue
            parts = node_line.split()
            if len(parts) != 2:
                logging.warning(f"Unexpected format for node status line: '{node_line}'")
                continue
            node_name, ready_status = parts
            if ready_status != "True":
                logging.warning(f"Node '{node_name}' is not Ready (Status: {ready_status}).")
                unhealthy_nodes.append(node_name)
            else:
                logging.info(f"Node '{node_name}' is Ready.")

        if unhealthy_nodes:
            message = f"Unhealthy Kubernetes nodes detected: {', '.join(unhealthy_nodes)}"
            send_alert(message)
            # --- Potential Automated Actions (Use with extreme caution) ---
            # Option 1: Cordon the node to prevent new pods scheduling
            # for node in unhealthy_nodes:
            #     try:
            #         logging.warning(f"Attempting to cordon node {node}...")
            #         run_command(["kubectl", "cordon", node, "--context", KUBECTL_CONTEXT])
            #     except Exception as e:
            #         logging.error(f"Failed to cordon node {node}: {e}")

            # Option 2: Trigger external automation (e.g., reboot via IPMI, Ansible playbook)
            # This requires specific integration beyond this script.
            logging.warning("Further recovery actions (reboot, drain) typically require manual intervention or dedicated infrastructure automation.")
            return False # Indicate failure/unhealthy state
        else:
            logging.info("All nodes are Ready.")
            return True # Indicate success/healthy state

    except subprocess.TimeoutExpired:
        send_alert("Timeout checking Kubernetes node status. Control plane might be unresponsive.")
        return False
    except Exception as e:
        logging.error(f"Error checking node status: {e}")
        send_alert(f"Error checking Kubernetes node status: {e}")
        return False

if __name__ == "__main__":
    if not check_node_status():
        sys.exit(1)
    sys.exit(0)
