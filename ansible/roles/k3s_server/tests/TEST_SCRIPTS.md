# Test Scripts Documentation

This document covers the test scripts used for running and managing tests for the K3s server role.

## Available Scripts

### 1. run-molecule-tests.sh

Located in `/scripts/run-molecule-tests.sh`, this is the primary script for running Molecule tests.

#### Features

- Supports multiple test scenarios
- Configurable verbosity levels
- Individual step execution
- Automatic virtual environment handling
- Clean test environment management

#### Usage Examples

```bash
# Full test suite
./scripts/run-molecule-tests.sh k3s_server

# Specific scenario
./scripts/run-molecule-tests.sh -s custom k3s_server

# Individual steps
./scripts/run-molecule-tests.sh -c lint k3s_server
./scripts/run-molecule-tests.sh -c converge k3s_server
```

### 2. test-ansible.sh

Located in `/ansible/test-wrapper.sh`, this script provides a wrapper for basic Ansible testing.

#### Features

- Linting checks
- Dry-run execution
- Syntax validation
- Test environment setup/cleanup

#### Usage Examples

```bash
# Full test suite
./scripts/test-ansible.sh -r k3s_server

# Specific test steps
./scripts/test-ansible.sh -r k3s_server -s lint
./scripts/test-ansible.sh -r k3s_server -s dry-run
```

## Script Integration

### Virtual Environment Integration

Both scripts automatically handle Python virtual environment:
```bash
if [ -z "$VIRTUAL_ENV" ]; then
  if [ -d ".venv" ]; then
    source .venv/bin/activate
  fi
fi
```

### Logging Integration

Test output is logged to the `logs/` directory:
- Timestamp-based log files
- Structured log format
- Preserved test history

### Error Handling

Both scripts implement error handling:
- Exit code tracking
- Error message capture
- Clean environment restoration

## Test Environment Variables

### Required Variables

```bash
ANSIBLE_FORCE_COLOR="true"
ANSIBLE_HOST_KEY_CHECKING="false"
PYTHONPATH="${PWD}"
```

### Optional Variables

```bash
ANSIBLE_VERBOSITY=1
MOLECULE_DEBUG=1
MOLECULE_NO_LOG=false
```

## Integration with CI/CD

### GitHub Actions Integration

```yaml
- name: Run Molecule tests
  run: |
    ./scripts/run-molecule-tests.sh k3s_server
  env:
    MOLECULE_DOCKER_IMAGE: geerlingguy/docker-ubuntu2204-ansible:latest
```

### Local Development Integration

Development workflow integration:
1. Pre-commit hooks
2. Local test execution
3. Environment validation

## Debugging Tools

### Script Debug Mode

Enable debug output:
```bash
# For Molecule tests
./scripts/run-molecule-tests.sh -v k3s_server

# For Ansible tests
./scripts/test-ansible.sh -r k3s_server -v
```

### Common Debug Tasks

1. Check Test Environment
```bash
# Verify virtual environment
echo $VIRTUAL_ENV

# Check Python path
echo $PYTHONPATH

# Verify Ansible configuration
ansible --version
```

2. Validate Docker Environment
```bash
# Check Docker status
docker ps

# Verify test container
docker ps --filter "name=molecule-k3s-test"
```

3. Review Test Logs
```bash
# Latest test log
ls -lt logs/ansible-test-* | head -n1

# Molecule test logs
molecule --debug test
```

## Best Practices

### 1. Script Development

- Use shellcheck for shell script validation
- Implement proper error handling
- Add debug options
- Include help documentation

### 2. Test Integration

- Maintain consistent test environments
- Use version control for test configurations
- Document test prerequisites
- Implement proper cleanup

### 3. Maintenance

- Regular script updates
- Dependency management
- Version compatibility checks
- Documentation updates

## Troubleshooting Guide

### Common Issues

1. **Virtual Environment Problems**
   - Check activation status
   - Verify Python version
   - Validate dependencies

2. **Docker Issues**
   - Verify Docker service
   - Check container access
   - Validate network settings

3. **Script Execution Errors**
   - Check file permissions
   - Verify path settings
   - Validate environment variables

### Resolution Steps

1. Environment Validation
```bash
# Check Python environment
python --version
pip list

# Verify Ansible installation
ansible --version
ansible-playbook --version
```

2. Docker Validation
```bash
# Check Docker status
systemctl status docker

# Verify container networking
docker network ls
```

3. Script Permissions
```bash
# Set correct permissions
chmod +x scripts/*.sh
chmod +x ansible/*.sh
```
