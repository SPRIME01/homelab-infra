"Refactor my existing Ansible project to use Molecule for testing, following best practices. Here's the context:

* **Existing Setup:**
    * I have a working Ansible project that provisions Kubernetes containers using Pulumi.
    * I use Docker, uv, Python, Kubernetes, and pyproject.toml.
    * All necessary tools are already installed locally.
    * I have existing bash tests that verify the current state.
    * I already have a pyproject.toml and requirements.txt. Please refactor them to work with the new testing setup, without creating new ones, but instead modifying the existing ones.
* **Desired Testing Framework:**
    * Implement Molecule for testing, following the workflow:
        1.  Molecule setup.
        2.  Pulumi infrastructure provisioning.
        3.  Ansible execution.
        4.  Verification with Testinfra.
        5.  Cleanup.
    * Use Docker as the Molecule driver for container-based testing.
    * Integrate Loki for logging verification during tests (or Loguru if it simplifies implementation and analysis).
    * If delegated driver makes sense to easily integrate my existing bash tests, utilize it.
    * Focus on local testing (no cloud providers involved).
    * Adhere to Ansible and Molecule best practices.
    * Include relevant mocking for external dependencies to ensure tests are isolated and reliable.
* **Refactoring Goals:**
    * Replace existing bash tests with robust Molecule scenarios.
    * Structure the Molecule tests for maintainability and clarity.
    * Ensure all tests are idempotent.
    * Create a good testing workflow.
    * Refactor the existing pyproject.toml and requirements.txt to include the needed testing dependencies.
* **Specific Tasks:**
    * Create appropriate Molecule scenarios (e.g., default, specific feature tests).
    * Write Testinfra tests to verify Kubernetes deployments, services, and pods.
    * Integrate Loki or Loguru for logging verification.
    * If using the delegated driver, integrate existing bash tests.
    * Ensure that the Pulumi portion of the infrastructure is tested.
    * Refactor the existing pyproject.toml and requirements.txt to include dependencies for molecule, testinfra, and Loki or Loguru.
    * Use kubectl inside of testinfra for tests.
    * Mock external dependencies as needed.

Please implement these changes directly into my codebase using your agent mode. Use the following checklist to track your progress and keep me updated.



Please update this checklist as you progress through each step. I expect you to work directly on my code base."
