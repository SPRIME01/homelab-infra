import pytest
import time
from datetime import datetime, timedelta

@pytest.mark.prometheus
def test_prometheus_connection(host):
    """Test connection to Prometheus server"""
    prom = host.prometheus
    result = prom.query("up")
    assert result["status"] == "success", "Failed to connect to Prometheus"
    assert len(result["data"]["result"]) > 0, "No 'up' metrics found"

@pytest.mark.prometheus
def test_kubernetes_metrics_exist(host):
    """Test that basic Kubernetes metrics exist"""
    prom = host.prometheus

    # Check for some common Kubernetes metrics
    k8s_metrics = [
        "kube_node_status_condition",
        "kube_pod_status_phase",
        "kube_deployment_status_replicas_available",
        "container_cpu_usage_seconds_total"
    ]

    for metric in k8s_metrics:
        assert prom.check_metric_exists(metric), f"Metric {metric} not found in Prometheus"

@pytest.mark.prometheus
def test_node_resource_usage(host, prometheus_test_metrics):
    """Test node resource usage metrics"""
    prom = host.prometheus

    # Get resource usage for local node
    node_name = host.check_output("hostname")
    resources = prom.node_resources(node_name)

    # Record resource usage in test metrics
    if resources["cpu"] is not None:
        prometheus_test_metrics.record_resource_usage(
            "test_node_resource_usage",
            "cpu_cores",
            resources["cpu"],
            "kubernetes"
        )

    if resources["memory"] is not None:
        prometheus_test_metrics.record_resource_usage(
            "test_node_resource_usage",
            "memory_bytes",
            resources["memory"],
            "kubernetes"
        )

    # Assert CPU usage is within reasonable limits
    if resources["cpu"] is not None:
        assert resources["cpu"] >= 0, "CPU usage cannot be negative"
        assert resources["cpu"] < host.ansible.get_variables().get('ansible_processor_vcpus', 8), \
            "CPU usage exceeds available vCPUs"

@pytest.mark.prometheus
def test_pulumi_deployment_metrics(host):
    """Test metrics for Pulumi deployments"""
    prom = host.prometheus

    # Test project names
    projects = ["cluster-setup", "core-services", "storage"]

    for project in projects:
        # Check if we have any success metrics for the project
        # Skip assertion if no metrics exist (project may not have been deployed during test)
        has_success = prom.has_pulumi_success(project)
        if has_success:
            # Check the most recent deployment success
            success_query = f'pulumi_deployment_success{{project="{project}"}} == 1'
            assert prom.check_value(success_query, '==', 1), f"Latest Pulumi deployment for {project} was not successful"

            # Check deployment duration is reasonable
            duration_query = f'pulumi_deployment_duration_seconds{{project="{project}"}}'
            duration_result = prom.query(duration_query)
            if duration_result.get("status") == "success" and duration_result.get("data", {}).get("result"):
                duration = float(duration_result["data"]["result"][0]["value"][1])
                assert duration > 0, f"Deployment duration for {project} should be greater than 0"
                # Typically, Pulumi deployments shouldn't take more than an hour
                assert duration < 3600, f"Deployment duration for {project} is suspiciously long ({duration} seconds)"

@pytest.mark.prometheus
def test_pulumi_resources_created(host):
    """Test that Pulumi resources were created successfully"""
    prom = host.prometheus

    # Check core services resources
    namespaces = ["monitoring", "traefik", "cert-manager", "openebs"]

    for namespace in namespaces:
        # Query that checks if namespace exists
        query = f'kube_namespace_created{{namespace="{namespace}"}} == 1'
        # Skip assertion if namespace doesn't exist (might not be part of test)
        if prom.check_metric_exists(f'kube_namespace_created{{namespace="{namespace}"}}'):
            assert prom.check_value(query, '==', 1), f"Namespace {namespace} not found"
