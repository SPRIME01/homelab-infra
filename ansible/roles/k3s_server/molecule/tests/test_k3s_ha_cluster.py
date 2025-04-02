import os
import pytest
import testinfra.utils.ansible_runner

testinfra_hosts = testinfra.utils.ansible_runner.AnsibleRunner(
    os.environ['MOLECULE_INVENTORY_FILE']
).get_hosts('all')

TEST_BASE_DIR = "/tmp/k3s-test"


def test_k3s_service_file(host):
    """Check that the K3s service file exists."""
    service_file = host.file(f"{TEST_BASE_DIR}/etc/systemd/system/k3s.service")
    assert service_file.exists
    assert service_file.is_file
    assert service_file.mode == 0o644
    
    # Check content based on server role (first node vs. other nodes)
    hostname = host.check_output("hostname")
    if hostname == "k3s-server-1":
        assert "--cluster-init" in service_file.content_string
    else:
        assert "--server" in service_file.content_string
        assert "https://" in service_file.content_string


def test_k3s_config_dir(host):
    """Check that config directories exist."""
    config_dir = host.file(f"{TEST_BASE_DIR}/etc/rancher/k3s")
    assert config_dir.exists
    assert config_dir.is_directory
    
    server_config_dir = host.file(f"{TEST_BASE_DIR}/etc/rancher/k3s/server")
    assert server_config_dir.exists
    assert server_config_dir.is_directory


def test_k3s_token_file(host):
    """Check that the token file exists on first server."""
    hostname = host.check_output("hostname")
    token_file = host.file(f"{TEST_BASE_DIR}/var/lib/rancher/k3s/server/node-token")
    
    if hostname == "k3s-server-1":
        assert token_file.exists
        assert token_file.is_file
        assert token_file.mode == 0o600
        assert token_file.content_string.strip() == "test-token-for-cluster"
