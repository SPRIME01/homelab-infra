# K3s Server Role Testing

This directory contains the test suite for the K3s server role. The tests are implemented using both Ansible's native testing capabilities and Molecule for comprehensive role testing.

## Test Structure

```
tests/
├── README.md           # This documentation
├── test.yml           # Ansible playbook for basic role testing
└── molecule/          # Molecule test scenarios
    └── default/       # Default test scenario
        ├── molecule.yml       # Molecule configuration
        ├── converge.yml      # Role application playbook
        ├── prepare.yml       # Environment preparation
        └── verify.yml        # Post-role verification
```

## Testing Approaches

### 1. Basic Role Testing (`test.yml`)

The `test.yml` playbook provides a basic test implementation that:
- Sets up a test environment in `/tmp/k3s-test`
- Mocks external dependencies
- Tests the role in check (dry-run) mode
- Validates basic role functionality

Key features:
- Uses local connection for testing
- Mocks sudo operations
- Creates temporary test directories
- Cleans up after testing

### 2. Molecule Testing

Molecule provides a more comprehensive testing framework with:
- Isolated container-based testing
- Multi-stage test sequence
- Proper dependency mocking
- Comprehensive verification

## Variables

### Test-specific Variables

```yaml
k3s_server_testing: true           # Enables test mode
test_root: "/tmp/k3s-test"        # Root directory for test files
k3s_server_skip_download: true     # Skip actual binary download
k3s_server_skip_service: true      # Skip service management
```

### Mock Paths

```yaml
k3s_server_config_dir: "{{ test_root }}/etc/rancher/k3s"
k3s_server_data_dir: "{{ test_root }}/var/lib/rancher/k3s"
k3s_server_binary: "{{ test_root }}/usr/local/bin/k3s"
```

## Running Tests

### Basic Testing

```bash
# Run all tests
./scripts/test-ansible.sh -r k3s_server

# Run specific test steps
./scripts/test-ansible.sh -r k3s_server -s lint     # Run only linting
./scripts/test-ansible.sh -r k3s_server -s dry-run  # Run only dry-run test
```

### Molecule Testing

```bash
# Run full test sequence
./scripts/run-molecule-tests.sh k3s_server

# Run specific commands
./scripts/run-molecule-tests.sh -c lint k3s_server     # Run only linting
./scripts/run-molecule-tests.sh -c converge k3s_server # Run only converge
./scripts/run-molecule-tests.sh -c verify k3s_server   # Run only verification

# Run with a specific scenario
./scripts/run-molecule-tests.sh -s ha-cluster k3s_server

# Enable verbose output
./scripts/run-molecule-tests.sh -v k3s_server
```

## Test Coverage

The test suite validates:

1. **Installation**
   - Directory creation
   - Binary installation (mocked)
   - Configuration file creation

2. **Configuration**
   - Config file syntax
   - Required settings presence
   - File permissions

3. **Service Management**
   - Service file creation (mocked)
   - Service enablement (mocked)
   - Service startup (mocked)

4. **Security**
   - File permissions
   - Directory ownership
   - Token file handling

## Mocked Dependencies

The following external dependencies are mocked during testing:

1. **K3s Binary**
   - Download is skipped
   - Mock binary created locally

2. **System Services**
   - systemd operations are skipped
   - Service status checks are mocked

3. **Sudo Operations**
   - NOPASSWD sudo is simulated
   - Passwordless operations are mocked

## Best Practices

1. **Always run in test mode**
   ```yaml
   vars:
     k3s_server_testing: true
   ```

2. **Use mock directories**
   - Avoid touching system directories
   - Clean up after tests

3. **Skip actual system changes**
   - Use `when: not ansible_check_mode`
   - Mock external service calls

4. **Validate changes**
   - Check file existence
   - Verify permissions
   - Validate configurations

## Troubleshooting

### Common Issues

1. **Dry-run Failures**
   - Check sudo mock configuration
   - Verify test directory permissions
   - Ensure mock variables are set

2. **Permission Errors**
   - Verify become: true is set
   - Check directory ownership
   - Validate mock sudo setup

3. **Missing Dependencies**
   - Ensure required packages are listed in prepare.yml
   - Verify mock binary creation
   - Check test environment setup

### Debug Mode

Run tests with increased verbosity:
```bash
./scripts/test-ansible.sh -r k3s_server -v
./scripts/run-molecule-tests.sh -v k3s_server
```
