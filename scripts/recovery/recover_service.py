#!/usr/bin/env python3

import json
import logging
import os
import subprocess
import sys
import time

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
# Comma-separated list of namespaces to check, or empty for all namespaces
NAMESPACES = os.getenv("NAMESPACES", "").split(",")
# Comma-separated list of 'namespace/deployment_name' or 'namespace/statefulset_name' to specifically check (optional)
TARGET_SERVICES = os.getenv("TARGET_SERVICES", "").split(",")
# Thresholds
MIN_READY_PERCENT = int(
    os.getenv("MIN_READY_PERCENT", "80")
)  # Minimum % of replicas that must be ready
MAX_RESTARTS_THRESHOLD = int(
    os.getenv("MAX_RESTARTS_THRESHOLD", "5")
)  # Pod restart count threshold to trigger alert/action
ALERT_COMMAND = os.getenv("ALERT_COMMAND")  # Optional command for alerting

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


# --- Helper Functions (reuse run_command, send_alert from recover_node.py or define here) ---
def run_command(command, check=True, timeout=30):
    """Runs a shell command."""
    logging.info(f"Running command: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            text=True,
            timeout=timeout,
        )
        # Limit logging potentially large stdout
        stdout_log = result.stdout.strip()
        if len(stdout_log) > 1000:
            stdout_log = stdout_log[:1000] + "... (truncated)"
        if stdout_log:
            logging.info(f"Command stdout:\n{stdout_log}")
        if result.stderr:
            logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        logging.error(f"Command timed out after {timeout}s: {' '.join(command)}")
        raise
    except subprocess.CalledProcessError as e:
        logging.error(
            f"Command failed with exit code {e.returncode}: {' '.join(command)}"
        )
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
            full_command = f'{ALERT_COMMAND} "{message}"'
            logging.info(f"Executing alert command: {full_command}")
            subprocess.run(full_command, shell=True, check=True, timeout=30)
        except Exception as e:
            logging.error(f"Failed to send alert using command '{ALERT_COMMAND}': {e}")
    else:
        logging.warning("ALERT_COMMAND not set, only logging alert.")


# --- Main Logic ---
def check_service_health(kind, namespace, name):
    """Checks health of a specific Deployment or StatefulSet."""
    logging.info(f"Checking {kind} '{namespace}/{name}'...")
    is_healthy = True
    try:
        # Get status in JSON format
        output = run_command(
            [
                "kubectl",
                "get",
                kind,
                name,
                "-n",
                namespace,
                "--context",
                KUBECTL_CONTEXT,
                "-o",
                "json",
            ]
        )
        status = json.loads(output).get("status", {})

        spec_replicas = (
            json.loads(output).get("spec", {}).get("replicas", 1)
        )  # Default to 1 if not specified
        ready_replicas = status.get("readyReplicas", 0) or status.get(
            "currentReplicas", 0
        )  # STS uses currentReplicas sometimes
        available_replicas = status.get("availableReplicas", 0)

        logging.info(
            f"{kind} {namespace}/{name}: Spec={spec_replicas}, Ready={ready_replicas}, Available={available_replicas}"
        )

        # Check readiness percentage
        if spec_replicas > 0:
            ready_percent = (ready_replicas / spec_replicas) * 100
            if ready_percent < MIN_READY_PERCENT:
                message = f"{kind} '{namespace}/{name}' has low readiness: {ready_percent:.1f}% ({ready_replicas}/{spec_replicas} ready). Expected >{MIN_READY_PERCENT}%."
                send_alert(message)
                is_healthy = False
                # Attempt restart
                try:
                    logging.warning(
                        f"Attempting rollout restart for {kind} '{namespace}/{name}' due to low readiness."
                    )
                    run_command(
                        [
                            "kubectl",
                            "rollout",
                            "restart",
                            kind,
                            name,
                            "-n",
                            namespace,
                            "--context",
                            KUBECTL_CONTEXT,
                        ]
                    )
                except Exception as e:
                    logging.error(
                        f"Failed to trigger rollout restart for {kind} '{namespace}/{name}': {e}"
                    )
                    send_alert(
                        f"Failed to trigger rollout restart for {kind} '{namespace}/{name}'."
                    )

        # Check for high pod restarts (more complex, requires getting pods)
        pod_output = run_command(
            [
                "kubectl",
                "get",
                "pods",
                "-n",
                namespace,
                "--context",
                KUBECTL_CONTEXT,
                "-l",
                json.loads(output)["spec"]["selector"][
                    "matchLabels"
                ],  # Use label selector
                "-o",
                "json",
            ],
            check=False,
        )  # Don't fail if no pods found immediately after restart

        if pod_output:
            pods = json.loads(pod_output).get("items", [])
            for pod in pods:
                pod_name = pod["metadata"]["name"]
                statuses = pod.get("status", {}).get("containerStatuses", [])
                for c_status in statuses:
                    restarts = c_status.get("restartCount", 0)
                    if restarts >= MAX_RESTARTS_THRESHOLD:
                        message = f"Pod '{pod_name}' (part of {kind} '{namespace}/{name}') has high restart count: {restarts}."
                        send_alert(message)
                        # Don't necessarily mark unhealthy, restart already attempted maybe
                        # is_healthy = False # Or just alert?

    except Exception as e:
        logging.error(f"Error checking {kind} '{namespace}/{name}': {e}")
        send_alert(f"Error checking health of {kind} '{namespace}/{name}'.")
        is_healthy = False

    return is_healthy


def main():
    overall_healthy = True
    namespaces_to_check = [ns for ns in NAMESPACES if ns] or ["--all-namespaces"]
    target_services_set = {svc for svc in TARGET_SERVICES if svc and "/" in svc}

    for kind in ["deployment", "statefulset"]:
        logging.info(f"--- Checking {kind}s ---")
        try:
            cmd = (
                ["kubectl", "get", kind]
                + namespaces_to_check
                + ["--context", KUBECTL_CONTEXT, "-o", "json"]
            )
            output = run_command(cmd)
            items = json.loads(output).get("items", [])

            for item in items:
                namespace = item["metadata"]["namespace"]
                name = item["metadata"]["name"]
                fq_name = f"{namespace}/{name}"

                # If specific targets are defined, only check those
                if target_services_set and fq_name not in target_services_set:
                    continue

                if not check_service_health(kind, namespace, name):
                    overall_healthy = False
                time.sleep(1)  # Small delay between checks

        except Exception as e:
            logging.error(f"Failed to list {kind}s: {e}")
            send_alert(f"Error listing {kind}s in Kubernetes.")
            overall_healthy = False

    if overall_healthy:
        logging.info("All checked services appear healthy.")
        sys.exit(0)
    else:
        logging.warning("One or more services reported issues.")
        sys.exit(1)


if __name__ == "__main__":
    main()
