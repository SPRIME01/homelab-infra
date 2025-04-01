#!/bin/bash

set -e

# Parse command line options
CHECK_MODE=false
VERBOSE=false

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --check) CHECK_MODE=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    *) echo "Unknown parameter: $1"; exit 1 ;;
  esac
done

# Function to handle errors
handle_error() {
  local exit_code=$?
  echo "Error: Test execution failed with exit code $exit_code!"
  echo "Command that failed: $BASH_COMMAND"
  # Ensure cleanup happens even on error
  cleanup
  exit $exit_code
}

# Cleanup function to ensure we remove temporary files
cleanup() {
  echo "Running cleanup..."
  if [ -f "/etc/sudoers.d/k3s-test-temp" ]; then
    sudo rm -f "/etc/sudoers.d/k3s-test-temp"
    echo "Temporary sudo privileges removed"
  fi
  
  if [ -f "/tmp/test-inventory.yml" ]; then
    rm -f /tmp/test-inventory.yml
    echo "Temporary inventory removed"
  fi
  
  if [ -f "/etc/systemd/system/k3s.service" ] && [ "$CHECK_MODE" != "true" ]; then
    sudo systemctl stop k3s.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/k3s.service
    echo "Mock k3s service removed"
  fi
}

# Set trap for error handling
trap handle_error ERR
trap cleanup EXIT

# Setup temporary NOPASSWD sudo for testing
setup_sudo_nopasswd() {
  echo "Setting up temporary NOPASSWD sudo for testing..."
  # Create a backup of current sudo privileges
  if sudo -n true 2>/dev/null; then
    echo "Sudo already configured without password, no changes needed"
  else
    echo "Configuring temporary passwordless sudo for testing..."
    # Use askpass to provide a blank password if needed for the first sudo
    echo "" | sudo -S tee /etc/sudoers.d/k3s-test-temp > /dev/null 2>&1 << EOF
${USER} ALL=(ALL) NOPASSWD: ALL
EOF
    chmod 0440 /etc/sudoers.d/k3s-test-temp
    echo "Temporary sudo config created"
  fi
}

# Create a temporary inventory file for testing
create_test_inventory() {
  echo "Creating temporary test inventory..."
  cat > /tmp/test-inventory.yml << EOF
all:
  hosts:
    localhost:
      ansible_connection: local
      ansible_python_interpreter: "$(which python3)"
      ansible_become_method: sudo
      ansible_become: true
EOF
}

# Create mock systemd service for K3s
create_mock_service() {
  if [ "$CHECK_MODE" != "true" ]; then
    echo "Creating mock k3s systemd service for testing..."
    sudo tee /etc/systemd/system/k3s.service > /dev/null << EOF
[Unit]
Description=Lightweight Kubernetes
Documentation=https://k3s.io
Wants=network-online.target
After=network-online.target

[Service]
Type=notify
ExecStart=/usr/local/bin/k3s server
KillMode=process
Delegate=yes
LimitNOFILE=1048576
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
    echo "Mock k3s service created"
  fi
}

# Main test runner
run_test() {
  echo "Running K3s server tests in ${CHECK_MODE} mode..."
  
  # Ensure we're in the correct directory
  cd "$(dirname "$0")/.." || exit 1
  echo "Working directory: $(pwd)"
  
  # Create test inventory
  create_test_inventory
  
  # Set up sudo access
  setup_sudo_nopasswd
  
  # Create mock service
  create_mock_service

  # Set environment variables
  export ANSIBLE_HOST_KEY_CHECKING=False
  export ANSIBLE_BECOME_ASK_PASS=False
  export ANSIBLE_FORCE_COLOR=1
  export ANSIBLE_VERBOSITY=3
  export ANSIBLE_LOG_PATH="/tmp/ansible-k3s-test.log"
  
  echo "Running ansible-playbook with inventory: $(cat /tmp/test-inventory.yml)"
  
  # Run the tests with full debugging
  if [ "$CHECK_MODE" = true ]; then
    echo "Executing ansible-playbook in check mode..."
    
    ansible-playbook \
      -i /tmp/test-inventory.yml \
      ansible/roles/k3s_server/tests/test.yml \
      --check \
      --diff \
      -vvv \
      --log-path "${ANSIBLE_LOG_PATH}" \
      -e "k3s_server_testing=true" \
      -e "ansible_check_mode=true" \
      -e "ansible_python_interpreter=$(which python3)" || {
        local exit_code=$?
        echo "Ansible playbook failed with exit code: $exit_code"
        echo "Last 50 lines of ansible log:"
        tail -n 50 /tmp/ansible-k3s-test.log
        return $exit_code
      }
  fi
}

echo "Starting K3s server test execution..."
run_test
exit_code=$?

echo "Tests completed with exit code: $exit_code"
exit $exit_code
