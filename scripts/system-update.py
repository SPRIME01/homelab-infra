#!/usr/bin/env python3

import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime

# --- Configuration ---
# General
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
LOG_DIR = os.getenv("LOG_DIR", "./update_logs")
# Comma-separated lists of node hostnames/IPs accessible via SSH/Ansible
CONTROL_PLANE_NODES = os.getenv("CONTROL_PLANE_NODES", "").split(",")
WORKER_NODES = os.getenv("WORKER_NODES", "").split(",")
ALL_NODES = list(
    set([n for n in CONTROL_PLANE_NODES + WORKER_NODES if n])
)  # Unique list

# OS Updates (Ansible Recommended)
DO_OS_UPDATE = os.getenv("DO_OS_UPDATE", "false").lower() == "true"
ANSIBLE_INVENTORY = os.getenv("ANSIBLE_INVENTORY", "/path/to/ansible/inventory")
ANSIBLE_PLAYBOOK_OS_UPDATE = os.getenv(
    "ANSIBLE_PLAYBOOK_OS_UPDATE", "/path/to/ansible/update_os.yml"
)
# Or, if using SSH directly (less recommended)
SSH_USER = os.getenv("SSH_USER", "your_ssh_user")
SSH_OPTIONS = os.getenv(
    "SSH_OPTIONS", "-o StrictHostKeyChecking=no"
)  # Example, adjust as needed

# Kubernetes Updates
DO_K8S_UPDATE = os.getenv("DO_K8S_UPDATE", "false").lower() == "true"
TARGET_K8S_VERSION = os.getenv(
    "TARGET_K8S_VERSION"
)  # e.g., "v1.28.5" (must include 'v')

# Application/Image Updates
DO_APP_UPDATE = os.getenv("DO_APP_UPDATE", "false").lower() == "true"
# Example: "deployment/myapp=myrepo/myapp:newtag,statefulset/mydb=myrepo/mydb:v2.1"
# Simple strategy: list of resources and the target image. More complex strategies exist.
APP_IMAGE_UPDATES = dict(
    item.split("=")
    for item in os.getenv("APP_IMAGE_UPDATES", "").split(",")
    if "=" in item
)

# Safety & Coordination
AUTO_APPROVE = (
    os.getenv("AUTO_APPROVE", "false").lower() == "true"
)  # Auto-approve prompts
PERFORM_DRAIN = (
    os.getenv("PERFORM_DRAIN", "true").lower() == "true"
)  # Drain nodes during updates
MAX_NODE_UPDATE_FAILURES = int(
    os.getenv("MAX_NODE_UPDATE_FAILURES", "1")
)  # Max nodes allowed to fail update before aborting
ROLLBACK_ON_FAILURE = (
    os.getenv("ROLLBACK_ON_FAILURE", "false").lower() == "true"
)  # Attempt app rollback on failure

# --- Logging Setup ---
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)
log_filename = os.path.join(
    LOG_DIR, f"system_update_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(log_filename), logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("SystemUpdate")

# --- Safety Warning ---
logger.critical("=" * 60)
logger.critical("🚨 SAFETY WARNING - SYSTEM UPDATE SCRIPT 🚨")
logger.critical("This script performs OS, Kubernetes, and Application updates.")
logger.critical(
    "Running this automatically is RISKY and can cause significant downtime or data loss if not carefully configured and tested."
)
logger.critical("=> ENSURE you have recent, verified backups (etcd, volumes, config).")
logger.critical("=> REVIEW the configuration and steps carefully.")
logger.critical("=> TEST thoroughly in a non-production environment first.")
logger.critical("=> CONSIDER running steps manually or semi-automatically initially.")
logger.critical("=" * 60)
if not AUTO_APPROVE:
    input("Press Enter to continue if you understand the risks, or Ctrl+C to abort...")
else:
    logger.warning("AUTO_APPROVE is enabled. Proceeding automatically in 10 seconds...")
    time.sleep(10)


# --- Helper Functions ---
def run_command(
    command,
    check=True,
    timeout=None,
    capture_output=True,
    shell=False,
    log_output=True,
    env=None,
):
    """Runs a shell command with logging and timeout."""
    cmd_str = command if shell else " ".join(command)
    logger.info(f"Running command: {cmd_str}")
    try:
        process_env = os.environ.copy()
        if env:
            process_env.update(env)

        result = subprocess.run(
            command,
            stdout=subprocess.PIPE if capture_output else None,
            stderr=subprocess.PIPE if capture_output else None,
            check=check,
            text=True,
            timeout=timeout,
            shell=shell,
            env=process_env,
        )
        stdout_log = result.stdout.strip() if capture_output and result.stdout else ""
        stderr_log = result.stderr.strip() if capture_output and result.stderr else ""

        if log_output:
            if stdout_log:
                logger.info(f"Command stdout:\n{stdout_log}")
            # Log stderr as warning even on success, as commands might output info there
            if stderr_log:
                logger.warning(f"Command stderr:\n{stderr_log}")
        else:
            logger.info("Command executed (output logging suppressed).")

        return stdout_log, stderr_log
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out after {timeout}s: {cmd_str}")
        raise
    except subprocess.CalledProcessError as e:
        logger.error(f"Command failed with exit code {e.returncode}: {cmd_str}")
        # Log output even on failure if captured
        stdout_log = e.stdout.strip() if e.stdout else ""
        stderr_log = e.stderr.strip() if e.stderr else ""
        if stdout_log:
            logger.error(f"Failed command stdout:\n{stdout_log}")
        if stderr_log:
            logger.error(f"Failed command stderr:\n{stderr_log}")
        raise
    except Exception as e:
        logger.error(f"Failed to run command {cmd_str}: {e}")
        raise


def run_ssh_command(node, command_str, check=True, timeout=120):
    """Runs a command on a remote node via SSH."""
    ssh_cmd = ["ssh"] + SSH_OPTIONS.split() + [f"{SSH_USER}@{node}", command_str]
    return run_command(ssh_cmd, check=check, timeout=timeout)


def run_ansible_playbook(playbook_path, inventory_path, extra_vars=None):
    """Runs an Ansible playbook."""
    if not os.path.exists(playbook_path) or not os.path.exists(inventory_path):
        logger.error(
            f"Ansible playbook or inventory not found: {playbook_path}, {inventory_path}"
        )
        raise FileNotFoundError("Ansible playbook or inventory missing")

    command = ["ansible-playbook", "-i", inventory_path, playbook_path]
    if extra_vars:
        command.extend(["-e", json.dumps(extra_vars)])
    return run_command(command, timeout=1800)  # Long timeout for playbooks


def check_node_status(expected_count):
    """Checks if all expected nodes are Ready."""
    logger.info("Checking Kubernetes node status...")
    try:
        stdout, _ = run_command(
            [
                "kubectl",
                "get",
                "nodes",
                "--context",
                KUBECTL_CONTEXT,
                "-o",
                "jsonpath={range .items[*]}{.metadata.name}{' '}{range .status.conditions[?(@.type=='Ready')]}{.status}{'\\n'}{end}{end}",
            ],
            timeout=30,
        )
        nodes = stdout.strip().split("\n")
        ready_nodes = 0
        not_ready_nodes = []
        for node_line in nodes:
            if not node_line.strip():
                continue
            parts = node_line.split()
            if len(parts) == 2 and parts[1] == "True":
                ready_nodes += 1
            elif len(parts) >= 1:
                not_ready_nodes.append(parts[0])

        logger.info(f"Found {len(nodes)} nodes, {ready_nodes} are Ready.")
        if not_ready_nodes:
            logger.warning(f"Nodes not Ready: {', '.join(not_ready_nodes)}")

        if ready_nodes >= expected_count:
            logger.info("All expected nodes are Ready.")
            return True
        else:
            logger.error(
                f"Expected {expected_count} Ready nodes, but found {ready_nodes}."
            )
            return False
    except Exception as e:
        logger.error(f"Failed to check node status: {e}")
        return False


def check_deployment_status(namespace="--all-namespaces", min_ready_percent=100):
    """Checks if deployments are healthy."""
    logger.info(f"Checking deployment status in namespace(s): {namespace}...")
    all_healthy = True
    try:
        ns_arg = ["-A"] if namespace == "--all-namespaces" else ["-n", namespace]
        stdout, _ = run_command(
            ["kubectl", "get", "deployments"]
            + ns_arg
            + ["--context", KUBECTL_CONTEXT, "-o", "json"],
            timeout=60,
        )
        deployments = json.loads(stdout).get("items", [])
        if not deployments:
            logger.info("No deployments found in specified namespace(s).")
            return True

        for deploy in deployments:
            name = deploy["metadata"]["name"]
            ns = deploy["metadata"]["namespace"]
            spec_replicas = deploy.get("spec", {}).get("replicas", 1)
            ready_replicas = deploy.get("status", {}).get("readyReplicas", 0)
            available_replicas = deploy.get("status", {}).get(
                "availableReplicas", 0
            )  # Consider available too

            is_healthy = False
            if spec_replicas == 0:  # Scaled down intentionally
                is_healthy = True
            elif spec_replicas > 0:
                ready_percent = (ready_replicas / spec_replicas) * 100
                if (
                    ready_replicas >= spec_replicas
                    and ready_percent >= min_ready_percent
                ):
                    is_healthy = True

            if is_healthy:
                logger.info(
                    f"Deployment {ns}/{name}: Healthy ({ready_replicas}/{spec_replicas} ready)"
                )
            else:
                logger.warning(
                    f"Deployment {ns}/{name}: UNHEALTHY ({ready_replicas}/{spec_replicas} ready, {available_replicas} available)"
                )
                all_healthy = False

        return all_healthy
    except Exception as e:
        logger.error(f"Failed to check deployment status: {e}")
        return False


def cordon_node(node):
    """Cordon a Kubernetes node."""
    logger.info(f"Cordoning node {node}...")
    run_command(["kubectl", "cordon", node, "--context", KUBECTL_CONTEXT])


def drain_node(node):
    """Drain a Kubernetes node."""
    if not PERFORM_DRAIN:
        logger.warning(f"Skipping drain for node {node} as PERFORM_DRAIN is false.")
        return
    logger.info(f"Draining node {node} (this may take time)...")
    # Adjust drain flags as needed for your environment
    run_command(
        [
            "kubectl",
            "drain",
            node,
            "--context",
            KUBECTL_CONTEXT,
            "--ignore-daemonsets",
            "--delete-emptydir-data",
            "--force",
            "--timeout=5m",  # Add a timeout
        ],
        timeout=360,
    )  # Timeout for the command itself


def uncordon_node(node):
    """Uncordon a Kubernetes node."""
    logger.info(f"Uncordoning node {node}...")
    run_command(["kubectl", "uncordon", node, "--context", KUBECTL_CONTEXT])


# --- Update Steps ---


def run_pre_update_checks():
    logger.info("--- Running Pre-Update Checks ---")
    # 1. Check Node Status
    if not check_node_status(len(ALL_NODES)):
        raise RuntimeError("Pre-check failed: Not all nodes are Ready.")
    # 2. Check Deployment Status
    if not check_deployment_status():
        raise RuntimeError("Pre-check failed: One or more deployments are unhealthy.")
    # 3. Placeholder: Run simple application tests (e.g., curl endpoints)
    logger.info("Placeholder: Run application-specific pre-update tests...")
    # 4. Placeholder: Check backup status
    logger.info("Placeholder: Verify recent successful backups exist...")

    logger.info("Pre-update checks passed.")
    return True


def update_os_packages():
    logger.info("--- Starting OS Package Updates ---")
    if not ALL_NODES:
        logger.warning(
            "No nodes defined (CONTROL_PLANE_NODES, WORKER_NODES). Skipping OS updates."
        )
        return True

    try:
        if os.path.exists(ANSIBLE_PLAYBOOK_OS_UPDATE):
            logger.info("Using Ansible playbook for OS updates.")
            run_ansible_playbook(ANSIBLE_PLAYBOOK_OS_UPDATE, ANSIBLE_INVENTORY)
        else:
            logger.warning(
                "Ansible playbook not found. Attempting OS updates via SSH (less recommended)."
            )
            logger.warning(
                "This basic SSH method does NOT handle reboots gracefully. Use Ansible for that."
            )
            update_cmd = (
                "sudo apt update && sudo apt upgrade -y"  # Debian/Ubuntu example
            )
            for node in ALL_NODES:
                logger.info(f"Updating OS packages on node {node} via SSH...")
                run_ssh_command(node, update_cmd, timeout=600)
        logger.info("OS package updates completed.")
        # Add reboot handling logic here if needed, likely involving drain/reboot/uncordon per node
        logger.warning(
            "Reboot coordination is NOT implemented in the basic SSH method. Use Ansible or add logic."
        )
        return True
    except Exception as e:
        logger.error(f"OS package update failed: {e}")
        return False


def update_k8s_control_plane():
    logger.info("--- Starting Kubernetes Control Plane Update ---")
    if not CONTROL_PLANE_NODES:
        logger.error("CONTROL_PLANE_NODES not defined. Cannot update control plane.")
        return False
    if not TARGET_K8S_VERSION or not TARGET_K8S_VERSION.startswith("v"):
        logger.error(
            f"TARGET_K8S_VERSION ('{TARGET_K8S_VERSION}') is not set or invalid. Must start with 'v'."
        )
        return False

    first_cp_node = CONTROL_PLANE_NODES[0]
    other_cp_nodes = CONTROL_PLANE_NODES[1:]

    try:
        # Step 1: Update kubeadm on the first control plane node
        logger.info(f"Updating kubeadm on first control plane node: {first_cp_node}")
        # Command depends on OS package manager
        update_kubeadm_cmd = f"sudo apt-mark unhold kubeadm && sudo apt-get update && sudo apt-get install -y kubeadm={TARGET_K8S_VERSION[1:]}-00 && sudo apt-mark hold kubeadm"  # Debian/Ubuntu example
        run_ssh_command(first_cp_node, update_kubeadm_cmd)

        # Step 2: Run kubeadm upgrade plan
        logger.info(f"Running 'kubeadm upgrade plan' on {first_cp_node}")
        run_ssh_command(
            first_cp_node, f"sudo kubeadm upgrade plan {TARGET_K8S_VERSION}"
        )
        if not AUTO_APPROVE:
            input(
                f"Review the upgrade plan for {TARGET_K8S_VERSION}. Press Enter to apply or Ctrl+C to abort..."
            )

        # Step 3: Apply the upgrade on the first control plane node
        logger.info(f"Applying upgrade to {TARGET_K8S_VERSION} on {first_cp_node}")
        run_ssh_command(
            first_cp_node, f"sudo kubeadm upgrade apply {TARGET_K8S_VERSION} --yes"
        )

        # Step 4: Upgrade kubeadm and kubelet on other control plane nodes
        update_cp_tools_cmd = f"sudo apt-mark unhold kubeadm kubelet && sudo apt-get update && sudo apt-get install -y kubeadm={TARGET_K8S_VERSION[1:]}-00 kubelet={TARGET_K8S_VERSION[1:]}-00 && sudo apt-mark hold kubeadm kubelet"
        for node in other_cp_nodes:
            logger.info(
                f"Updating kubeadm and kubelet on other control plane node: {node}"
            )
            run_ssh_command(node, update_cp_tools_cmd)
            logger.info(f"Running 'kubeadm upgrade node' on {node}")
            run_ssh_command(node, "sudo kubeadm upgrade node")
            logger.info(f"Restarting kubelet on {node}")
            run_ssh_command(
                node, "sudo systemctl daemon-reload && sudo systemctl restart kubelet"
            )

        # Step 5: Upgrade kubelet and restart on the first control plane node
        logger.info(f"Updating kubelet on first control plane node: {first_cp_node}")
        update_first_cp_kubelet_cmd = f"sudo apt-mark unhold kubelet && sudo apt-get update && sudo apt-get install -y kubelet={TARGET_K8S_VERSION[1:]}-00 && sudo apt-mark hold kubelet"
        run_ssh_command(first_cp_node, update_first_cp_kubelet_cmd)
        logger.info(f"Restarting kubelet on {first_cp_node}")
        run_ssh_command(
            first_cp_node,
            "sudo systemctl daemon-reload && sudo systemctl restart kubelet",
        )

        logger.info("Control plane update completed.")
        return True

    except Exception as e:
        logger.error(f"Kubernetes control plane update failed: {e}")
        logger.error(
            "Manual intervention likely required. Check kubeadm logs and component statuses."
        )
        return False


def update_k8s_workers():
    logger.info("--- Starting Kubernetes Worker Node Update ---")
    if not WORKER_NODES:
        logger.warning("No worker nodes defined. Skipping worker update.")
        return True
    if not TARGET_K8S_VERSION or not TARGET_K8S_VERSION.startswith("v"):
        logger.error(
            f"TARGET_K8S_VERSION ('{TARGET_K8S_VERSION}') is not set or invalid."
        )
        return False

    failed_nodes = 0
    update_worker_tools_cmd = f"sudo apt-mark unhold kubeadm kubelet && sudo apt-get update && sudo apt-get install -y kubeadm={TARGET_K8S_VERSION[1:]}-00 kubelet={TARGET_K8S_VERSION[1:]}-00 && sudo apt-mark hold kubeadm kubelet"  # Debian/Ubuntu example

    for node in WORKER_NODES:
        logger.info(f"--- Updating worker node: {node} ---")
        try:
            # Cordon and Drain
            cordon_node(node)
            drain_node(node)

            # Update kubeadm
            logger.info(f"Updating kubeadm on worker node {node}")
            run_ssh_command(
                node,
                update_worker_tools_cmd.replace(
                    f"kubelet={TARGET_K8S_VERSION[1:]}-00", ""
                ),
            )  # Only kubeadm first

            # Kubeadm upgrade node
            logger.info(f"Running 'kubeadm upgrade node' on {node}")
            run_ssh_command(node, "sudo kubeadm upgrade node")

            # Update kubelet
            logger.info(f"Updating kubelet on worker node {node}")
            run_ssh_command(
                node,
                update_worker_tools_cmd.replace(
                    f"kubeadm={TARGET_K8S_VERSION[1:]}-00", ""
                ),
            )  # Only kubelet now

            # Restart kubelet
            logger.info(f"Restarting kubelet on {node}")
            run_ssh_command(
                node, "sudo systemctl daemon-reload && sudo systemctl restart kubelet"
            )

            # Uncordon
            uncordon_node(node)

            # Basic health check after uncordon
            time.sleep(15)  # Give node time to become ready
            if not check_node_status(len(ALL_NODES)):  # Check overall cluster health
                logger.warning(
                    f"Node {node} updated, but cluster health check failed post-uncordon."
                )
                # Decide whether to proceed or abort based on severity/policy

            logger.info(f"Successfully updated worker node: {node}")

        except Exception as e:
            logger.error(f"Failed to update worker node {node}: {e}")
            failed_nodes += 1
            # Attempt to uncordon even on failure? Risky.
            try:
                logger.warning(f"Attempting to uncordon failed node {node}...")
                uncordon_node(node)
            except Exception as uncordon_e:
                logger.error(
                    f"Failed to uncordon node {node} after update failure: {uncordon_e}"
                )

            if failed_nodes >= MAX_NODE_UPDATE_FAILURES:
                logger.critical(
                    f"Reached maximum allowed node update failures ({MAX_NODE_UPDATE_FAILURES}). Aborting worker updates."
                )
                return False
            else:
                logger.warning("Continuing with next worker node...")

    if failed_nodes > 0:
        logger.error(f"Completed worker updates with {failed_nodes} failure(s).")
        return False
    else:
        logger.info("All worker nodes updated successfully.")
        return True


def update_container_images():
    logger.info("--- Starting Application Container Image Updates ---")
    if not APP_IMAGE_UPDATES:
        logger.warning("APP_IMAGE_UPDATES not defined. Skipping application updates.")
        return True

    logger.warning("Using basic 'kubectl set image' strategy. This is limited.")
    logger.warning(
        "Consider GitOps tools (Argo CD Image Updater, Flux, Renovate) for robust image updates."
    )

    success = True
    rollbacks_needed = []

    for resource_id, target_image in APP_IMAGE_UPDATES.items():
        try:
            kind, name = resource_id.split("/")
            # Assuming default namespace if not specified, adjust if needed
            namespace = "default"
            if ":" in name:
                namespace, name = name.split(
                    ":"
                )  # Allow format like deployment:ns/name

            logger.info(
                f"Updating {kind} '{namespace}/{name}' to image '{target_image}'..."
            )
            # This assumes the container name to update is the same as the resource name,
            # which is often NOT the case. A more robust solution needs container names.
            # Example: kubectl set image deployment/myapp myapp-container=newimage:tag
            # For simplicity here, we assume container name == resource name. Needs refinement.
            container_name = name
            run_command(
                [
                    "kubectl",
                    "set",
                    "image",
                    kind,
                    name,
                    f"{container_name}={target_image}",
                    "-n",
                    namespace,
                    "--context",
                    KUBECTL_CONTEXT,
                    "--record",  # Record helps with rollback
                ]
            )
            logger.info(
                f"Triggered update for {kind} '{namespace}/{name}'. Monitoring rollout..."
            )
            # Wait and check rollout status
            run_command(
                [
                    "kubectl",
                    "rollout",
                    "status",
                    kind,
                    name,
                    "-n",
                    namespace,
                    "--context",
                    KUBECTL_CONTEXT,
                    "--timeout=5m",
                ],
                timeout=310,
            )
            logger.info(f"Rollout finished for {kind} '{namespace}/{name}'.")
            # Add post-update validation specific to the app if possible

        except Exception as e:
            logger.error(
                f"Failed to update {kind} '{namespace}/{name}' to image '{target_image}': {e}"
            )
            success = False
            rollbacks_needed.append(
                {"kind": kind, "name": name, "namespace": namespace}
            )

    if not success and ROLLBACK_ON_FAILURE:
        logger.warning(
            "One or more application updates failed. Attempting rollbacks..."
        )
        for item in rollbacks_needed:
            rollback_application(item["kind"], item["namespace"], item["name"])

    return success


def rollback_application(kind, namespace, name):
    """Attempts to rollback a Kubernetes application."""
    logger.warning(f"Attempting rollback for {kind} '{namespace}/{name}'...")
    try:
        run_command(
            [
                "kubectl",
                "rollout",
                "undo",
                kind,
                name,
                "-n",
                namespace,
                "--context",
                KUBECTL_CONTEXT,
            ]
        )
        logger.info(
            f"Rollback command executed for {kind} '{namespace}/{name}'. Monitor status manually."
        )
        # Add check for rollout status after undo if needed
    except Exception as e:
        logger.error(f"Failed to execute rollback for {kind} '{namespace}/{name}': {e}")


def run_post_update_validation():
    logger.info("--- Running Post-Update Validation Checks ---")
    final_success = True
    # 1. Check Node Status
    if not check_node_status(len(ALL_NODES)):
        logger.error("Post-check failed: Not all nodes are Ready.")
        final_success = False
    # 2. Check Deployment Status
    if not check_deployment_status():
        logger.warning("Post-check warning: One or more deployments are unhealthy.")
        # Don't necessarily fail the whole update for app issues if OS/K8s was the goal
        # final_success = False # Uncomment if strict health is required
    # 3. Placeholder: Run more comprehensive application tests
    logger.info("Placeholder: Run application-specific post-update tests...")

    if final_success:
        logger.info("Post-update validation checks passed.")
    else:
        logger.error("Post-update validation checks failed.")
    return final_success


# --- Main Orchestration ---
def main():
    logger.info("=== Starting Automated System Update Run ===")
    overall_success = True
    start_run_time = datetime.now()

    steps_executed = []
    steps_succeeded = []

    try:
        # Pre-Checks
        steps_executed.append("PreChecks")
        if run_pre_update_checks():
            steps_succeeded.append("PreChecks")
        else:
            raise RuntimeError("Pre-update checks failed. Aborting.")

        # OS Updates
        if DO_OS_UPDATE:
            steps_executed.append("OSUpdate")
            if update_os_packages():
                steps_succeeded.append("OSUpdate")
            else:
                overall_success = False
                # Decide whether to continue or abort based on policy
                logger.critical("OS update failed. Aborting further updates.")
                raise RuntimeError("OS Update Failed.")

        # Kubernetes Updates
        if DO_K8S_UPDATE:
            # Control Plane
            steps_executed.append("K8sControlPlaneUpdate")
            if update_k8s_control_plane():
                steps_succeeded.append("K8sControlPlaneUpdate")
                # Wait and check cluster health before proceeding
                logger.info(
                    "Waiting after control plane update before updating workers..."
                )
                time.sleep(60)
                if not check_node_status(len(ALL_NODES)) or not check_deployment_status(
                    namespace="kube-system"
                ):
                    raise RuntimeError(
                        "Cluster health check failed after control plane update."
                    )

                # Workers
                steps_executed.append("K8sWorkerUpdate")
                if update_k8s_workers():
                    steps_succeeded.append("K8sWorkerUpdate")
                else:
                    overall_success = False
                    logger.critical(
                        "Kubernetes worker update failed. Aborting further updates."
                    )
                    raise RuntimeError("Kubernetes Worker Update Failed.")
            else:
                overall_success = False
                logger.critical(
                    "Kubernetes control plane update failed. Aborting further updates."
                )
                raise RuntimeError("Kubernetes Control Plane Update Failed.")

        # Application Updates
        if DO_APP_UPDATE:
            steps_executed.append("AppUpdate")
            if update_container_images():
                steps_succeeded.append("AppUpdate")
            else:
                overall_success = False
                logger.error("One or more application updates failed.")
                # Continue to post-checks even if apps failed, unless rollback was attempted

        # Post-Checks
        steps_executed.append("PostChecks")
        if run_post_update_validation():
            steps_succeeded.append("PostChecks")
        else:
            overall_success = False
            logger.error("Post-update validation failed.")

    except Exception as e:
        logger.critical(f"Update run aborted due to error: {e}", exc_info=True)
        overall_success = False
        # Attempt application rollback if specified and error occurred after app update started
        if (
            ROLLBACK_ON_FAILURE
            and "AppUpdate" in steps_executed
            and "AppUpdate" not in steps_succeeded
        ):
            logger.warning(
                "Attempting application rollbacks due to script error during/after app updates."
            )
            # This rollback logic might be too simplistic; needs refinement based on APP_IMAGE_UPDATES structure
            for resource_id, _ in APP_IMAGE_UPDATES.items():
                try:
                    kind, name = resource_id.split("/")
                    namespace = "default"
                    if ":" in name:
                        namespace, name = name.split(":")
                    rollback_application(kind, namespace, name)
                except Exception as rb_e:
                    logger.error(f"Error attempting rollback for {resource_id}: {rb_e}")

    finally:
        end_run_time = datetime.now()
        run_duration = end_run_time - start_run_time
        logger.info("--- Update Run Summary ---")
        logger.info(f"Start Time: {start_run_time.isoformat()}")
        logger.info(f"End Time: {end_run_time.isoformat()}")
        logger.info(f"Duration: {run_duration}")
        logger.info(f"Steps Executed: {', '.join(steps_executed)}")
        logger.info(f"Steps Succeeded: {', '.join(steps_succeeded)}")
        logger.info(f"Overall Status: {'✅ SUCCESS' if overall_success else '❌ FAILED'}")
        logger.info(f"Log file: {log_filename}")
        logger.info("=== Automated System Update Run Finished ===")

        if not overall_success:
            sys.exit(1)
        else:
            sys.exit(0)


if __name__ == "__main__":
    # Basic dependency check (external tools)
    tools = ["kubectl", "ssh"]
    if DO_OS_UPDATE and os.path.exists(ANSIBLE_PLAYBOOK_OS_UPDATE):
        tools.append("ansible-playbook")
    if DO_K8S_UPDATE:
        tools.append("kubeadm")  # Assumes kubeadm is run via SSH

    missing = [tool for tool in tools if shutil.which(tool) is None]
    if missing:
        logger.critical(
            f"Missing required command-line tools: {', '.join(missing)}. Please install them."
        )
        sys.exit(2)

    main()
