#!/bin/bash

set -e

# Function to handle errors
handle_error() {
  echo "Error: Test execution failed!"
  # Clean up the mock directory if it exists
  if [ -d "/usr/share/hassio" ]; then
    sudo rm -rf "/usr/share/hassio"
  fi
  if [ -d "/config" ]; then
    sudo rm -rf "/config"
  fi
  if [ -f "/usr/local/bin/hassio" ]; then
    sudo rm -f "/usr/local/bin/hassio"
  fi
  exit 1
}

# Set trap for error handling
trap handle_error ERR

# Create a temporary inventory for testing
create_test_inventory() {
  echo "Creating temporary test inventory..."
  cat > /tmp/ha-test-inventory.yml << EOF
all:
  hosts:
    localhost:
      ansible_connection: local
      ansible_python_interpreter: "$(which python3)"
      ansible_become_method: sudo
      ansible_become: true
  children:
    control_nodes:
      hosts:
        localhost:
EOF
}

# Prepare test environment
prepare_test_env() {
  echo "Preparing test environment..."

  # Create homeassistant user if it doesn't exist for testing
  if ! id -u homeassistant &>/dev/null; then
    sudo useradd -r -M homeassistant
  fi

  # Define the Home Assistant user
  HA_USER="homeassistant"

  # Create mock directories for Home Assistant
  sudo mkdir -p /usr/share/hassio
  sudo chmod 755 /usr/share/hassio
  sudo chown root:root /usr/share/hassio

  # Create mock addon directories
  sudo mkdir -p /usr/share/hassio/addons/core_mosquitto
  sudo mkdir -p /usr/share/hassio/addons/5ba9ddb2_influxdb
  sudo mkdir -p /usr/share/hassio/addons/a0d7b954_ssh
  sudo mkdir -p /usr/share/hassio/addons/a0d7b954_rhasspy

  # Create mock config file structure
  sudo mkdir -p /config/integrations
  sudo mkdir -p /config/.ssh
  sudo chmod -R 755 /config
  sudo chmod 700 /config/.ssh
  sudo chmod 600 /config/.ssh/authorized_keys
  sudo chown -R $HA_USER:$HA_USER /config
  echo '# Home Assistant configuration' | sudo tee /config/configuration.yaml

  # Create mock options files
  echo '{"license": false}' | sudo tee /usr/share/hassio/addons/core_mosquitto/options.json
  echo '{"license": false}' | sudo tee /usr/share/hassio/addons/5ba9ddb2_influxdb/options.json
  echo '{"license": false}' | sudo tee /usr/share/hassio/addons/a0d7b954_ssh/options.json
  echo '{"license": false}' | sudo tee /usr/share/hassio/addons/a0d7b954_rhasspy/options.json

  # Create config files
  echo '{"startup": false}' | sudo tee /usr/share/hassio/addons/core_mosquitto/config.json
  echo '{"startup": false}' | sudo tee /usr/share/hassio/addons/5ba9ddb2_influxdb/config.json
  echo '{"startup": false}' | sudo tee /usr/share/hassio/addons/a0d7b954_ssh/config.json
  echo '{"startup": false}' | sudo tee /usr/share/hassio/addons/a0d7b954_rhasspy/config.json

  # Create mock integration files (empty)
  sudo touch /config/integrations/mqtt.yaml
  sudo touch /config/integrations/influxdb.yaml
  sudo touch /config/integrations/voice_assistant.yaml
  sudo touch /config/ssh.yaml
  sudo touch /config/.ssh/authorized_keys
  sudo chmod 700 /config/.ssh
  sudo chmod 600 /config/.ssh/authorized_keys
  sudo chown -R $HA_USER:$HA_USER /config/integrations/mqtt.yaml
  sudo chown -R $HA_USER:$HA_USER /config/integrations/influxdb.yaml
  sudo chown -R $HA_USER:$HA_USER /config/integrations/voice_assistant.yaml
  sudo chown -R $HA_USER:$HA_USER /config/ssh.yaml
  sudo chown -R $HA_USER:$HA_USER /config/.ssh

  # Mock the hassio command
  sudo mkdir -p /usr/local/bin
  sudo tee /usr/local/bin/hassio > /dev/null <<EOF
#!/bin/bash
echo "Mock hassio command executing: \$@"
if [[ "\$*" == *"addons install"* ]]; then
  echo "Add-on is already installed." >&2
elif [[ "\$*" == *"addons start"* ]]; then
  echo "Add-on is already running." >&2
elif [[ "\$*" == *"options"* ]]; then
  echo "Configuration updated."
fi
exit 0
EOF
  sudo chmod +x /usr/local/bin/hassio
}

# Clean up after tests
cleanup_test_env() {
  echo "Cleaning up test environment..."
  sudo rm -rf /usr/share/hassio
  sudo rm -rf /config
  sudo rm -f /usr/local/bin/hassio
  rm -f /tmp/ha-test-inventory.yml
}

# Run the tests
run_tests() {
  echo "Running Home Assistant tests..."

  # First run in check mode
  echo "Running check mode tests..."
  ANSIBLE_CHECK_MODE=true ANSIBLE_ROLES_PATH="$(pwd)/ansible/roles" \
  ansible-playbook \
    -i /tmp/ha-test-inventory.yml \
    ansible/roles/home_assistant_integration/tests/test.yml \
    --check \
    -e "home_assistant_integration_testing=true" \
    -e "home_assistant_integration_user=homeassistant" \
    -v || handle_error

  # Then run actual tests
  echo "Running actual tests..."
  ANSIBLE_CHECK_MODE=false ANSIBLE_ROLES_PATH="$(pwd)/ansible/roles" \
  ansible-playbook \
    -i /tmp/ha-test-inventory.yml \
    ansible/roles/home_assistant_integration/tests/test.yml \
    -e "home_assistant_integration_testing=true" \
    -e "home_assistant_integration_user=homeassistant" \
    -v || handle_error

  # Run idempotency test
  echo "Running idempotency test..."
  if ! ANSIBLE_ROLES_PATH="$(pwd)/ansible/roles" \
       ansible-playbook \
         -i /tmp/ha-test-inventory.yml \
         ansible/roles/home_assistant_integration/tests/test.yml \
         -e "home_assistant_integration_testing=true" \
         -e "home_assistant_integration_user=homeassistant" \
         -v | grep -q 'changed=0.*failed=0'; then
    echo "Idempotency test failed"
    return 1
  fi
}

# Main execution
echo "Starting Home Assistant integration tests..."
create_test_inventory
prepare_test_env

# Run tests
run_tests

# Clean up
cleanup_test_env

echo "Tests completed successfully!"
exit 0
