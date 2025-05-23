import os
import sys
import pytest
import json
import testinfra.utils.ansible_runner

testinfra_hosts = testinfra.utils.ansible_runner.AnsibleRunner(
    os.environ['MOLECULE_INVENTORY_FILE']
).get_hosts('all')

# Add test directory to path to import PulumiTestHelper
sys.path.append("/tmp/pulumi-test")

try:
    from pulumi_test_helper import PulumiTestHelper
except ImportError:
    pass  # Will be caught in the tests


def test_pulumi_helper_exists(host):
    """Verify PulumiTestHelper file exists."""
    helper_file = host.file("/tmp/pulumi-test/pulumi_test_helper.py")
    assert helper_file.exists
    assert helper_file.is_file
    assert helper_file.mode == 0o755


@pytest.mark.parametrize("project", ["cluster-setup", "core-services", "storage"])
def test_pulumi_project_outputs(host, project):
    """Test that each Pulumi project produces expected outputs."""
    if "PulumiTestHelper" not in globals():
        pytest.skip("PulumiTestHelper not available")

    helper = PulumiTestHelper(f"/tmp/pulumi-test/{project}")
    outputs = helper.get_outputs()

    # Verify project-specific outputs
    if project == "cluster-setup":
        assert "kubeconfig" in outputs
        assert "clusterEndpoint" in outputs
        assert outputs["clusterEndpoint"].startswith("https://")
    elif project == "storage":
        assert "defaultStorageClass" in outputs
        assert "openEBSStatus" in outputs
        assert outputs["openEBSStatus"] == "Deployed"
    elif project == "core-services":
        assert "certManagerStatus" in outputs
        assert "traefikEndpoint" in outputs
        assert outputs["traefikEndpoint"].startswith("http://")


def test_pulumi_mock_cli(host):
    """Test that the mock Pulumi CLI was created."""
    pulumi_cli = host.file("/usr/local/bin/pulumi")
    assert pulumi_cli.exists
    assert pulumi_cli.is_file
    assert pulumi_cli.mode == 0o755

    # Test execution
    cmd = host.run("pulumi preview")
    assert cmd.rc == 0
    assert "Resources:" in cmd.stdout
    assert "kubernetes:core/v1:Namespace" in cmd.stdout
