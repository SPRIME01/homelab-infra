import os
import sys
import json
import pytest

class PulumiMocks:
    """Class to provide mock functionality similar to Pulumi's runtime.setMocks()"""

    @staticmethod
    def new_resource(args):
        """Mock resource creation"""
        resource_type = args["type"]
        resource_name = args["name"]
        resource_inputs = args["inputs"] or {}

        # Create a deterministic ID based on resource type and name
        resource_id = f"{resource_name}-{resource_type}-id"

        # For Kubernetes resources, apply some specific mocking
        if resource_type.startswith("kubernetes:"):
            # Apply default namespace if not set and it's a namespaced resource
            if "metadata" in resource_inputs and "namespace" not in resource_inputs["metadata"]:
                if not resource_type.endswith("Namespace") and not resource_type.endswith("ClusterRole"):
                    resource_inputs["metadata"]["namespace"] = "default"

        return {
            "id": resource_id,
            "state": resource_inputs
        }

    @staticmethod
    def call(args):
        """Mock function calls"""
        return args["inputs"] or {}


class PulumiTestFixture:
    """Helper class for testing Pulumi stacks in Python"""

    def __init__(self, project_dir):
        self.project_dir = project_dir
        self.resources = []
        self.mocks = PulumiMocks()

    def setup_mocks(self):
        """Set up mocks for testing"""
        # In a real implementation, this would hook into Pulumi's runtime
        pass

    def apply_stack(self, stack_name="dev"):
        """Apply the stack changes (simulated)"""
        # Simulate resource creation
        self.resources = self._get_mock_resources()
        return self.resources

    def preview_stack(self):
        """Preview stack changes (simulated)"""
        return {
            "changes": len(self._get_mock_resources()),
            "creates": 2,
            "updates": 1,
            "deletes": 0
        }

    def get_outputs(self):
        """Get stack outputs based on project type"""
        project_name = os.path.basename(self.project_dir)

        if project_name == "cluster-setup":
            return {
                "kubeconfig": "/tmp/kube/config",
                "clusterEndpoint": "https://192.168.1.100:6443",
                "clusterName": "test-cluster"
            }
        elif project_name == "storage":
            return {
                "openEBSStatus": "Deployed",
                "defaultStorageClass": "openebs-hostpath"
            }
        elif project_name == "core-services":
            return {
                "certManagerStatus": "Deployed",
                "traefikEndpoint": "http://192.168.1.100:80"
            }
        return {}

    def _get_mock_resources(self):
        """Get mock resources based on project type"""
        project_name = os.path.basename(self.project_dir)

        if project_name == "cluster-setup":
            return [
                {"type": "kubernetes:core/v1:Namespace", "name": "monitoring", "change": "create"},
                {"type": "kubernetes:core/v1:Namespace", "name": "apps", "change": "create"},
                {"type": "kubernetes:core/v1:ServiceAccount", "name": "monitoring-admin", "change": "create"}
            ]
        elif project_name == "storage":
            return [
                {"type": "kubernetes:core/v1:Namespace", "name": "openebs", "change": "create"},
                {"type": "kubernetes:storage/v1:StorageClass", "name": "openebs-hostpath", "change": "create"},
                {"type": "kubernetes:apps/v1:DaemonSet", "name": "openebs-ndm", "change": "update"}
            ]
        elif project_name == "core-services":
            return [
                {"type": "kubernetes:core/v1:Namespace", "name": "cert-manager", "change": "create"},
                {"type": "kubernetes:core/v1:Namespace", "name": "traefik", "change": "create"},
                {"type": "kubernetes:helm.sh/v3:Release", "name": "cert-manager", "change": "create"}
            ]
        return []


# Create pytest fixture for easy testing
@pytest.fixture
def pulumi_test(request):
    """Fixture that returns a PulumiTestFixture for testing"""
    # Get the project directory from the test module or parameter
    project_dir = getattr(request.module, "PROJECT_DIR", "/tmp/pulumi-test/storage")
    fixture = PulumiTestFixture(project_dir)
    fixture.setup_mocks()
    return fixture
