# Molecule Testing Guide

This document provides detailed information about the Molecule testing setup for the K3s server role.

## Directory Structure

```
molecule/
└── default/               # Default test scenario
    ├── molecule.yml      # Molecule configuration
    ├── converge.yml      # Role application playbook
    ├── prepare.yml       # Environment preparation
    └── verify.yml        # Post-role verification
```

## Configuration Files

### molecule.yml

The `molecule.yml` file configures the test environment:

```yaml
dependency:
  name: galaxy
driver:
  name: docker
platforms:
  - name: k3s-test
    image: geerlingguy/docker-ubuntu2204-ansible:latest
    pre_build_image: true
    privileged: true
```

### prepare.yml

The `prepare.yml` playbook sets up the test environment:
- Installs required packages (curl, python3, python3-pip)
- Creates necessary test directories
- Sets up mock configurations

### converge.yml

The `converge.yml` playbook applies the role with test configurations:
- Sets testing mode variables
- Creates mock directories
- Applies the role with mocked dependencies

### verify.yml

The `verify.yml` playbook validates the role execution:
- Checks directory creation
- Validates file permissions
- Verifies mock configurations

## Test Variables

Important variables for testing:

```yaml
k3s_server_testing: true           # Enable test mode
test_root: "/tmp/k3s-test"        # Test directory root
k3s_server_skip_download: true     # Skip actual downloads
k3s_server_skip_service: true      # Skip service management
```

## Mocked Components

### 1. K3s Binary
```yaml
- name: Create mock k3s binary
  ansible.builtin.copy:
    dest: "{{ k3s_server_binary }}"
    content: |
      #!/bin/bash
      echo "Mock K3s binary for testing"
      exit 0
    mode: '0755'
```

### 2. Service Management
```yaml
- name: Mock service operations
  ansible.builtin.debug:
    msg: "Service operations mocked in testing mode"
  when: k3s_server_testing
```

### 3. Configuration Files
```yaml
test_paths:
  - "{{ test_root }}/etc/rancher/k3s"
  - "{{ test_root }}/var/lib/rancher/k3s"
  - "{{ test_root }}/usr/local/bin"
```

## Running Tests

### Full Test Sequence

```bash
./scripts/run-molecule-tests.sh k3s_server
```

This runs:
1. `dependency` - Ensures dependencies are available
2. `lint` - Checks code quality
3. `cleanup` - Removes previous test artifacts
4. `destroy` - Ensures clean test environment
5. `syntax` - Validates playbook syntax
6. `create` - Creates test container
7. `prepare` - Sets up test environment
8. `converge` - Applies the role
9. `verify` - Validates results
10. `cleanup` & `destroy` - Cleans up

### Individual Steps

```bash
# Run specific commands
./scripts/run-molecule-tests.sh -c lint k3s_server     # Run only linting
./scripts/run-molecule-tests.sh -c converge k3s_server # Run only converge
./scripts/run-molecule-tests.sh -c verify k3s_server   # Run only verification

# Run with a specific scenario
./scripts/run-molecule-tests.sh -s ha-cluster k3s_server

# Enable verbose output
./scripts.run-molecule-tests.sh -v k3s_server
```

## Debugging Tests

### Verbose Output

Add the `-v` flag for detailed output:
```bash
./scripts/run-molecule-tests.sh -v k3s_server
```

### Interactive Debugging

1. Create and prepare the container:
```bash
./scripts/run-molecule-tests.sh -c create k3s_server
./scripts.run-molecule-tests.sh -c prepare k3s_server
```

2. Connect to the container:
```bash
molecule login -s default -h k3s-test
```

### Common Issues

1. Container Access
   - Ensure Docker is running
   - Check container privileges
   - Verify network access

2. Mock Files
   - Check file permissions
   - Verify directory creation
   - Validate mock content

3. Test Variables
   - Confirm testing mode is enabled
   - Verify mock paths
   - Check skip flags

## Best Practices

1. **Always Mock External Dependencies**
   - Network calls
   - File downloads
   - Service operations

2. **Use Test-Specific Paths**
   - Avoid system directories
   - Use `test_root` variable
   - Clean up after tests

3. **Validate Everything**
   - Directory creation
   - File permissions
   - Mock configurations

4. **Keep Tests Atomic**
   - Independent scenarios
   - Clean state between tests
   - Clear validation criteria
