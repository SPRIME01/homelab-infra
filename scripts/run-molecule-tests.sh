#!/bin/bash
set -e

# Display help message
display_help() {
  echo "Usage: $0 [options] <role-name>"
  echo ""
  echo "Run Molecule tests for a specific role with proper dependency mocking."
  echo ""
  echo "Options:"
  echo "  -h, --help        Display this help message and exit"
  echo "  -s, --scenario    Specify the Molecule scenario to run (default: default)"
  echo "  -c, --command     Specify the Molecule command to run (default: test)"
  echo "  -v, --verbose     Enable verbose output"
  echo ""
  echo "Commands:"
  echo "  test              Run full test sequence (default)"
  echo "  lint              Run only linting"
  echo "  prepare           Create resources and setup"
  echo "  converge          Run the converge playbook"
  echo "  verify            Run the verify playbook"
  echo "  destroy           Remove any created resources"
  echo ""
  echo "Example:"
  echo "  $0 k3s_server"
  echo "  $0 -s default -c converge k3s_server"
}

# Default values
SCENARIO="default"
COMMAND="test"
VERBOSE=""

# Parse command-line options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      display_help
      exit 0
      ;;
    -s|--scenario)
      SCENARIO="$2"
      shift 2
      ;;
    -c|--command)
      COMMAND="$2"
      shift 2
      ;;
    -v|--verbose)
      VERBOSE="--debug"
      shift
      ;;
    *)
      ROLE_NAME="$1"
      shift
      ;;
  esac
done

# Check if role name is provided
if [ -z "$ROLE_NAME" ]; then
  echo "ERROR: Role name is required"
  display_help
  exit 1
fi

# Check if the role exists
ROLE_PATH="$PWD/ansible/roles/$ROLE_NAME"
if [ ! -d "$ROLE_PATH" ]; then
  echo "ERROR: Role '$ROLE_NAME' not found at $ROLE_PATH"
  exit 1
fi

# Check if Molecule configuration exists for the role
if [ ! -d "$ROLE_PATH/molecule/$SCENARIO" ]; then
  echo "ERROR: Molecule scenario '$SCENARIO' not found for role '$ROLE_NAME'"
  exit 1
fi

# Ensure we're running from the project root
cd "$(dirname "$0")/.."

# Ensure the virtual environment is activated
if [ -z "$VIRTUAL_ENV" ]; then
  if [ -d ".venv" ]; then
    echo "INFO: Activating virtual environment"
    source .venv/bin/activate
  else
    echo "ERROR: Virtual environment not found. Please activate it before running this script."
    exit 1
  fi
fi

echo "INFO: Running Molecule $COMMAND for role '$ROLE_NAME' with scenario '$SCENARIO'"

# Change to the role directory
cd "$ROLE_PATH"

# Run the Molecule command
molecule $VERBOSE $COMMAND -s $SCENARIO

echo "INFO: Molecule $COMMAND for role '$ROLE_NAME' completed"