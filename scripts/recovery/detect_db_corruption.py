#!/usr/bin/env python3

import os
import subprocess
import logging
import sys
import re

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
# Define DB pods/labels and log patterns indicative of corruption
DB_CHECKS = {
    "postgresql": {
        "namespace": os.getenv("PG_NAMESPACE", "database"),
        "label_selector": os.getenv("PG_LABEL_SELECTOR", "app=postgresql"),
        "container_name": os.getenv("PG_CONTAINER_NAME", "postgresql"), # Optional: specify container if multiple exist
        "corruption_patterns": [
            re.compile(r"PANIC:", re.IGNORECASE),
            re.compile(r"corrupted.*page", re.IGNORECASE),
            re.compile(r"invalid page header", re.IGNORECASE),
            # Add more specific patterns for PostgreSQL
        ],
    },
    "influxdb": {
        "namespace": os.getenv("INFLUXDB_NAMESPACE", "database"),
        "label_selector": os.getenv("INFLUXDB_LABEL_SELECTOR", "app=influxdb"),
        "container_name": os.getenv("INFLUXDB_CONTAINER_NAME", "influxdb"),
        "corruption_patterns": [
            re.compile(r"file corruption", re.IGNORECASE),
            re.compile(r"tsm1.*corrupt", re.IGNORECASE),
            re.compile(r"reading wal.*failed", re.IGNORECASE),
            # Add more specific patterns for InfluxDB
        ],
    },
    # Add checks for Redis if applicable (less common for log-based corruption detection)
}
LOG_LINES_TO_CHECK = int(os.getenv("LOG_LINES_TO_CHECK", "500")) # How many recent log lines to scan
ALERT_COMMAND = os.getenv("ALERT_COMMAND") # Optional command for alerting

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# --- Helper Functions (reuse run_command, send_alert or define here) ---
def run_command(command, check=True, timeout=60):
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
        # Limit logging potentially large stdout
        stdout_log = result.stdout.strip()
        # Don't log full logs here, just confirmation
        if stdout_log: logging.info(f"Command executed successfully.")
        if result.stderr: logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        logging.error(f"Command timed out after {timeout}s: {' '.join(command)}")
        raise
    except subprocess.CalledProcessError as e:
        # Log non-zero exit code as warning for log fetching, might just mean no logs yet
        logging.warning(f"Command failed with exit code {e.returncode}: {' '.join(command)}")
        if e.stderr: logging.warning(f"Error output:\n{e.stderr.strip()}")
        # Return empty string instead of raising for log fetching
        return ""
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
def check_db_logs(db_name, config):
    """Checks logs of a database pod for corruption patterns."""
    logging.info(f"Checking logs for potential corruption in {db_name}...")
    namespace = config["namespace"]
    label_selector = config["label_selector"]
    container = config.get("container_name")
    patterns = config["corruption_patterns"]
    found_issue = False

    try:
        # Get pod names
        pod_names_output = run_command([
            "kubectl", "get", "pods", "-n", namespace, "-l", label_selector,
            "--context", KUBECTL_CONTEXT,
            "-o", "jsonpath={.items[*].metadata.name}"
        ], check=False) # Don't fail if pods are down

        if not pod_names_output:
            logging.warning(f"No pods found for {db_name} with selector '{label_selector}' in namespace '{namespace}'. Skipping log check.")
            return False # Cannot check logs if no pods

        pod_names = pod_names_output.split()

        for pod_name in pod_names:
            logging.info(f"Checking logs for pod '{pod_name}'...")
            log_cmd = [
                "kubectl", "logs", pod_name, "-n", namespace,
                "--context", KUBECTL_CONTEXT,
                "--tail", str(LOG_LINES_TO_CHECK),
            ]
            if container:
                log_cmd.extend(["-c", container])

            try:
                logs = run_command(log_cmd, check=False) # Don't fail if logs are empty or pod starting
                if not logs:
                    logging.info(f"No recent logs found for pod '{pod_name}'.")
                    continue

                for line in logs.splitlines():
                    for pattern in patterns:
                        if pattern.search(line):
                            message = f"Potential corruption detected in {db_name} (pod: {pod_name}): Log line matched pattern '{pattern.pattern}'. Line: '{line}'"
                            send_alert(message)
                            found_issue = True
                            # Maybe break after first match per pod?
                            break
                    if found_issue: break # Move to next pod if issue found in this one

            except Exception as log_e:
                 # Log error fetching logs but continue if possible
                 logging.error(f"Could not fetch logs for pod {pod_name}: {log_e}")


    except Exception as e:
        logging.error(f"Error checking logs for {db_name}: {e}")
        send_alert(f"Error occurred while checking {db_name} logs for corruption.")
        found_issue = True # Treat error during check as potential issue

    if not found_issue:
        logging.info(f"No potential corruption patterns found in recent logs for {db_name}.")

    return found_issue # Return True if potential issue found

def main():
    potential_issues_found = False
    for db_name, config in DB_CHECKS.items():
        if check_db_logs(db_name, config):
            potential_issues_found = True

    if potential_issues_found:
        logging.warning("Potential database corruption issues detected. Manual investigation and restore from backup may be required.")
        sys.exit(1)
    else:
        logging.info("Database log checks completed without finding corruption patterns.")
        sys.exit(0)

if __name__ == "__main__":
    main()
