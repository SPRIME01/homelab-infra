#!/usr/bin/env python3

import json
import logging
import os
import sys
from datetime import datetime, timedelta

import requests

# --- Configuration ---
PROMETHEUS_URL = os.getenv(
    "PROMETHEUS_URL", "http://prometheus.homelab:9090"
)  # URL of your Prometheus server
# Thresholds for reporting (adjust based on your environment)
NODE_CPU_HIGH_THRESHOLD = float(os.getenv("NODE_CPU_HIGH_THRESHOLD", "80"))  # % usage
NODE_MEM_HIGH_THRESHOLD = float(os.getenv("NODE_MEM_HIGH_THRESHOLD", "85"))  # % usage
NODE_DISK_HIGH_THRESHOLD = float(
    os.getenv("NODE_DISK_HIGH_THRESHOLD", "80")
)  # % usage (for root filesystem)
POD_CPU_LIMIT_NEAR_THRESHOLD = float(
    os.getenv("POD_CPU_LIMIT_NEAR_THRESHOLD", "90")
)  # % of limit reached
POD_MEM_LIMIT_NEAR_THRESHOLD = float(
    os.getenv("POD_MEM_LIMIT_NEAR_THRESHOLD", "90")
)  # % of limit reached
POD_CPU_REQUEST_LOW_THRESHOLD = float(
    os.getenv("POD_CPU_REQUEST_LOW_THRESHOLD", "20")
)  # % of request used (potential over-request)
POD_MEM_REQUEST_LOW_THRESHOLD = float(
    os.getenv("POD_MEM_REQUEST_LOW_THRESHOLD", "30")
)  # % of request used (potential over-request)

QUERY_DURATION = os.getenv(
    "QUERY_DURATION", "1h"
)  # Time window for average usage queries
QUERY_STEP = os.getenv("QUERY_STEP", "5m")  # Resolution for queries

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("ResourceAnalyzer")


# --- Helper Functions ---
def query_prometheus(query):
    """Queries Prometheus API."""
    api_endpoint = f"{PROMETHEUS_URL}/api/v1/query"
    logger.info(f"Querying Prometheus: {query}")
    try:
        response = requests.get(api_endpoint, params={"query": query}, timeout=30)
        response.raise_for_status()  # Raise HTTPError for bad responses (4xx or 5xx)
        result = response.json()
        if result["status"] == "success":
            return result["data"]["result"]
        else:
            logger.error(
                f"Prometheus query failed: {result.get('error', 'Unknown error')}"
            )
            return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Error connecting to Prometheus at {PROMETHEUS_URL}: {e}")
        return None
    except json.JSONDecodeError:
        logger.error(f"Failed to decode JSON response from Prometheus.")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred during Prometheus query: {e}")
        return None


# --- Analysis Functions ---


def analyze_node_resources():
    """Analyzes CPU, Memory, and Disk usage for Kubernetes nodes."""
    logger.info("--- Analyzing Node Resource Usage ---")
    recommendations = []

    # Node CPU Usage (Average over duration) - Requires node-exporter
    # Query assumes 'instance' label matches node name and filters out non-node metrics
    cpu_query = f'100 - (avg by (instance) (rate(node_cpu_seconds_total{{mode="idle"}}[{QUERY_DURATION}])) * 100)'
    cpu_results = query_prometheus(cpu_query)

    if cpu_results:
        for item in cpu_results:
            node = (
                item["metric"].get("instance", "unknown").split(":")[0]
            )  # Extract node name
            usage = float(item["value"][1])
            logger.info(
                f"Node '{node}': Avg CPU Usage ({QUERY_DURATION}) = {usage:.2f}%"
            )
            if usage > NODE_CPU_HIGH_THRESHOLD:
                rec = f"Node '{node}' CPU usage ({usage:.2f}%) is high (>{NODE_CPU_HIGH_THRESHOLD}%). Investigate high-CPU pods or consider scaling."
                logger.warning(rec)
                recommendations.append(rec)

    # Node Memory Usage - Requires node-exporter
    mem_query = (
        f"(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100"
    )
    mem_results = query_prometheus(mem_query)

    if mem_results:
        for item in mem_results:
            node = item["metric"].get("instance", "unknown").split(":")[0]
            usage = float(item["value"][1])
            logger.info(f"Node '{node}': Current Memory Usage = {usage:.2f}%")
            if usage > NODE_MEM_HIGH_THRESHOLD:
                rec = f"Node '{node}' Memory usage ({usage:.2f}%) is high (>{NODE_MEM_HIGH_THRESHOLD}%). Investigate high-memory pods or consider adding RAM."
                logger.warning(rec)
                recommendations.append(rec)

    # Node Disk Usage (Root filesystem) - Requires node-exporter
    disk_query = f'(1 - (node_filesystem_avail_bytes{{mountpoint="/",fstype!="tmpfs"}} / node_filesystem_size_bytes{{mountpoint="/",fstype!="tmpfs"}})) * 100'
    disk_results = query_prometheus(disk_query)

    if disk_results:
        for item in disk_results:
            node = item["metric"].get("instance", "unknown").split(":")[0]
            usage = float(item["value"][1])
            logger.info(f"Node '{node}': Root Disk Usage = {usage:.2f}%")
            if usage > NODE_DISK_HIGH_THRESHOLD:
                rec = f"Node '{node}' Root Disk usage ({usage:.2f}%) is high (>{NODE_DISK_HIGH_THRESHOLD}%). Clean up disk space (logs, images) or expand storage."
                logger.warning(rec)
                recommendations.append(rec)

    return recommendations


def analyze_pod_resources():
    """Analyzes Pod CPU and Memory usage relative to requests/limits."""
    logger.info("--- Analyzing Pod Resource Usage vs Requests/Limits ---")
    # Requires kube-state-metrics and metrics-server installed and scraped by Prometheus
    recommendations = []

    # Pod CPU Usage vs Limits
    cpu_limit_query = f'(sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{{container!="", pod!=""}}[{QUERY_DURATION}]))) / (sum by (namespace, pod) (kube_pod_container_resource_limits{{resource="cpu", unit="core"}})) * 100'
    cpu_limit_results = query_prometheus(cpu_limit_query)
    if cpu_limit_results:
        for item in cpu_limit_results:
            ns = item["metric"].get("namespace", "unknown")
            pod = item["metric"].get("pod", "unknown")
            usage_percent_limit = float(item["value"][1])
            logger.info(
                f"Pod '{ns}/{pod}': Avg CPU Usage vs Limit ({QUERY_DURATION}) = {usage_percent_limit:.2f}%"
            )
            if usage_percent_limit > POD_CPU_LIMIT_NEAR_THRESHOLD:
                rec = f"Pod '{ns}/{pod}' CPU usage ({usage_percent_limit:.2f}%) is nearing its limit (>{POD_CPU_LIMIT_NEAR_THRESHOLD}%). Consider increasing CPU limit or optimizing the application."
                logger.warning(rec)
                recommendations.append(rec)

    # Pod Memory Usage vs Limits
    mem_limit_query = f'(sum by (namespace, pod) (container_memory_working_set_bytes{{container!="", pod!=""}})) / (sum by (namespace, pod) (kube_pod_container_resource_limits{{resource="memory", unit="byte"}})) * 100'
    mem_limit_results = query_prometheus(mem_limit_query)
    if mem_limit_results:
        for item in mem_limit_results:
            ns = item["metric"].get("namespace", "unknown")
            pod = item["metric"].get("pod", "unknown")
            usage_percent_limit = float(item["value"][1])
            logger.info(
                f"Pod '{ns}/{pod}': Current Memory Usage vs Limit = {usage_percent_limit:.2f}%"
            )
            if usage_percent_limit > POD_MEM_LIMIT_NEAR_THRESHOLD:
                rec = f"Pod '{ns}/{pod}' Memory usage ({usage_percent_limit:.2f}%) is nearing its limit (>{POD_MEM_LIMIT_NEAR_THRESHOLD}%). Investigate memory leaks, increase limit, or optimize."
                logger.warning(rec)
                recommendations.append(rec)

    # Pod CPU Usage vs Requests (Low Usage -> Potential Over-requesting)
    cpu_req_query = f'(sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{{container!="", pod!=""}}[{QUERY_DURATION}]))) / (sum by (namespace, pod) (kube_pod_container_resource_requests{{resource="cpu", unit="core"}})) * 100'
    cpu_req_results = query_prometheus(cpu_req_query)
    if cpu_req_results:
        for item in cpu_req_results:
            ns = item["metric"].get("namespace", "unknown")
            pod = item["metric"].get("pod", "unknown")
            usage_percent_req = float(item["value"][1])
            # logger.info(f"Pod '{ns}/{pod}': Avg CPU Usage vs Request ({QUERY_DURATION}) = {usage_percent_req:.2f}%") # Can be noisy
            if usage_percent_req < POD_CPU_REQUEST_LOW_THRESHOLD:
                rec = f"Pod '{ns}/{pod}' average CPU usage ({usage_percent_req:.2f}%) is low compared to its request (<{POD_CPU_REQUEST_LOW_THRESHOLD}%). Consider reducing CPU request to improve scheduling density."
                logger.warning(rec)
                recommendations.append(rec)

    # Pod Memory Usage vs Requests (Low Usage -> Potential Over-requesting)
    mem_req_query = f'(sum by (namespace, pod) (container_memory_working_set_bytes{{container!="", pod!=""}})) / (sum by (namespace, pod) (kube_pod_container_resource_requests{{resource="memory", unit="byte"}})) * 100'
    mem_req_results = query_prometheus(mem_req_query)
    if mem_req_results:
        for item in mem_req_results:
            ns = item["metric"].get("namespace", "unknown")
            pod = item["metric"].get("pod", "unknown")
            usage_percent_req = float(item["value"][1])
            # logger.info(f"Pod '{ns}/{pod}': Current Memory Usage vs Request = {usage_percent_req:.2f}%") # Can be noisy
            if usage_percent_req < POD_MEM_REQUEST_LOW_THRESHOLD:
                rec = f"Pod '{ns}/{pod}' memory usage ({usage_percent_req:.2f}%) is low compared to its request (<{POD_MEM_REQUEST_LOW_THRESHOLD}%). Consider reducing memory request."
                logger.warning(rec)
                recommendations.append(rec)

    return recommendations


# --- Main Execution ---
def main():
    logger.info("=== Starting Resource Usage Analysis ===")
    all_recommendations = []

    # Check Prometheus connection
    if query_prometheus("vector(1)") is None:
        logger.critical("Cannot connect to Prometheus or basic query failed. Aborting.")
        sys.exit(1)

    logger.info(
        "Prerequisites: Ensure node-exporter, kube-state-metrics, and metrics-server are running and scraped by Prometheus."
    )

    node_recs = analyze_node_resources()
    all_recommendations.extend(node_recs)

    pod_recs = analyze_pod_resources()
    all_recommendations.extend(pod_recs)

    logger.info("--- Analysis Summary ---")
    if not all_recommendations:
        logger.info(
            "No major resource optimization recommendations found based on current thresholds."
        )
    else:
        logger.warning("Potential Optimization Areas Found:")
        for i, rec in enumerate(all_recommendations):
            print(f"{i+1}. {rec}")

    logger.info("=== Resource Usage Analysis Finished ===")


if __name__ == "__main__":
    # Basic dependency check
    try:
        import requests
    except ImportError:
        logger.critical(
            "Missing required Python library: requests. Please install it (`pip install requests`)."
        )
        sys.exit(2)

    main()
