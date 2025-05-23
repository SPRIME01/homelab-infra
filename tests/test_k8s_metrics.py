import pytest
import time
from datetime import datetime, timedelta

@pytest.mark.prometheus
@pytest.mark.k8s
def test_cluster_health(host, prometheus_test_metrics):
    """Test K3s cluster health using Prometheus metrics"""
    prom = host.prometheus

    # Check node status
    query = 'kube_node_status_condition{condition="Ready", status="true"}'
    assert prom.check_metric_exists(query), "No nodes are in Ready state"

    # Record node count metric
    node_count_result = prom.query('count(kube_node_info)')
    if node_count_result.get("status") == "success" and node_count_result.get("data", {}).get("result"):
        node_count = float(node_count_result["data"]["result"][0]["value"][1])
        prometheus_test_metrics.record_resource_usage(
            "test_cluster_health",
            "node_count",
            node_count,
            "kubernetes"
        )

    # Verify essential namespaces exist
    essential_namespaces = ["kube-system", "default"]
    for namespace in essential_namespaces:
        query = f'kube_namespace_created{{namespace="{namespace}"}} == 1'
        assert prom.check_value(query, '==', 1), f"Namespace {namespace} not found"

    # Check pod readiness in kube-system
    query = 'sum(kube_pod_status_phase{namespace="kube-system", phase="Running"}) > 0'
    assert prom.check_value(query, '==', 1), "No running pods found in kube-system namespace"

    # Check for pod restarts
    restarts = prom.pod_restarts("kube-system", ".*")
    if restarts > 5:  # Alert if there are too many restarts
        pytest.xfail(f"High number of pod restarts detected: {restarts}")

@pytest.mark.prometheus
def test_resource_utilization(host, prometheus_test_metrics):
    """Test that resource utilization is within acceptable limits"""
    prom = host.prometheus

    # Check CPU utilization is below 90%
    query = '100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
    cpu_result = prom.query(query)

    if cpu_result.get("status") == "success" and cpu_result.get("data", {}).get("result"):
        cpu_usage = float(cpu_result["data"]["result"][0]["value"][1])
        prometheus_test_metrics.record_resource_usage(
            "test_resource_utilization",
            "cpu_percent",
            cpu_usage,
            "host"
        )
        assert cpu_usage < 90, f"CPU usage too high: {cpu_usage}%"

    # Check memory utilization is below 90%
    query = '100 * (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes'
    mem_result = prom.query(query)

    if mem_result.get("status") == "success" and mem_result.get("data", {}).get("result"):
        mem_usage = float(mem_result["data"]["result"][0]["value"][1])
        prometheus_test_metrics.record_resource_usage(
            "test_resource_utilization",
            "memory_percent",
            mem_usage,
            "host"
        )
        assert mem_usage < 90, f"Memory usage too high: {mem_usage}%"

    # Check disk utilization is below 85%
    query = '100 - ((node_filesystem_avail_bytes{mountpoint="/"} * 100) / node_filesystem_size_bytes{mountpoint="/"})'
    disk_result = prom.query(query)

    if disk_result.get("status") == "success" and disk_result.get("data", {}).get("result"):
        disk_usage = float(disk_result["data"]["result"][0]["value"][1])
        prometheus_test_metrics.record_resource_usage(
            "test_resource_utilization",
            "disk_percent",
            disk_usage,
            "host"
        )
        assert disk_usage < 85, f"Disk usage too high: {disk_usage}%"

@pytest.mark.prometheus
def test_pulumi_deployment_health(host):
    """Test that Pulumi deployments are successful"""
    prom = host.prometheus

    # Check core stacks
    stacks = ["cluster-setup", "core-services", "storage"]

    for stack in stacks:
        # Check if we have metrics for this stack (skip if not deployed)
        if prom.check_metric_exists(f'pulumi_deployments_total{{project="{stack}"}}'):
            # Verify most recent deployment was successful
            assert prom.has_pulumi_success(stack), f"Latest Pulumi deployment for {stack} was not successful"

            # Check deployment duration is reasonable
            duration_query = f'pulumi_deployment_duration_seconds{{project="{stack}"}}'
            duration_result = prom.query(duration_query)

            if duration_result.get("status") == "success" and duration_result.get("data", {}).get("result"):
                duration = float(duration_result["data"]["result"][0]["value"][1])
                assert duration > 0, f"Deployment duration for {stack} should be greater than 0"
                assert duration < 3600, f"Deployment duration for {stack} is suspiciously long: {duration}s"

            # Verify resource creation metrics
            resource_query = f'pulumi_resources_created{{project="{stack}"}}'
            if prom.check_metric_exists(resource_query):
                resources_result = prom.query(resource_query)
                if resources_result.get("status") == "success" and resources_result.get("data", {}).get("result"):
                    resources = float(resources_result["data"]["result"][0]["value"][1])
                    assert resources >= 0, "Resource count cannot be negative"
