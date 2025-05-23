I need you to continue implementing Molecule testing for my homelab-infra project, working methodically through the testing checklist. Here's your task:

1. Review the testing_checklist.md file to understand the overall plan and current progress
2. Analyze my codebase to determine:
   - The current state of Molecule implementation
   - Existing Ansible roles that need Molecule tests
   - The structure of the k3s_server Molecule tests to use as reference
   - Bash tests in the /home/sprime01/homelab/homelab-infra/scripts directory that need migration

3. Work through the checklist items that are not yet completed, focusing on:
   - Updating the pyproject.toml for necessary testing dependencies
   - Creating standardized Molecule setup for Ansible roles
   - Implementing Testinfra tests for verification
   - Setting up Loki/Loguru for logging during tests
   - Integrating Pulumi with Molecule for infrastructure testing
   - Migrating bash tests to Molecule/Python

4. After each implementation:
   - Update the checklist to mark completed items
   - Document any challenges or decisions made
   - Ensure all tests are running correctly

5. Prioritize work in this order:
   - Dependency management (pyproject.toml updates)
   - Core Molecule setup for all roles
   - Testinfra implementation
   - Bash test migration
   - Pulumi integration
   - Logging and monitoring
   - CI/CD pipeline integration

The project uses Docker for containerized testing, and I already have a working Molecule setup for the k3s_server role that should be used as a reference pattern. Focus on local testing with proper mocking of external dependencies.

After reviewing the #codebase, please report your findings, what you'll work on next, and any questions before proceeding with implementation.
