#!/bin/bash
set -e

# Load environment variables for testing
if [ -f "test.env" ]; then
    set -a
    source test.env
    set +a
fi

# Run ansible-lint on all playbooks
echo "Running ansible-lint..."
ansible-lint playbooks/*.yml --profile production

# Run ansible-playbook with check mode
for playbook in playbooks/*.yml; do
    echo "Testing playbook: $(basename $playbook)"
    ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -i inventory/homelab.yml "$playbook" --check
done

# Test roles
for role in roles/*; do
    if [ -d "$role" ]; then
        role_name=$(basename "$role")
        echo "Testing role: $role_name"
        if [ -f "roles/$role_name/tests/test.yml" ]; then
            ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -i inventory/homelab.yml "roles/$role_name/tests/test.yml" --check
        else
            echo "Creating test playbook for role: $role_name"
            mkdir -p "roles/$role_name/tests"
            cat > "roles/$role_name/tests/test.yml" << EOF
---
- hosts: localhost
  connection: local
  gather_facts: false
  roles:
    - role: $role_name
EOF
            ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -i inventory/homelab.yml "roles/$role_name/tests/test.yml" --check
        fi
    fi
done