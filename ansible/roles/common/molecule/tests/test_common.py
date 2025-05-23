import os
import pytest
import testinfra.utils.ansible_runner

# Skip molecule tests if not running in molecule environment
if 'MOLECULE_INVENTORY_FILE' not in os.environ:
    pytest.skip("Skipping molecule tests - not running in molecule environment", allow_module_level=True)

testinfra_hosts = testinfra.utils.ansible_runner.AnsibleRunner(
    os.environ['MOLECULE_INVENTORY_FILE']
).get_hosts('all')


def test_user_exists(host):
    """Check that testuser exists and is in the right groups."""
    user = host.user("testuser")
    assert user.exists
    assert "sudo" in user.groups
    assert "docker" in user.groups


def test_packages_installed(host):
    """Check that required packages are installed."""
    packages = ["curl", "vim", "htop"]
    for package in packages:
        assert host.package(package).is_installed


def test_ssh_config_hardening(host):
    """Check SSH hardening config exists."""
    ssh_config = host.file("/etc/ssh/sshd_config.d/hardening.conf")
    assert ssh_config.exists
    assert ssh_config.is_file
    assert ssh_config.mode == 0o644
    assert ssh_config.user == "root"


def test_sudo_config(host):
    """Check sudo configuration."""
    sudo_file = host.file("/etc/sudoers.d/custom")
    if sudo_file.exists:  # The role might create this file
        assert sudo_file.is_file
        assert sudo_file.mode == 0o440
        assert sudo_file.user == "root"
        assert sudo_file.group == "root"
