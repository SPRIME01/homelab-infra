#!/usr/bin/env python3

import json
import logging
import os
import subprocess
import sys

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
TOP_N_CPU = int(os.getenv("TOP_N_CPU", "5"))  # Report top N CPU consuming pods
TOP_N_MEM = int(os.getenv("TOP_N_MEM", "5"))  # Report top N Memory consuming pods
# Namespaces to exclude (comma-separated)
EXCLUDED_NAMESPACES = os.getenv("EXCLUDED_NAMESPACES", "kube-system,monitoring").split(
    ","
)

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("AppBottleneckFinder")


# --- Helper Functions ---
# Re-use run_kubectl from analyze_k8s_resources.py or define here
def run_kubectl(
    command, context=KUBECTL_CONTEXT, parse_json=False, check=True, timeout=60
):
    """Runs a kubectl command."""
    full_command = ["kubectl"] + command + ["--context", context]
    logger.info(f"Running command: {' '.join(full_command)}")
    try:
        result = subprocess.run(
            full_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            text=True,
            timeout=timeout,
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        if stderr:
            logger.warning(f"kubectl stderr:\n{stderr}")
        if parse_json:
            # Handle potential empty output before JSON parsing
            if not stdout:
                logger.error(
                    "kubectl command returned empty output, cannot parse JSON."
                )
                return None
            try:
                return json.loads(stdout)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON output from kubectl: {e}")
                logger.debug(f"Raw output:\n{stdout}")
                return None
        else:
            return stdout
    except subprocess.TimeoutExpired:
        logger.error(
            f"kubectl command timed out after {timeout}s: {' '.join(full_command)}"
        )
        return None
    except subprocess.CalledProcessError as e:
        logger.error(
            f"kubectl command failed with exit code {e.returncode}: {' '.join(full_command)}"
        )
        if e.stderr:
            logger.error(f"Error output:\n{e.stderr.strip()}")
        # Return None on failure if check=False was intended, otherwise exception is raised
        return None
    except Exception as e:
        logger.error(f"Failed to run kubectl command {' '.join(full_command)}: {e}")
        return None


def parse_quantity(quantity_str):
    """Parses Kubernetes resource quantities (CPU, Memory). Simplified version."""
    if not quantity_str:
        return 0.0
    quantity_str = quantity_str.lower()
    if quantity_str.endswith("m"):
        return float(quantity_str[:-1])  # CPU millicores -> treat as numeric value
    if quantity_str.endswith("ki"):
        return float(quantity_str[:-2]) * 1024
    if quantity_str.endswith("mi"):
        return float(quantity_str[:-2]) * 1024**2
    if quantity_str.endswith("gi"):
        return float(quantity_str[:-2]) * 1024**3
    # Add other units (k, M, G) if needed, being careful about base-10 vs base-2
    try:
        return float(quantity_str)  # Assume cores or bytes
    except ValueError:
        return 0.0


# --- Analysis Functions ---


def get_top_pods():
    """Gets top CPU and Memory consuming pods using 'kubectl top pods'."""
    logger.info("Fetching current top pods by resource usage...")
    # Requires metrics-server
    usage_data_str = run_kubectl(
        ["top", "pods", "-A", "--no-headers"], parse_json=False
    )
    if not usage_data_str:
        logger.error(
            "Failed to fetch pod usage metrics via 'kubectl top pods'. Is metrics-server running?"
        )
        return None, None

    pod_usage = []
    lines = usage_data_str.strip().split("\n")
    for line in lines:
        parts = line.split()
        if len(parts) >= 4:
            namespace, pod_name, cpu_usage_str, mem_usage_str = (
                parts[0],
                parts[1],
                parts[2],
                parts[3],
            )
            if namespace in EXCLUDED_NAMESPACES:
                continue
            pod_usage.append(
                {
                    "namespace": namespace,
                    "pod": pod_name,
                    "cpu_raw": cpu_usage_str,
                    "mem_raw": mem_usage_str,
                    "cpu_val": parse_quantity(
                        cpu_usage_str + "m"
                    ),  # Treat CPU value as millicores for sorting
                    "mem_val": parse_quantity(mem_usage_str),  # Parse memory to bytes
                }
            )
        else:
            logger.warning(f"Could not parse 'kubectl top pods' line: {line}")

    # Sort by CPU and Memory
    top_cpu = sorted(pod_usage, key=lambda x: x["cpu_val"], reverse=True)[:TOP_N_CPU]
    top_mem = sorted(pod_usage, key=lambda x: x["mem_val"], reverse=True)[:TOP_N_MEM]

    return top_cpu, top_mem


# --- Main Execution ---
def main():
    logger.info("=== Starting Application Bottleneck Identification (Top Pods) ===")
    logger.warning(
        "NOTE: This script identifies high resource consumers as a STARTING POINT."
    )
    logger.warning(
        "True bottleneck analysis requires application-specific profiling, tracing, and log analysis."
    )
    logger.info("Prerequisite: Ensure metrics-server is installed and running.")

    top_cpu_pods, top_mem_pods = get_top_pods()

    logger.info("--- Analysis Results ---")

    if top_cpu_pods:
        logger.info(f"Top {len(top_cpu_pods)} CPU Consuming Pods (Current Usage):")
        for pod in top_cpu_pods:
            print(f"  - {pod['namespace']}/{pod['pod']}: {pod['cpu_raw']}")
        print(
            "  Recommendation: Investigate these pods further. Check logs, consider profiling (e.g., pprof for Go, async-profiler for Java), or analyze application-specific metrics if available."
        )
    else:
        logger.warning("Could not retrieve top CPU pods.")

    print("-" * 20)  # Separator

    if top_mem_pods:
        logger.info(f"Top {len(top_mem_pods)} Memory Consuming Pods (Current Usage):")
        for pod in top_mem_pods:
            print(f"  - {pod['namespace']}/{pod['pod']}: {pod['mem_raw']}")
        print(
            "  Recommendation: Investigate these pods for memory leaks or inefficient memory usage. Use memory profilers, analyze heap dumps, or check application metrics."
        )
    else:
        logger.warning("Could not retrieve top Memory pods.")

    logger.info("=== Application Bottleneck Identification Finished ===")


if __name__ == "__main__":
    # Check for kubectl
    if (
        subprocess.run(
            ["kubectl", "version", "--client"], capture_output=True, check=False
        ).returncode
        != 0
    ):
        logger.critical(
            "kubectl command not found or failed to run. Please install it."
        )
        sys.exit(2)
    # Check metrics server (basic check)
    logger.info("Checking for metrics-server API availability...")
    if (
        run_kubectl(["api-versions"], parse_json=False, check=False, timeout=10).find(
            "metrics.k8s.io"
        )
        == -1
    ):
        logger.warning(
            "metrics.k8s.io API not found. 'kubectl top' commands will likely fail."
        )
        logger.warning("Ensure metrics-server is deployed and running correctly.")

    main()
