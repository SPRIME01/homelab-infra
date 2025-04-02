import os
import sys
import pytest
import json
import testinfra.utils.ansible_runner

testinfra_hosts = testinfra.utils.ansible_runner.AnsibleRunner(
    os.environ['MOLECULE_INVENTORY_FILE']
).get_hosts('all')

# Set project directories for testing
PROJECT_DIRS = {
    "cluster-setup": "/tmp/pulumi-test/cluster-setup",
    "storage": "/tmp/pulumi-test/storage",
    "core-services": "/tmp/pulumi-test/core-services"
}

# Add to pytest path
sys.path.append("/tmp/pulumi-test")


@pytest.mark.parametrize("project", ["cluster-setup", "storage", "core-services"])
def test_stack_preview(host, project, pulumi_test):
    """Test stack preview works for each project"""
    # Set the project directory for the test
    pulumi_test.project_dir = PROJECT_DIRS[project]
    
    # Preview stack changes
    preview = pulumi_test.preview_stack()
    
    # Basic validation
    assert isinstance(preview, dict)
    assert "changes" in preview
    assert preview["changes"] > 0
    assert "creates" in preview
    assert preview["creates"] >= 0


@pytest.mark.parametrize("project", ["cluster-setup", "storage", "core-services"])
def test_stack_outputs(host, project, pulumi_test):
    """Test stack outputs for each project"""
    # Set the project directory for the test
    pulumi_test.project_dir = PROJECT_DIRS[project]
    
    # Get stack outputs
    outputs = pulumi_test.get_outputs()
    
    # Project-specific validations
    if project == "cluster-setup":
        assert "kubeconfig" in outputs
        assert "clusterEndpoint" in outputs
        assert outputs["clusterEndpoint"].startswith("https://")
    elif project == "storage":
        assert "openEBSStatus" in outputs
        assert outputs["openEBSStatus"] == "Deployed"
        assert "defaultStorageClass" in outputs
    elif project == "core-services":
        assert "certManagerStatus" in outputs
        assert outputs["certManagerStatus"] == "Deployed"
        assert "traefikEndpoint" in outputs


@pytest.mark.parametrize("project", ["cluster-setup", "storage", "core-services"])
def test_stack_resources(host, project, pulumi_test):
    """Test resource creation for each project"""
    # Set the project directory for the test
    pulumi_test.project_dir = PROJECT_DIRS[project]
    
    # Apply stack
    resources = pulumi_test.apply_stack()
    
    # Basic validation
    assert isinstance(resources, list)
    assert len(resources) > 0
    
    # Check that resources have basic properties
    for resource in resources:
        assert "type" in resource
        assert "name" in resource
        assert "change" in resource
        assert resource["type"].startswith("kubernetes:")
