#!/usr/bin/env python3

import os
import subprocess
import logging
import sys
import json
import time
from datetime import datetime, timedelta, timezone

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
# Check deployments/statefulsets updated within this timeframe
CHECK_WINDOW_MINUTES = int(os.getenv("CHECK_WINDOW_MINUTES", "60"))
# Namespaces to check, or empty for all
NAMESPACES = os.getenv("NAMESPACES", "").split(',')
# Rollback automatically if unhealthy after recent update? Use with caution.
AUTO_ROLLBACK = os.getenv("AUTO_ROLLBACK", "false").lower() == "true"
ALERT_COMMAND = os.getenv("ALERT_COMMAND") # Optional command for alerting

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# --- Helper Functions (reuse run_command, send_alert or define here) ---
def run_command(command, check=True, timeout=30):
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
        if len(stdout_log) > 1000: stdout_log = stdout_log[:1000] + "... (truncated)"
        if stdout_log: logging.info(f"Command stdout:\n{stdout_log}")
        if result.stderr: logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        logging.error(f"Command timed out after {timeout}s: {' '.join(command)}")
        raise
    except subprocess.CalledProcessError as e:
        logging.error(f"Command failed with exit code {e.returncode}: {' '.join(command)}")
        if e.stderr: logging.error(f"Error output:\n{e.stderr.strip()}")
        # Don't raise for checks, just return empty/handle failure
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

def get_last_applied_config_time(kind, namespace, name):
    """Approximates last update time from annotations or managedFields (less reliable)."""
    try:
        output = run_command([
            "kubectl", "get", kind, name, "-n", namespace,
            "--context", KUBECTL_CONTEXT, "-o", "json"
        ], check=False)
        if not output: return None

        data = json.loads(output)
        # 1. Check kubectl.kubernetes.io/last-applied-configuration annotation (if applied via kubectl apply)
        annotations = data.get("metadata", {}).get("annotations", {})
        last_applied_str = annotations.get("kubectl.kubernetes.io/last-applied-configuration")
        # This annotation doesn't have a timestamp.

        # 2. Check managedFields (more complex, shows updates by controllers)
        managed_fields = data.get("metadata", {}).get("managedFields", [])
        latest_time = None
        for field in managed_fields:
            # Look for updates by user agents or specific controllers (e.g., 'kubectl-client-side-apply')
            # manager = field.get("manager", "")
            op_time_str = field.get("time")
            if op_time_str:
                op_time = datetime.fromisoformat(op_time_str.replace("Z", "+00:00"))
                if latest_time is None or op_time > latest_time:
                    latest_time = op_time
        return latest_time

    except Exception as e:
        logging.warning(f"Could not determine last update time for {kind} {namespace}/{name}: {e}")
        return None

def check_recent_configs():
    """Checks recently updated resources for health issues."""
    logging.info(f"Checking for unhealthy resources updated within the last {CHECK_WINDOW_MINUTES} minutes.")
    config_issue_found = False
    now = datetime.now(timezone.utc)
    check_cutoff_time = now - timedelta(minutes=CHECK_WINDOW_MINUTES)
    namespaces_to_check = [ns for ns in NAMESPACES if ns] or ["--all-namespaces"]

    for kind in ["deployment", "statefulset"]: # Add others like DaemonSet if needed
        logging.info(f"--- Checking {kind}s ---")
        try:
            cmd = ["kubectl", "get", kind] + namespaces_to_check + ["--context", KUBECTL_CONTEXT, "-o", "json"]
            output = run_command(cmd, check=False)
            if not output: continue
            items = json.loads(output).get("items", [])

            for item in items:
                namespace = item["metadata"]["namespace"]
                name = item["metadata"]["name"]

                last_update_time = get_last_applied_config_time(kind, namespace, name)

                if last_update_time and last_update_time > check_cutoff_time:
                    logging.info(f"{kind} '{namespace}/{name}' was updated recently ({last_update_time}). Checking health...")

                    # Check health (simplified check: desired vs ready replicas)
                    status = item.get("status", {})
                    spec_replicas = item.get("spec", {}).get("replicas", 1)
                    ready_replicas = status.get("readyReplicas", 0)

                    if spec_replicas > 0 and ready_replicas < spec_replicas:
                        message = f"Recently updated {kind} '{namespace}/{name}' is unhealthy ({ready_replicas}/{spec_replicas} ready)."
                        send_alert(message)
                        config_issue_found = True

                        if AUTO_ROLLBACK:
                            logging.warning(f"Attempting automatic rollback for {kind} '{namespace}/{name}' due to unhealthy state after recent update.")
                            try:
                                run_command([
                                    "kubectl", "rollout", "undo", kind, name, "-n", namespace,
                                    "--context", KUBECTL_CONTEXT
                                ])
                                send_alert(f"Automatic rollback initiated for {kind} '{namespace}/{name}'.")
                            except Exception as e:
                                logging.error(f"Automatic rollback failed for {kind} '{namespace}/{name}': {e}")
                                send_alert(f"Automatic rollback FAILED for {kind} '{namespace}/{name}'.")
                        else:
                            logging.warning("Automatic rollback is disabled. Manual intervention required.")
                    else:
                         logging.info(f"Recently updated {kind} '{namespace}/{name}' appears healthy.")

                time.sleep(0.5) # Small delay

        except Exception as e:
            logging.error(f"Failed to check {kind}s for recent updates: {e}")
            send_alert(f"Error checking {kind}s for recent configuration issues.")
            config_issue_found = True # Treat error as potential issue

    return not config_issue_found # Return True if OK

if __name__ == "__main__":
    if not check_recent_configs():
        logging.warning("Potential configuration issues detected in recently updated resources.")
        # Consider linking to Git history or backup system for manual restore
        logging.warning("Check Git history in config backup repo or use 'kubectl rollout history' for manual investigation/rollback.")
        sys.exit(1)
    else:
        logging.info("No obvious configuration issues found in recently updated resources.")
        sys.exit(0)
