# 🛠️ Homelab Infrastructure Scripts Guide

This guide provides instructions for using the scripts in this folder. Follow the examples below for testing, deploying, and managing your homelab environment.

## 📂 Folder Structure
- **deploy-ansible.sh**: Deploys Ansible playbook configuration.
- **test-ansible.sh**: Tests Ansible playbooks and roles (linting, syntax, dry-run).
- **deploy-pulumi.sh**: Deploys infrastructure using Pulumi stacks.
- **test-pulumi.sh**: Tests Pulumi configurations.
- **migrate_traefik.sh**: Migrates Traefik configurations.
- **pulumi_env.sh** & **pulumi_setup.sh**: Manage Pulumi environments.
- **setup_jest.sh**: Sets up Jest for JavaScript/TypeScript testing.
- **.ansible/**: Contains Ansible collections, modules, and roles.

## 🚀 How to Use the Scripts

### 1. Testing Ansible Playbooks & Roles - `test-ansible.sh`
- **Purpose**: Validate playbooks through syntax checks, linting, and role testing.
- **Usage Examples**:
  - **Run tests for a specific role (e.g., jetson_setup)**:
    ```bash
    ./scripts/test-ansible.sh -r jetson_setup
    ```
    👉 Tests will be executed only for the `jetson_setup` role.
  - **Skip specific tests (like lint and dry-run)**:
    ```bash
    ./scripts/test-ansible.sh -r jetson_setup -s lint -s dry-run
    ```
  - **Increase verbosity for debugging**:
    ```bash
    ./scripts/test-ansible.sh -r jetson_setup -v
    ```
  - **Maximum verbosity**:
    ```bash
    ./scripts/test-ansible.sh -r jetson_setup -vvv
    ```

### 2. Deploying Infrastructure with Pulumi - [deploy-pulumi.sh](http://_vscodecontentref_/0)
- **Purpose**: Automate deployment of your homelab infrastructure.
- **Usage Examples**:
  - **Preview changes without deploying**:
    ```bash
    ./scripts/deploy-pulumi.sh --preview
    ```
    🔍 Use preview mode to view planned changes.
  - **Deploy a specific stack (e.g., cluster-setup)**:
    ```bash
    ./scripts/deploy-pulumi.sh --stack cluster-setup
    ```
    🚀 Deploys the `cluster-setup` stack.
  - **Automatically answer yes to prompts**:
    ```bash
    ./scripts/deploy-pulumi.sh --yes
    ```
  - **Enable verbose logging**:
    ```bash
    ./scripts/deploy-pulumi.sh --verbose
    ```
  - **Display stack outputs after deployment**:
    ```bash
    ./scripts/deploy-pulumi.sh --outputs
    ```

### 3. Other Useful Scripts
- **migrate_traefik.sh**: Migrate Traefik configurations (refer to inline comments for details).
- **pulumi_env.sh & pulumi_setup.sh**: Assist with setting up and managing the Pulumi environment.
- **setup_jest.sh**: Configure Jest for testing JavaScript/TypeScript applications.

## 📝 Tips and Best Practices
- **Verbosity Options**: Use `-v`, `-vv`, or `-vvv` for increasing levels of output detail during tests.
- **Prerequisites**: Verify that all required tools (Ansible, Pulumi, Node.js, Python, etc.) are installed and properly set up.
- **Logs**: Check log files in the [logs](http://_vscodecontentref_/1) directory for detailed execution information.
- **Customization**: Review the inline comments within each script to understand configurable options and environmental dependencies.

## 🙂 Happy Scripting!
Feel free to contribute improvements or share feedback. Enjoy automating your homelab!