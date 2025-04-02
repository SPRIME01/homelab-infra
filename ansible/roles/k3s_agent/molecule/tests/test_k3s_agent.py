import os
import testinfra.utils.ansible_runner

testinfra_hosts = testinfra.utils.ansible_runner.AnsibleRunner(
    os.environ['MOLECULE_INVENTORY_FILE']
).get_hosts('all')

TEST_BASE_DIR = "/tmp/k3s-agent-test"


def test_k3s_binary_exists(host):
    k3s_bin = host.file(f"{TEST_BASE_DIR}/usr/local/bin/k3s")
    assert k3s_bin.exists
    assert k3s_bin.is_file
    assert k3s_bin.mode == 0o755


def test_k3s_config_dir_exists(host):
    config_dir = host.file(f"{TEST_BASE_DIR}/etc/rancher/k3s")
    assert config_dir.exists
    assert config_dir.is_directory


def test_k3s_data_dir_exists(host):
    data_dir = host.file(f"{TEST_BASE_DIR}/var/lib/rancher/k3s/agent")
    assert data_dir.exists
    assert data_dir.is_directory


def test_k3s_service_file_exists(host):
    service_file = host.file(f"{TEST_BASE_DIR}/etc/systemd/system/k3s-agent.service")
    assert service_file.exists
    assert service_file.is_file
    assert "K3s Agent" in service_file.content_string


def test_containerd_dir_exists(host):
    containerd_dir = host.file(f"{TEST_BASE_DIR}/etc/containerd")
    assert containerd_dir.exists
    assert containerd_dir.is_directory
