import os
import time
from typing import Dict, Any, List, Optional, Union
import logging

import pytest
import requests
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, Summary, push_to_gateway

logger = logging.getLogger(__name__)

class PrometheusTestHelper:
    """
    Helper class for working with Prometheus metrics in tests.
    This allows for both generating test metrics and querying Prometheus for validation.
    """

    def __init__(self, prometheus_url: Optional[str] = None, pushgateway_url: Optional[str] = None):
        self.prometheus_url = prometheus_url or os.environ.get("PROMETHEUS_URL", "http://localhost:9090")
        self.pushgateway_url = pushgateway_url or os.environ.get("PUSHGATEWAY_URL", "http://localhost:9091")
        self.registry = CollectorRegistry()
        self.test_run_id = os.environ.get("TEST_RUN_ID", f"test-{int(time.time())}")
        self.job_name = os.environ.get("TEST_JOB_NAME", "molecule-tests")

        # Initialize common metrics
        self.test_duration = Histogram(
            'test_duration_seconds',
            'Test execution duration in seconds',
            ['test_name', 'test_file', 'component'],
            registry=self.registry
        )
        self.test_success = Counter(
            'test_success_total',
            'Number of successful tests',
            ['test_name', 'test_file', 'component'],
            registry=self.registry
        )
        self.test_failure = Counter(
            'test_failure_total',
            'Number of failed tests',
            ['test_name', 'test_file', 'component'],
            registry=self.registry
        )
        self.resource_usage = Gauge(
            'test_resource_usage',
            'Resource usage during test',
            ['test_name', 'resource_type', 'component'],
            registry=self.registry
        )

    def record_test_result(self, test_name: str, success: bool, duration: float,
                           test_file: str = "unknown", component: str = "unknown") -> None:
        """Record test result as Prometheus metrics"""
        labels = {"test_name": test_name, "test_file": test_file, "component": component}

        self.test_duration.labels(
            test_name=test_name,
            test_file=test_file,
            component=component
        ).observe(duration)

        if success:
            self.test_success.labels(
                test_name=test_name,
                test_file=test_file,
                component=component
            ).inc()
        else:
            self.test_failure.labels(
                test_name=test_name,
                test_file=test_file,
                component=component
            ).inc()

    def record_resource_usage(self, test_name: str, resource_type: str, value: float,
                              component: str = "unknown") -> None:
        """Record resource usage during test"""
        self.resource_usage.labels(
            test_name=test_name,
            resource_type=resource_type,
            component=component
        ).set(value)

    def push_metrics(self, grouping_key: Optional[Dict[str, str]] = None) -> bool:
        """Push metrics to Pushgateway"""
        try:
            if not grouping_key:
                grouping_key = {
                    "test_run_id": self.test_run_id,
                    "instance": os.environ.get("HOSTNAME", "localhost")
                }

            push_to_gateway(
                self.pushgateway_url,
                job=self.job_name,
                registry=self.registry,
                grouping_key=grouping_key
            )
            return True
        except Exception as e:
            logger.error(f"Failed to push metrics to Pushgateway: {str(e)}")
            return False

    def query_prometheus(self, query: str, time_window: str = "5m") -> Dict[str, Any]:
        """
        Query Prometheus using PromQL

        Args:
            query: PromQL query string
            time_window: Time window for the query (e.g. "5m" for 5 minutes)

        Returns:
            Dict containing query results
        """
        try:
            params = {
                "query": query,
                "time": int(time.time())
            }
            response = requests.get(f"{self.prometheus_url}/api/v1/query", params=params)
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to query Prometheus: {response.status_code} - {response.text}")
                return {"status": "error", "error": f"HTTP {response.status_code}", "data": None}
        except Exception as e:
            logger.error(f"Error querying Prometheus: {str(e)}")
            return {"status": "error", "error": str(e), "data": None}

    def query_range(self, query: str, start_time: int, end_time: int, step: str = "15s") -> Dict[str, Any]:
        """
        Query Prometheus for a range of time

        Args:
            query: PromQL query string
            start_time: Start timestamp in seconds
            end_time: End timestamp in seconds
            step: Step interval (e.g. "15s", "1m")

        Returns:
            Dict containing query results
        """
        try:
            params = {
                "query": query,
                "start": start_time,
                "end": end_time,
                "step": step
            }
            response = requests.get(f"{self.prometheus_url}/api/v1/query_range", params=params)
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to query Prometheus range: {response.status_code} - {response.text}")
                return {"status": "error", "error": f"HTTP {response.status_code}", "data": None}
        except Exception as e:
            logger.error(f"Error querying Prometheus range: {str(e)}")
            return {"status": "error", "error": str(e), "data": None}

    def check_metric_threshold(self, metric_query: str, operator: str, threshold: Union[int, float]) -> bool:
        """
        Check if a metric meets a threshold condition

        Args:
            metric_query: PromQL query that returns a single value
            operator: Comparison operator ('>', '<', '>=', '<=', '==', '!=')
            threshold: Threshold value to compare against

        Returns:
            Boolean indicating if the condition is met
        """
        result = self.query_prometheus(metric_query)
        if result.get("status") != "success" or not result.get("data", {}).get("result"):
            return False

        try:
            # Extract the value from the result
            value = float(result["data"]["result"][0]["value"][1])

            # Compare using the specified operator
            if operator == '>':
                return value > threshold
            elif operator == '<':
                return value < threshold
            elif operator == '>=':
                return value >= threshold
            elif operator == '<=':
                return value <= threshold
            elif operator == '==':
                return value == threshold
            elif operator == '!=':
                return value != threshold
            else:
                logger.error(f"Unknown operator: {operator}")
                return False
        except (KeyError, IndexError, ValueError) as e:
            logger.error(f"Error processing metric value: {str(e)}")
            return False

    def get_k8s_resource_metrics(self, namespace: str, resource_type: str,
                                resource_name: str) -> Dict[str, Any]:
        """
        Get metrics for a Kubernetes resource

        Args:
            namespace: Kubernetes namespace
            resource_type: Resource type (pod, deployment, etc.)
            resource_name: Name of the resource

        Returns:
            Dict containing resource metrics
        """
        metrics = {
            "cpu": self.query_prometheus(
                f'sum(rate(container_cpu_usage_seconds_total{{namespace="{namespace}",'
                f'pod=~"{resource_name}.*"}}[5m]))'
            ),
            "memory": self.query_prometheus(
                f'sum(container_memory_usage_bytes{{namespace="{namespace}",'
                f'pod=~"{resource_name}.*"}})'
            ),
            "restarts": self.query_prometheus(
                f'sum(kube_pod_container_status_restarts_total{{namespace="{namespace}",'
                f'pod=~"{resource_name}.*"}})'
            )
        }

        if resource_type in ["deployment", "statefulset", "daemonset"]:
            metrics["available_replicas"] = self.query_prometheus(
                f'kube_{resource_type}_status_replicas_available{{namespace="{namespace}",'
                f'name="{resource_name}"}}'
            )
            metrics["desired_replicas"] = self.query_prometheus(
                f'kube_{resource_type}_spec_replicas{{namespace="{namespace}",'
                f'name="{resource_name}"}}'
            )

        return metrics


@pytest.fixture(scope="session")
def prometheus_helper():
    """Return a PrometheusTestHelper instance for the test session"""
    return PrometheusTestHelper()


@pytest.fixture(scope="function")
def prometheus_test_metrics(request, prometheus_helper):
    """Fixture to record test metrics automatically"""
    # Setup
    test_name = request.node.name
    test_file = request.node.fspath.basename
    component = os.environ.get("TEST_COMPONENT", "unknown")

    # Extract component from path if possible
    path_parts = str(request.node.fspath).split('/')
    if "pulumi" in path_parts:
        idx = path_parts.index("pulumi")
        if idx + 1 < len(path_parts):
            component = path_parts[idx + 1]
    elif "ansible" in path_parts and "roles" in path_parts:
        idx = path_parts.index("roles")
        if idx + 1 < len(path_parts):
            component = path_parts[idx + 1]

    start_time = time.time()

    yield prometheus_helper

    # Record test duration and result
    duration = time.time() - start_time
    success = not request.node.rep_call.failed if hasattr(request.node, "rep_call") else True
    prometheus_helper.record_test_result(
        test_name=test_name,
        success=success,
        duration=duration,
        test_file=test_file,
        component=component
    )

    # Push metrics at end of test
    prometheus_helper.push_metrics()


# Add hook to ensure the fixtures work properly
@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    setattr(item, f"rep_{rep.when}", rep)
