#!/bin/bash
# Save as test-wrapper.sh and make executable

export ANSIBLE_CONFIG="$(pwd)/ansible/roles/home_assistant_integration/tests/ansible.cfg"
export ANSIBLE_BECOME=False
export ANSIBLE_BECOME_ASK_PASS=False
export ANSIBLE_HOST_KEY_CHECKING=False

# Run the actual test
ansible-playbook -i localhost, ansible/roles/home_assistant_integration/tests/test.yml --check
