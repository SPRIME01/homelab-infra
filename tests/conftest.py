import pytest
import os
import sys

# Add utils to path for importing helpers
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests.utils.logging_helper import test_log_manager, test_logger
from tests.utils.prometheus_helper import prometheus_helper, prometheus_test_metrics
import tests.utils.testinfra_prometheus  # Import to register the module

# Common fixtures for all tests

@pytest.fixture
def k8s_resources():
    """Fixture providing Kubernetes resource definitions for testing"""
    return {
        "namespace": {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": "test-namespace"
            }
        },
        "service": {
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {
                "name": "test-service",
                "namespace": "test-namespace"
            },
            "spec": {
                "selector": {
                    "app": "test-app"
                },
                "ports": [
                    {
                        "port": 80,
                        "targetPort": 8080
                    }
                ]
            }
        },
        "deployment": {
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": {
                "name": "test-deployment",
                "namespace": "test-namespace"
            },
            "spec": {
                "replicas": 1,
                "selector": {
                    "matchLabels": {
                        "app": "test-app"
                    }
                },
                "template": {
                    "metadata": {
                        "labels": {
                            "app": "test-app"
                        }
                    },
                    "spec": {
                        "containers": [
                            {
                                "name": "test-container",
                                "image": "nginx:latest"
                            }
                        ]
                    }
                }
            }
        }
    }


@pytest.fixture
def kubectl_mock():
    """Mock kubectl for testing"""
    class KubectlMock:
        def __init__(self):
            self.resources = {}
            self.commands = []
        
        def apply(self, resource):
            key = f"{resource.get('kind')}/{resource['metadata']['name']}"
            self.resources[key] = resource
            self.commands.append(("apply", resource))
            return {"status": "created", "resource": key}
        
        def get(self, resource_type, name=None, namespace=None):
            matches = []
            for key, resource in self.resources.items():
                if resource.get('kind') == resource_type:
                    if name is None or resource['metadata'].get('name') == name:
                        if namespace is None or resource['metadata'].get('namespace') == namespace:
                            matches.append(resource)
            self.commands.append(("get", resource_type, name, namespace))
            return matches
        
        def delete(self, resource_type, name, namespace=None):
            key = f"{resource_type}/{name}"
            if key in self.resources:
                del self.resources[key]
            self.commands.append(("delete", resource_type, name, namespace))
            return {"status": "deleted", "resource": key}
            
    return KubectlMock()


@pytest.fixture
def mock_docker():
    """Mock Docker client for container tests"""
    class DockerMock:
        def __init__(self):
            self.containers = {}
            self.images = {}
            self.commands = []
            
        def run_container(self, image, name=None, command=None, environment=None):
            container_id = f"container_{len(self.containers) + 1}"
            self.containers[container_id] = {
                "image": image,
                "name": name,
                "command": command,
                "environment": environment,
                "status": "running"
            }
            self.commands.append(("run", image, name, command))
            return container_id
            
        def stop_container(self, container_id):
            if container_id in self.containers:
                self.containers[container_id]["status"] = "stopped"
            self.commands.append(("stop", container_id))
            
        def remove_container(self, container_id):
            if container_id in self.containers:
                del self.containers[container_id]
            self.commands.append(("remove", container_id))
                
    return DockerMock()


@pytest.fixture
def metrics_client():
    """Fixture for accessing test metrics"""
    class MetricsClient:
        def __init__(self):
            self.metrics = {}
            
        def record_metric(self, name, value, labels=None):
            if name not in self.metrics:
                self.metrics[name] = []
            self.metrics[name].append({
                "value": value,
                "labels": labels or {},
                "timestamp": os.environ.get("PYTEST_CURRENT_TEST", "unknown")
            })
            
        def get_metric(self, name):
            return self.metrics.get(name, [])
            
    return MetricsClient()


@pytest.fixture
def host_metrics(host):
    """Fixture providing host resource metrics"""
    import psutil
    
    def collect_metrics():
        cpu = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        return {
            "cpu": {
                "percent": cpu,
            },
            "memory": {
                "total": memory.total,
                "available": memory.available,
                "used": memory.used,
                "percent": memory.percent,
            },
            "disk": {
                "total": disk.total,
                "used": disk.used,
                "free": disk.free,
                "percent": disk.percent,
            }
        }
    
    return collect_metrics
