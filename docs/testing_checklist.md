# Homelab Infrastructure Testing Strategy

## Current Status

The project currently uses bash scripts for testing (`test-ansible.sh`, `test-pulumi.sh`, etc.) with some initial Molecule setup for the k3s_server role. We need to extend Molecule testing to all roles and implement a comprehensive testing workflow.

## MECE Testing Checklist

1. **Dependency Management:**
   - [x] Review existing dependencies in pyproject.toml
   - [x] Add testinfra, pytest-testinfra, and python-loki dependencies
   - [x] Ensure compatibility between molecule, ansible, and python versions
   - [x] Update Docker driver configurations to work with latest molecule-docker

2. **Molecule Setup:**
   - [x] Molecule and molecule-docker already in pyproject.toml
   - [x] Initialize Molecule for all remaining roles using k3s_server as reference
   - [x] Standardize molecule.yml configurations across roles
   - [x] Create molecule scenarios for different testing requirements (default, verification, etc.)
   - [x] Configure Docker driver for containerized testing

3. **Pulumi Integration:**
   - [x] Create Molecule scenario for testing Pulumi deployments
   - [x] Use Typescript-based Pulumi automation API for test integration (adapted to work with existing setup)
   - [x] Configure mock backends for Pulumi state during testing
   - [x] Implement Testinfra tests for Pulumi-created resources
   - [x] Create verification tests for Pulumi stacks (cluster-setup, core-services, storage)

4. **Test Execution Pipeline:**
   - [x] Implement pre-commit hooks for quick validation tests
   - [x] Create GitHub Actions workflow for CI/CD integration
   - [x] Configure parallel testing for faster feedback
   - [x] Implement test result aggregation and reporting

5. **Ansible Role Testing:**
   - [x] Review existing k3s_server molecule tests
   - [x] Create standardized molecule tests for each role (all roles implemented)
   - [x] Implement test matrices for different OS/environment combinations (HA cluster for k3s_server)
   - [x] Add idempotence testing to all role scenarios

6. **Verification with Testinfra:**
   - [x] Create Testinfra tests for each role's expected outcomes
   - [x] Implement kubectl integration for Kubernetes resource verification
   - [x] Add custom pytest fixtures for common K3s testing patterns
   - [x] Verify networking, services, and deployment configurations

7. **Logging & Monitoring Integration:**
   - [x] Configure Loki client for log aggregation during tests
   - [x] Implement log verification tests using Loki queries
   - [x] Add Prometheus metric validation for relevant services
   - [x] Create dashboard for test results visualization
   - [x] Implement PromQL queries in Testinfra for validation
   - [x] Set up correlation between logs and metrics
   - [x] Configure host resource monitoring in tests
   - [x] Implement Grafana dashboards for test visualization

8. **Bash Test Migration:**
   - [x] Review existing bash tests in /scripts directory
   - [x] Categorize tests for migration (role tests, integration tests, e2e tests)
   - [x] Migrate role tests to Molecule using Python
   - [x] Use molecule delegated driver for more complex system tests (Pulumi integration)
   - [x] Ensure feature parity between bash and Molecule tests

9. **Mocking Strategy:**
   - [x] Create mock Kubernetes API responses for kubectl tests
   - [x] Implement mock HTTP endpoints for external dependencies
   - [x] Configure container mocks for dependent services (databases, etc.)
   - [x] Set up environment variable mocking for credentials/secrets

10. **Final Verification:**
    - [x] Run complete test suite locally
    - [x] Verify Pulumi, Ansible, and K3s integration
    - [x] Ensure cleanup works correctly in all scenarios
    - [x] Document testing strategy and workflow for team

11. **Comprehensive Monitoring:**
    - [x] Set up Prometheus metrics for Kubernetes cluster resources
    - [x] Configure application performance monitoring metrics
    - [x] Add Pulumi deployment metrics (success rate, duration)
    - [x] Implement resource utilization monitoring for local machine
    - [x] Create Grafana dashboards for all monitoring aspects
    - [x] Configure alerting for critical test and deployment failures
    - [x] Establish secure access controls for monitoring systems
    - [x] Implement data retention policies for metrics and logs

## Implementation Progress

- Current Phase: Completed Monitoring & Metrics Integration
- Next Steps: Perform end-to-end testing of the entire infrastructure with the new monitoring stack
- Completed: All planned monitoring components including logs/metrics correlation

## CI/CD Pipeline Implementation

### Pre-commit Hooks
Pre-commit hooks are configured to run quick validation tests before commits. They include:
- Molecule lint tests
- Ansible lint
- YAML/Markdown linting
- Security checks (detect-private-key, gitleaks)
- Code formatting (black, isort)

### GitHub Actions Workflow
The CI/CD pipeline runs on GitHub Actions and includes:
- Parallel testing of roles
- Matrix testing on different OS variants
- Pulumi stack validation
- Test result reporting and aggregation

### Test Result Reporting
Test results are aggregated using:
- JUnit XML format for test results
- GitHub Actions Annotations for highlighting issues
- HTML test reports for comprehensive analysis

## Logging & Monitoring Integration

### Loki Log Integration
The testing pipeline now includes:
- Log aggregation with Python-Loki client
- Structured logging for test events
- Query capabilities for log analysis
- Correlation between test runs and log entries

### Test Result Metrics
- Test execution time metrics
- Pass/fail rates by role and test type
- Coverage metrics for code and infrastructure components
- Resource utilization during tests

### Prometheus Integration
The testing and monitoring pipeline now includes:
- Prometheus metric collection for Kubernetes resources
- Application performance monitoring with custom metrics
- PromQL-based validation in Testinfra tests
- Pulumi deployment metrics tracking
- Host resource utilization monitoring
- Metric retention and aggregation policies

### Grafana Dashboards
- Test Results Dashboard: Shows pass/fail rates, duration trends, and coverage metrics
- Kubernetes Cluster Dashboard: Monitors cluster health, pod status, and resource usage
- Application Performance Dashboard: Tracks latency, error rates, and throughput
- Pulumi Deployment Dashboard: Visualizes deployment success, duration, and resource changes
- Host Monitoring Dashboard: Shows resource utilization of the local machine
- Log & Metric Correlation Dashboard: Combines logs and metrics for effective debugging

### Log-Metric Correlation
The monitoring system now includes a dedicated correlator service that:
- Connects error logs from Loki with resource metrics from Prometheus
- Identifies potential issues by correlating test failures with resource usage spikes
- Provides correlation metrics for advanced monitoring dashboards
- Facilitates root cause analysis by linking metrics anomalies to related log events
- Improves observability across the full infrastructure lifecycle

### Best Practices Implementation
- Appropriate metric naming and labeling conventions
- Efficient PromQL queries with minimal cardinality issues
- Right-sized metric retention based on importance and volatility
- Secure authentication and authorization for monitoring systems
- Alert thresholds based on baseline performance metrics
- Dashboard organization following function-oriented approach
