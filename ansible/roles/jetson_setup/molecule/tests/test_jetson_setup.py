import os
import pytest
import testinfra.utils.ansible_runner

testinfra_hosts = testinfra.utils.ansible_runner.AnsibleRunner(
    os.environ['MOLECULE_INVENTORY_FILE']
).get_hosts('all')

TEST_BASE_DIR = "/tmp/jetson-test"


def test_power_service(host):
    """Check that the power management service file exists."""
    service_file = host.file(f"{TEST_BASE_DIR}/etc/systemd/system/jetson-power.service")
    assert service_file.exists
    assert service_file.is_file
    assert service_file.mode == 0o644
    assert "Description=Jetson Power Management" in service_file.content_string


def test_power_script(host):
    """Check that the power management script exists and is executable."""
    script_file = host.file(f"{TEST_BASE_DIR}/usr/local/bin/jetson-power-setup.sh")
    assert script_file.exists
    assert script_file.is_file
    assert script_file.mode == 0o755
    assert "nvpmodel" in script_file.content_string
    assert "jetson_clocks" in script_file.content_string


def test_tegra_power_dir(host):
    """Check that the Tegra power directory exists."""
    power_dir = host.file(f"{TEST_BASE_DIR}/etc/tegra-power")
    assert power_dir.exists
    assert power_dir.is_directory
