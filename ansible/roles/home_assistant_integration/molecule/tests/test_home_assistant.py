import os
import pytest
import testinfra.utils.ansible_runner

testinfra_hosts = testinfra.utils.ansible_runner.AnsibleRunner(
    os.environ['MOLECULE_INVENTORY_FILE']
).get_hosts('all')

TEST_BASE_DIR = "/tmp/home-assistant-test"


def test_configuration_files(host):
    """Check that configuration files exist."""
    config_file = host.file(f"{TEST_BASE_DIR}/config/configuration.yaml")
    assert config_file.exists
    assert config_file.is_file
    assert config_file.user == "homeassistant"
    assert config_file.group == "homeassistant"
    
    # Check integration files
    for integration in ["mqtt", "influxdb", "voice_assistant", "ssh"]:
        integration_file = host.file(f"{TEST_BASE_DIR}/config/integrations/{integration}.yaml")
        assert integration_file.exists
        assert integration_file.is_file
        assert integration_file.user == "homeassistant"
        assert integration_file.group == "homeassistant"


def test_ssh_setup(host):
    """Check SSH directory and authorized_keys file."""
    ssh_dir = host.file(f"{TEST_BASE_DIR}/config/.ssh")
    assert ssh_dir.exists
    assert ssh_dir.is_directory
    assert ssh_dir.user == "homeassistant"
    assert ssh_dir.group == "homeassistant"
    assert ssh_dir.mode == 0o700
    
    auth_keys = host.file(f"{TEST_BASE_DIR}/config/.ssh/authorized_keys")
    assert auth_keys.exists
    assert auth_keys.is_file
    assert auth_keys.user == "homeassistant"
    assert auth_keys.group == "homeassistant"
    assert auth_keys.mode == 0o600
    assert "molecule-test-key" in auth_keys.content_string


def test_addon_directories(host):
    """Check that addon directories exist."""
    addon_dirs = [
        f"{TEST_BASE_DIR}/usr/share/hassio/addons/core_mosquitto",
        f"{TEST_BASE_DIR}/usr/share/hassio/addons/5ba9ddb2_influxdb",
        f"{TEST_BASE_DIR}/usr/share/hassio/addons/a0d7b954_ssh",
        f"{TEST_BASE_DIR}/usr/share/hassio/addons/a0d7b954_rhasspy"
    ]
    
    for dir_path in addon_dirs:
        dir_obj = host.file(dir_path)
        assert dir_obj.exists
        assert dir_obj.is_directory
