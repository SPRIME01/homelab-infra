# End-to-End Test Automation Script
This document describes the end-to-end test automation script designed to streamline the testing process for your project. The script is capable of running various types of tests, including Python unit tests, Ansible role tests, Pulumi infrastructure validation, and Home Assistant specific tests.

## Key Features

**1. Complete Test Coverage:**
- Pre-commit checks (linting, formatting, security scanning)
- Python tests (pytest with coverage and JUnit XML output)
- Ansible role tests (molecule testing for all roles)
- Pulumi infrastructure validation
- Home Assistant specific tests

**2. Robust Error Handling:**
- Timeout protection for all test suites
- Proper exit codes and error propagation
- Graceful handling of missing dependencies or test files

**3. Comprehensive Reporting:**
- Individual test results tracking
- Summary report with success rates
- JUnit XML output for CI integration
- Coverage reports in multiple formats
- Timestamped log files for debugging

**4. Flexible Execution Options:**
- Verbose mode for detailed output
- Skip flags for individual test categories
- Parallel execution support where applicable
- Environment-specific configurations

## Usage Examples

```bash
# Make the script executable
chmod +x scripts/run-all-tests.sh

# Run all tests
./scripts/run-all-tests.sh

# Run in verbose mode
./scripts/run-all-tests.sh --verbose

# Skip linting for faster development cycles
./scripts/run-all-tests.sh --skip-lint

# Run in CI environment with parallel execution
./scripts/run-all-tests.sh --parallel --env ci

# Skip specific test categories
./scripts/run-all-tests.sh --skip-ansible --skip-pulumi
```

## Integration Points

The script integrates with your existing infrastructure:
- Uses your existing `uv run pytest` for Python tests
- Calls your `run-molecule-tests.sh` script for Ansible testing
- Uses your `test-pulumi.sh` and `test-home-assistant.sh` scripts
- Respects your project structure and dependencies
- Generates artifacts compatible with your CI/CD pipeline

## Setup Instructions

1. Save the script as `scripts/run-all-tests.sh`
2. Make it executable: `chmod +x scripts/run-all-tests.sh`
3. Optionally, add a convenient npm/make target:

```bash
# Add to your Makefile or package.json scripts section
test-all: scripts/run-all-tests.sh
```

The script will automatically detect missing dependencies and provide clear error messages. It's designed to work in both local development and CI environments, with proper artifact generation for your GitHub Actions workflows.
