#!/usr/bin/env python3
"""
Log-Metric Correlator Service

This service connects logs from Loki with metrics from Prometheus to provide
correlated analysis during test runs and production deployments.
"""

import os
import time
import json
import logging
from datetime import datetime, timedelta
import threading
import requests
from prometheus_client import Counter, Gauge, start_http_server

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("correlator")

# Configuration
LOKI_URL = os.environ.get("LOKI_URL", "http://loki:3100")
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8080"))
CORRELATION_INTERVAL = int(os.environ.get("CORRELATION_INTERVAL", "60"))  # seconds

# Prometheus metrics
ERROR_LOG_COUNTER = Counter(
    'error_log_count', 'Count of error logs',
    ['component', 'namespace', 'level']
)

ERROR_RATE_GAUGE = Gauge(
    'error_rate', 'Error rate (errors/sec)',
    ['component', 'namespace']
)

CORRELATION_METRIC = Gauge(
    'log_metric_correlation', 'Correlation between logs and metrics',
    ['component', 'namespace', 'metric_name', 'log_pattern']
)

RESOURCE_ANOMALY = Gauge(
    'resource_anomaly', 'Resource usage anomaly with corresponding logs',
    ['component', 'namespace', 'resource_type']
)

class LogMetricCorrelator:
    """Correlate logs from Loki with metrics from Prometheus"""

    def __init__(self):
        """Initialize the correlator"""
        self.loki_url = LOKI_URL
        self.prometheus_url = PROMETHEUS_URL
        logger.info(f"Initialized correlator with Loki: {self.loki_url}, Prometheus: {self.prometheus_url}")

    def query_loki(self, query, start_time=None, end_time=None, limit=100):
        """Query Loki for logs matching the given query"""
        try:
            if not start_time:
                start_time = datetime.now() - timedelta(minutes=15)
            if not end_time:
                end_time = datetime.now()

            # Convert to nanoseconds timestamp
            start_nano = int(start_time.timestamp() * 1_000_000_000)
            end_nano = int(end_time.timestamp() * 1_000_000_000)

            params = {
                "query": query,
                "start": start_nano,
                "end": end_nano,
                "limit": limit,
            }

            response = requests.get(f"{self.loki_url}/loki/api/v1/query_range", params=params)
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to query Loki: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            logger.error(f"Error querying Loki: {str(e)}")
            return None

    def query_prometheus(self, query, start_time=None, end_time=None, step="15s"):
        """Query Prometheus for metrics matching the given query"""
        try:
            if not start_time:
                start_time = datetime.now() - timedelta(minutes=15)
            if not end_time:
                end_time = datetime.now()

            # Convert to Unix timestamp
            start_ts = int(start_time.timestamp())
            end_ts = int(end_time.timestamp())

            params = {
                "query": query,
                "start": start_ts,
                "end": end_ts,
                "step": step,
            }

            response = requests.get(f"{self.prometheus_url}/api/v1/query_range", params=params)
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to query Prometheus: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            logger.error(f"Error querying Prometheus: {str(e)}")
            return None

    def correlate_error_logs_with_metrics(self, component, namespace, log_level="error", time_window_minutes=15):
        """Correlate error logs with relevant metrics for a component"""
        end_time = datetime.now()
        start_time = end_time - timedelta(minutes=time_window_minutes)

        # Query error logs
        log_query = f'{{component="{component}", namespace="{namespace}"}} |= "{log_level}"'
        log_result = self.query_loki(log_query, start_time, end_time)

        # Query relevant metrics
        metric_queries = {
            "cpu_usage": f'sum(rate(container_cpu_usage_seconds_total{{namespace="{namespace}", pod=~"{component}-.*"}}[5m]))',
            "memory_usage": f'sum(container_memory_usage_bytes{{namespace="{namespace}", pod=~"{component}-.*"}})',
            "http_errors": f'sum(rate(http_requests_total{{namespace="{namespace}", job=~".*{component}.*", status=~"5.."}}[5m]))',
        }

        metric_results = {}
        for name, query in metric_queries.items():
            metric_results[name] = self.query_prometheus(query, start_time, end_time)

        # Count error logs
        error_count = 0
        timestamp_groups = []

        if log_result and log_result.get("data") and log_result["data"].get("result"):
            for stream in log_result["data"]["result"]:
                values = stream.get("values", [])
                error_count += len(values)

                # Group timestamps for correlation
                for value in values:
                    timestamp_ns = int(value[0]) // 1_000_000_000  # Convert to seconds
                    timestamp_groups.append(timestamp_ns)

        # Update error log counter
        ERROR_LOG_COUNTER.labels(
            component=component,
            namespace=namespace,
            level=log_level
        ).inc(error_count)

        # Calculate error rate
        if error_count > 0 and time_window_minutes > 0:
            error_rate = error_count / (time_window_minutes * 60)
            ERROR_RATE_GAUGE.labels(
                component=component,
                namespace=namespace
            ).set(error_rate)

        # Correlate metrics with log timestamps
        for metric_name, metric_result in metric_results.items():
            if not metric_result or not metric_result.get("data") or not metric_result["data"].get("result"):
                continue

            data_points = []
            for result in metric_result["data"]["result"]:
                for value in result.get("values", []):
                    data_points.append((int(value[0]), float(value[1])))

            # Skip metrics with no data points
            if not data_points:
                continue

            # Find metric anomalies near log timestamps
            anomaly_score = 0
            for log_ts in timestamp_groups:
                # Find metrics within a 60 second window of the log
                for metric_ts, metric_value in data_points:
                    if abs(log_ts - metric_ts) <= 60:
                        # Increment anomaly score - can be enhanced with more sophisticated algorithm
                        anomaly_score += 1

            # Normalize anomaly score based on number of logs and metrics
            if error_count > 0 and len(data_points) > 0:
                correlation_score = anomaly_score / (error_count * len(data_points))

                # Update correlation metric
                CORRELATION_METRIC.labels(
                    component=component,
                    namespace=namespace,
                    metric_name=metric_name,
                    log_pattern=log_level
                ).set(correlation_score)

                logger.info(f"Correlation score for {component}/{namespace}/{metric_name}: {correlation_score:.4f}")

                # If correlation is significant, set resource anomaly metric
                if correlation_score > 0.5 and metric_name in ["cpu_usage", "memory_usage"]:
                    resource_type = "cpu" if metric_name == "cpu_usage" else "memory"
                    RESOURCE_ANOMALY.labels(
                        component=component,
                        namespace=namespace,
                        resource_type=resource_type
                    ).set(correlation_score)

    def correlate_test_results_with_resources(self):
        """Correlate test results with resource utilization"""
        end_time = datetime.now()
        start_time = end_time - timedelta(hours=1)

        # Query test results
        log_query = '{test_run_id=~".+"} | json'
        log_result = self.query_loki(log_query, start_time, end_time)

        # Query resource metrics
        resource_query = 'sum(test_resource_usage) by (test_name, resource_type, component)'
        resource_result = self.query_prometheus(resource_query, start_time, end_time)

        # Group results
        test_results = {}
        if log_result and log_result.get("data") and log_result["data"].get("result"):
            for stream in log_result["data"]["result"]:
                for value in stream.get("values", []):
                    try:
                        log_data = json.loads(value[1])
                        test_name = log_data.get("test")
                        result = log_data.get("result")

                        if test_name and result:
                            if test_name not in test_results:
                                test_results[test_name] = {"pass": 0, "fail": 0}

                            if result.lower() == "passed":
                                test_results[test_name]["pass"] += 1
                            elif result.lower() == "failed":
                                test_results[test_name]["fail"] += 1
                    except json.JSONDecodeError:
                        continue

        # Match with resource usage
        if resource_result and resource_result.get("data") and resource_result["data"].get("result"):
            for result in resource_result["data"]["result"]:
                test_name = result["metric"].get("test_name", "")
                resource_type = result["metric"].get("resource_type", "")
                component = result["metric"].get("component", "unknown")

                if test_name in test_results:
                    pass_count = test_results[test_name]["pass"]
                    fail_count = test_results[test_name]["fail"]

                    if pass_count + fail_count > 0:
                        failure_rate = fail_count / (pass_count + fail_count)

                        # Check for correlation between resource usage and test failures
                        for value in result.get("values", []):
                            resource_value = float(value[1])

                            # Create correlation metric
                            CORRELATION_METRIC.labels(
                                component=component,
                                namespace="tests",
                                metric_name=f"resource_{resource_type}",
                                log_pattern="test_failure"
                            ).set(failure_rate * resource_value)

                            if failure_rate > 0.2 and resource_value > 0.7:  # High resource use and failures
                                logger.warning(
                                    f"Possible resource-related test failure detected: {test_name} "
                                    f"has {failure_rate:.2%} failures with {resource_value:.2f} {resource_type} usage"
                                )

def run_correlation_loop():
    """Run the correlation loop periodically"""
    correlator = LogMetricCorrelator()

    def correlation_job():
        try:
            # Correlate for key components
            components = [
                ("k3s", "kube-system"),
                ("prometheus", "monitoring"),
                ("traefik", "traefik-system"),
                ("home-assistant", "home-automation"),
            ]

            for component, namespace in components:
                correlator.correlate_error_logs_with_metrics(component, namespace)

            # Correlate test results with resource usage
            correlator.correlate_test_results_with_resources()

        except Exception as e:
            logger.error(f"Error in correlation job: {str(e)}")

    # Run immediately once
    correlation_job()

    # Schedule periodic runs
    while True:
        time.sleep(CORRELATION_INTERVAL)
        correlation_job()

if __name__ == "__main__":
    # Start Prometheus metrics server
    start_http_server(LISTEN_PORT)
    logger.info(f"Started metrics server on port {LISTEN_PORT}")

    # Run correlation in background thread
    thread = threading.Thread(target=run_correlation_loop, daemon=True)
    thread.start()

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down correlator service")
