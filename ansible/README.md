# Homelab Infrastructure - Ansible Inventory

This directory contains the Ansible inventory configuration for managing the homelab infrastructure.

## Structure

- `homelab.yml` - Main inventory file using variables
- `group_vars/homelab.yml` - Common variables for all homelab hosts
- `group_vars/vault.yml` - Encrypted sensitive variables

## Using the Inventory

### With Environment Variables

The inventory is designed to work with environment variables from your `.env` file. You can use the provided `load_env.sh` script:

```bash
# Make the script executable
chmod +x load_env.sh

# Run a playbook with environment variables loaded
./load_env.sh your_playbook.yml
```

### Using Ansible Vault

Sensitive information is stored in the encrypted vault file. To use it:

```bash
# Create an encrypted vault file (first time only)
ansible-vault create group_vars/vault.yml

# Edit the vault file
ansible-vault edit group_vars/vault.yml

# Run a playbook with the vault
ansible-playbook your_playbook.yml --ask-vault-pass
```

## Variable Structure

The inventory is organized by node types:
- `control_nodes` - Primary infrastructure servers
- `ai_nodes` - Edge AI devices
- `home_automation_nodes` - Home automation controllers

Each node has specific variables defined in the group_vars files.
