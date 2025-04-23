#!/usr/bin/env python3

import os
import logging
import sys
import subprocess
import json
from collections import defaultdict

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
# Thresholds (similar to analyze_resource_usage.py, but using kubectl top)
# Note: 'kubectl top' provides current usage, not historical average.
# Use Prometheus integration (analyze_resource_usage.py) for average-based analysis.
POD_CPU_LIMIT_NEAR_THRESHOLD = float(os.getenv("POD_CPU_LIMIT_NEAR_THRESHOLD", "90")) # % of limit
POD_MEM_LIMIT_NEAR_THRESHOLD = float(os.getenv("POD_MEM_LIMIT_NEAR_THRESHOLD", "90")) # % of limit
POD_CPU_REQUEST_LOW_THRESHOLD = float(os.getenv("POD_CPU_REQUEST_LOW_THRESHOLD", "10")) # % of request (current usage)
POD_MEM_REQUEST_LOW_THRESHOLD = float(os.getenv("POD_MEM_REQUEST_LOW_THRESHOLD", "20")) # % of request (current usage)
# Namespaces to exclude from analysis (comma-separated)
EXCLUDED_NAMESPACES = os.getenv("EXCLUDED_NAMESPACES", "kube-system,monitoring").split(',')

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("K8sResourceAnalyzer")

# --- Helper Functions ---
def run_kubectl(command, context=KUBECTL_CONTEXT, parse_json=True, check=True, timeout=60):
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
            timeout=timeout
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        if stderr:
            logger.warning(f"kubectl stderr:\n{stderr}")
        if parse_json:
            if not stdout:
                 logger.error("kubectl command returned empty output, cannot parse JSON.")
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
        logger.error(f"kubectl command timed out after {timeout}s: {' '.join(full_command)}")
        return None
    except subprocess.CalledProcessError as e:
        logger.error(f"kubectl command failed with exit code {e.returncode}: {' '.join(full_command)}")
        if e.stderr: logger.error(f"Error output:\n{e.stderr.strip()}")
        return None
    except Exception as e:
        logger.error(f"Failed to run kubectl command {' '.join(full_command)}: {e}")
        return None

def parse_quantity(quantity_str):
    """Parses Kubernetes resource quantities (CPU, Memory)."""
    if not quantity_str:
        return 0.0

    quantity_str = quantity_str.lower()
    if quantity_str.endswith('m'): # CPU millicores
        return float(quantity_str[:-1]) / 1000.0
    elif quantity_str.endswith('ki'): # Memory KiB
        return float(quantity_str[:-2]) * 1024.0
    elif quantity_str.endswith('mi'): # Memory MiB
        return float(quantity_str[:-2]) * 1024.0**2
    elif quantity_str.endswith('gi'): # Memory GiB
        return float(quantity_str[:-2]) * 1024.0**3
    elif quantity_str.endswith('ti'): # Memory TiB
        return float(quantity_str[:-2]) * 1024.0**4
    elif quantity_str.endswith('k'): # Memory KB
        return float(quantity_str[:-1]) * 1000.0
    elif quantity_str.endswith('m'): # Memory MB - Caution: often confused with Mi
        return float(quantity_str[:-1]) * 1000.0**2
    elif quantity_str.endswith('g'): # Memory GB
        return float(quantity_str[:-1]) * 1000.0**3
    elif quantity_str.endswith('t'): # Memory TB
        return float(quantity_str[:-1]) * 1000.0**4
    else: # Assume CPU cores or Bytes
        try:
            return float(quantity_str)
        except ValueError:
            logger.warning(f"Could not parse resource quantity: {quantity_str}")
            return 0.0

# --- Analysis Functions ---

def get_pod_resource_specs():
    """Gets pod resource requests and limits."""
    logger.info("Fetching pod resource specifications (requests/limits)...")
    pods_data = run_kubectl(["get", "pods", "-A", "-o", "json"])
    if not pods_data or "items" not in pods_data:
        logger.error("Failed to fetch pod data.")
        return None

    specs = defaultdict(lambda: {"requests": {"cpu": 0.0, "memory": 0.0},
                                 "limits": {"cpu": 0.0, "memory": 0.0}})

    for pod in pods_data["items"]:
        pod_name = pod["metadata"]["name"]
        namespace = pod["metadata"]["namespace"]
        if namespace in EXCLUDED_NAMESPACES:
            continue

        key = f"{namespace}/{pod_name}"
        for container in pod["spec"].get("containers", []):
            resources = container.get("resources", {})
            requests = resources.get("requests", {})
            limits = resources.get("limits", {})

            specs[key]["requests"]["cpu"] += parse_quantity(requests.get("cpu"))
            specs[key]["requests"]["memory"] += parse_quantity(requests.get("memory"))
            # Use limit if specified, otherwise consider request as limit (for comparison logic)
            # A better approach might involve checking LimitRanges if limits are omitted.
            specs[key]["limits"]["cpu"] += parse_quantity(limits.get("cpu"))
            specs[key]["limits"]["memory"] += parse_quantity(limits.get("memory"))

    return specs

def get_pod_usage_metrics():
    """Gets current pod CPU and Memory usage using 'kubectl top pods'."""
    logger.info("Fetching current pod resource usage (kubectl top pods)...")
    # Note: This requires metrics-server to be installed and running.
    usage_data_str = run_kubectl(["top", "pods", "-A", "--no-headers"], parse_json=False)
    if not usage_data_str:
        logger.error("Failed to fetch pod usage metrics via 'kubectl top pods'. Is metrics-server running?")
        return None

    usage = {}
    lines = usage_data_str.strip().split('\n')
    for line in lines:
        parts = line.split()
        if len(parts) >= 4:
            namespace, pod_name, cpu_usage_str, mem_usage_str = parts[0], parts[1], parts[2], parts[3]
            if namespace in EXCLUDED_NAMESPACES:
                continue
            key = f"{namespace}/{pod_name}"
            usage[key] = {
                "cpu": parse_quantity(cpu_usage_str),
                "memory": parse_quantity(mem_usage_str)
            }
        else:
            logger.warning(f"Could not parse 'kubectl top pods' line: {line}")

    return usage

def analyze_resources(specs, usage):
    """Compares specs and usage to generate recommendations."""
    logger.info("--- Analyzing Pod Resource Usage vs Specifications ---")
    recommendations = []

    if not specs or not usage:
        logger.error("Missing specs or usage data, cannot perform analysis.")
        return recommendations

    for key, current_usage in usage.items():
        if key not in specs:
            logger.warning(f"Usage found for pod '{key}', but no spec data retrieved. Skipping.")
            continue

        pod_spec = specs[key]
        cpu_usage = current_usage["cpu"]
        mem_usage = current_usage["memory"]
        cpu_req = pod_spec["requests"]["cpu"]
        mem_req = pod_spec["requests"]["memory"]
        cpu_lim = pod_spec["limits"]["cpu"]
        mem_lim = pod_spec["limits"]["memory"]

        # Check usage vs limits
        if cpu_lim > 0:
            cpu_usage_vs_limit_pct = (cpu_usage / cpu_lim) * 100
            if cpu_usage_vs_limit_pct > POD_CPU_LIMIT_NEAR_THRESHOLD:
                rec = f"Pod '{key}' current CPU usage ({cpu_usage*1000:.0f}m) is near its limit ({cpu_lim*1000:.0f}m) - {cpu_usage_vs_limit_pct:.1f}%. Consider increasing limit or optimizing."
                logger.warning(rec)
                recommendations.append(rec)
        elif cpu_req > 0 and cpu_usage > cpu_req * 1.5: # Heuristic: High usage without limit set
             rec = f"Pod '{key}' current CPU usage ({cpu_usage*1000:.0f}m) is significantly higher than request ({cpu_req*1000:.0f}m) and has no limit set. Consider setting a limit."
             logger.warning(rec)
             recommendations.append(rec)


        if mem_lim > 0:
            mem_usage_vs_limit_pct = (mem_usage / mem_lim) * 100
            if mem_usage_vs_limit_pct > POD_MEM_LIMIT_NEAR_THRESHOLD:
                rec = f"Pod '{key}' current Memory usage ({mem_usage/1024**2:.1f}Mi) is near its limit ({mem_lim/1024**2:.1f}Mi) - {mem_usage_vs_limit_pct:.1f}%. Investigate leaks, increase limit, or optimize."
                logger.warning(rec)
                recommendations.append(rec)
        elif mem_req > 0 and mem_usage > mem_req * 1.5: # Heuristic: High usage without limit set
             rec = f"Pod '{key}' current Memory usage ({mem_usage/1024**2:.1f}Mi) is significantly higher than request ({mem_req/1024**2:.1f}Mi) and has no limit set. Consider setting a limit."
             logger.warning(rec)
             recommendations.append(rec)


        # Check usage vs requests (low usage)
        if cpu_req > 0:
            cpu_usage_vs_req_pct = (cpu_usage / cpu_req) * 100
            if cpu_usage_vs_req_pct < POD_CPU_REQUEST_LOW_THRESHOLD:
                rec = f"Pod '{key}' current CPU usage ({cpu_usage*1000:.0f}m) is low compared to request ({cpu_req*1000:.0f}m) - {cpu_usage_vs_req_pct:.1f}%. Consider reducing CPU request."
                # Log as info, less critical than hitting limits
                logger.info(rec)
                recommendations.append(rec)

        if mem_req > 0:
            mem_usage_vs_req_pct = (mem_usage / mem_req) * 100
            if mem_usage_vs_req_pct < POD_MEM_REQUEST_LOW_THRESHOLD:
                rec = f"Pod '{key}' current Memory usage ({mem_usage/1024**2:.1f}Mi) is low compared to request ({mem_req/1024**2:.1f}Mi) - {mem_usage_vs_req_pct:.1f}%. Consider reducing Memory request."
                # Log as info
                logger.info(rec)
                recommendations.append(rec)

    return recommendations

# --- Main Execution ---
def main():
    logger.info("=== Starting Kubernetes Resource Allocation Analysis ===")
    logger.warning("NOTE: This script uses 'kubectl top pods' for CURRENT usage.")
    logger.warning("For analysis based on HISTORICAL AVERAGE usage, use 'analyze_resource_usage.py' with Prometheus.")
    logger.info("Prerequisite: Ensure metrics-server is installed and running in the cluster.")

    specs = get_pod_resource_specs()
    usage = get_pod_usage_metrics()

    all_recommendations = analyze_resources(specs, usage)

    logger.info("--- Analysis Summary ---")
    if not all_recommendations:
        logger.info("No major resource optimization recommendations found based on current usage and thresholds.")
    else:
        logger.warning("Potential Optimization Areas Found (based on current usage):")
        # Separate warnings (near limit) from info (low usage)
        warnings = [r for r in all_recommendations if "near its limit" in r or "no limit set" in r]
        infos = [r for r in all_recommendations if "low compared to request" in r]

        if warnings:
             logger.warning("High Usage / Near Limits:")
             for i, rec in enumerate(warnings): print(f"  W{i+1}. {rec}")
        if infos:
             logger.info("Low Usage / Potential Over-requesting:")
             for i, rec in enumerate(infos): print(f"  I{i+1}. {rec}")

    logger.info("=== Kubernetes Resource Allocation Analysis Finished ===")

if __name__ == "__main__":
    # Check for kubectl
    if subprocess.run(["kubectl", "version", "--client"], capture_output=True, check=False).returncode != 0:
         logger.critical("kubectl command not found or failed to run. Please install it.")
         sys.exit(2)
    # Check metrics server (basic check)
    logger.info("Checking for metrics-server API availability...")
    if run_kubectl(["api-versions"], parse_json=False, check=False, timeout=10).find("metrics.k8s.io") == -1:
         logger.warning("metrics.k8s.io API not found. 'kubectl top' commands will likely fail.")
         logger.warning("Ensure metrics-server is deployed and running correctly.")
         # Allow to continue, but usage fetching will fail later.

    main()
