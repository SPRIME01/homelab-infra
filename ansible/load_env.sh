#!/bin/bash
# load_env.sh - Script to load environment variables from .env file for Ansible

# Path to .env file
ENV_FILE="../.env"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found at $ENV_FILE"
    exit 1
fi

# Export all variables from .env file
set -a
source "$ENV_FILE"
set +a

# Run ansible command with all arguments passed to this script
ansible-playbook "$@"