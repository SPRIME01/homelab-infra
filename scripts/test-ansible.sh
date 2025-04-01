#!/usr/bin/env bash
# Script to test Ansible roles
# Usage: ./test-ansible.sh -r rolename1 -r rolename2 -s lint -s dry-run -s check

set -e

# Default configuration
LOG_DIR=$(dirname "$0")/../logs
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="/home/sprime01/homelab/homelab-infra/logs/ansible-test-$(date +%Y%m%d-%H%M%S).log"
SUMMARY_FILE="$LOG_DIR/ansible-test-summary-$TIMESTAMP.txt"
ANSIBLE_ROLES_DIR=$(dirname "$0")/../ansible/roles
WORKING_DIR=$(dirname "$0")/..

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Initialize arrays
declare -a roles_to_test
declare -a stages_to_run

# Function to log messages
log() {
    local level=$1
    local message=$2
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")

    case $level in
        "INFO")
            echo -e "${timestamp} [INFO] ${message}" | tee -a "$LOG_FILE"
            ;;
        "WARN")
            echo -e "${timestamp} [${YELLOW}WARN${NC}] ${message}" | tee -a "$LOG_FILE"
            ;;
        "ERROR")
            echo -e "${timestamp} [${RED}ERROR${NC}] ${message}" | tee -a "$LOG_FILE"
            ;;
        "TEST")
            echo -e "${timestamp} [TEST] ${message}" | tee -a "$LOG_FILE"
            ;;
        *)
            echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
            ;;
    esac
}

# Function to show help
show_help() {
    echo "Usage: $0 [-r role_name] [-s stage]"
    echo "Test Ansible roles"
    echo
    echo "Options:"
    echo "  -r role_name   Role to test (can be specified multiple times)"
    echo "  -s stage       Stage to run: lint, syntax, dry-run, check, apply (can be specified multiple times)"
    echo "  -h             Show this help message"
    echo
    echo "Examples:"
    echo "  $0 -r common                      # Test 'common' role with all stages"
    echo "  $0 -r common -s lint -s syntax    # Test 'common' role with lint and syntax stages"
    echo "  $0 -r common -r nginx             # Test 'common' and 'nginx' roles with all stages"
    echo
}

# Function to check prerequisites
check_prerequisites() {
    log "INFO" "Checking prerequisites..."

    # Check for required commands
    for cmd in ansible ansible-playbook ansible-lint; do
        if ! command -v $cmd &> /dev/null; then
            log "ERROR" "$cmd is required but not installed."
            exit 1
        fi
    done

    # Check if ansible-lint log directory exists
    if [ ! -d "$LOG_DIR" ]; then
        mkdir -p "$LOG_DIR"
    fi

    log "INFO" "Prerequisites check completed successfully"
}

# Function to run ansible-lint on a role
lint_role() {
    local role=$1
    local role_path="$ANSIBLE_ROLES_DIR/$role"

    log "INFO" "Linting role: $role"

    # Check if the role exists
    if [ ! -d "$role_path" ]; then
        log "ERROR" "Role does not exist: $role"
        return 1
    fi

    # Run ansible-lint
    if ansible-lint "$role_path" >> "$LOG_FILE" 2>&1; then
        log "TEST" "✅ Lint: $role: PASS"
        return 0
    else
        log "TEST" "❌ Lint: $role: FAIL - See log for details"
        return 1
    fi
}

# Function to check syntax of a role's test playbook
check_syntax() {
    local role=$1
    local role_path="$ANSIBLE_ROLES_DIR/$role"
    local test_playbook="$role_path/tests/test.yml"

    log "INFO" "Checking syntax for role: $role"

    # Check if the test playbook exists
    if [ ! -f "$test_playbook" ]; then
        log "WARN" "Test playbook not found for role: $role"
        return 1
    fi

    # Run ansible-playbook with --syntax-check
    if ansible-playbook --syntax-check "$test_playbook" >> "$LOG_FILE" 2>&1; then
        log "TEST" "✅ Syntax: $role: PASS"
        return 0
    else
        log "TEST" "❌ Syntax: $role: FAIL - See log for details"
        return 1
    fi
}

# Function to dry-run a role's test playbook
dry_run_role() {
    local role=$1
    local role_path="$ANSIBLE_ROLES_DIR/$role"
    local test_playbook="$role_path/tests/test.yml"

    log "INFO" "Dry-running role: $role"

    # Check if the test playbook exists
    if [ ! -f "$test_playbook" ]; then
        log "WARN" "Test playbook not found for role: $role"
        return 1
    fi

    # Add ANSIBLE_FORCE_COLOR=1 to ensure colors are passed through to logs
    export ANSIBLE_FORCE_COLOR=1

    # Run ansible-playbook in check mode
    if ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook --check "$test_playbook" -vvv >> "$LOG_FILE" 2>&1; then
        log "TEST" "✅ Dry-run: $role: PASS"
        return 0
    else
        log "TEST" "❌ Dry-run: $role: FAIL - See log for details"
        return 1
    fi
}

# Function to check a role's test playbook (no changes)
check_role() {
    local role=$1
    local role_path="$ANSIBLE_ROLES_DIR/$role"
    local test_playbook="$role_path/tests/test.yml"

    log "INFO" "Checking role: $role"

    # Check if the test playbook exists
    if [ ! -f "$test_playbook" ]; then
        log "WARN" "Test playbook not found for role: $role"
        return 1
    fi

    # Add ANSIBLE_FORCE_COLOR=1 to ensure colors are passed through to logs
    export ANSIBLE_FORCE_COLOR=1

    # Run ansible-playbook in check mode with diff
    if ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook --check --diff "$test_playbook" -vvv >> "$LOG_FILE" 2>&1; then
        log "TEST" "✅ Check: $role: PASS"
        return 0
    else
        log "TEST" "❌ Check: $role: FAIL - See log for details"
        return 1
    fi
}

# Function to apply a role's test playbook
apply_role() {
    local role=$1
    local role_path="$ANSIBLE_ROLES_DIR/$role"
    local test_playbook="$role_path/tests/test.yml"

    log "INFO" "Applying role: $role"

    # Check if the test playbook exists
    if [ ! -f "$test_playbook" ]; then
        log "WARN" "Test playbook not found for role: $role"
        return 1
    fi

    # Add ANSIBLE_FORCE_COLOR=1 to ensure colors are passed through to logs
    export ANSIBLE_FORCE_COLOR=1

    # Run ansible-playbook to apply changes
    if ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook "$test_playbook" -vvv >> "$LOG_FILE" 2>&1; then
        log "TEST" "✅ Apply: $role: PASS"
        return 0
    else
        log "TEST" "❌ Apply: $role: FAIL - See log for details"
        return 1
    fi
}

# Function to test a role
test_role() {
    local role=$1
    local errors=0
    local total_stages=0
    local passed_stages=0

    log "INFO" "Testing role: $role"

    # Check if the role exists
    if [ ! -d "$ANSIBLE_ROLES_DIR/$role" ]; then
        log "ERROR" "Role does not exist: $role"
        return 1
    fi

    # Check if test playbook exists
    if [ -f "$ANSIBLE_ROLES_DIR/$role/tests/test.yml" ]; then
        log "INFO" "Found test playbook for role: $role"
    else
        log "WARN" "No test playbook found for role: $role"
        return 1
    fi

    # Special handling for k3s_server role
    if [ "$role" == "k3s_server" ]; then
        for stage in "${stages_to_run[@]}"; do
            ((total_stages++))
            case $stage in
                "lint")
                    log "INFO" "Linting role: $role"
                    ansible-lint "$ANSIBLE_ROLES_DIR/$role" -v 2>&1 | tee -a "$LOG_FILE"
                    if [ ${PIPESTATUS[0]} -eq 0 ]; then
                        log "TEST" "✅ Lint: $role: PASS"
                        ((passed_stages++))
                    else
                        log "TEST" "❌ Lint: $role: FAIL - See log for details"
                        ((errors++))
                    fi
                    ;;
                "dry-run")
                    log "INFO" "Running ansible-playbook with dry-run (--check) for $role"
                    
                    # Create a separator in the log file for better readability
                    echo "===== START OF K3S SERVER DRY-RUN TEST OUTPUT =====" | tee -a "$LOG_FILE"
                    
                    # Execute the script and capture both output and exit status
                    # tee command to capture output both to log file and terminal
                    ./scripts/test-k3s-server.sh --check --verbose 2>&1 | tee -a "$LOG_FILE"
                    k3s_test_exit_code=${PIPESTATUS[0]}
                    
                    echo "===== END OF K3S SERVER DRY-RUN TEST OUTPUT =====" | tee -a "$LOG_FILE"
                    
                    if [ $k3s_test_exit_code -eq 0 ]; then
                        log "TEST" "✅ Dry-run: $role: PASS"
                        ((passed_stages++))
                    else
                        log "TEST" "❌ Dry-run: $role: FAIL - Exit code: $k3s_test_exit_code"
                        ((errors++))
                    fi
                    ;;
                "run")
                    log "INFO" "Running full test for $role"
                    
                    # Create a separator in the log file for better readability
                    echo "===== START OF K3S SERVER TEST OUTPUT =====" | tee -a "$LOG_FILE"
                    
                    # Execute the script and capture both output and exit status
                    ./scripts/test-k3s-server.sh --verbose 2>&1 | tee -a "$LOG_FILE"
                    k3s_test_exit_code=${PIPESTATUS[0]}
                    
                    echo "===== END OF K3S SERVER TEST OUTPUT =====" | tee -a "$LOG_FILE"
                    
                    if [ $k3s_test_exit_code -eq 0 ]; then
                        log "TEST" "✅ Run: $role: PASS"
                        ((passed_stages++))
                    else
                        log "TEST" "❌ Run: $role: FAIL - Exit code: $k3s_test_exit_code"
                        ((errors++))
                    fi
                    ;;
                *)
                    log "ERROR" "Unknown test stage: $stage"
                    exit 1
                    ;;
            esac
        done
    else
        # Standard handling for other roles
        for stage in "${stages_to_run[@]}"; do
            ((total_stages++))
            case $stage in
                "lint")
                    if lint_role "$role"; then
                        ((passed_stages++))
                    else
                        ((errors++))
                    fi
                    ;;
                "syntax")
                    if check_syntax "$role"; then
                        ((passed_stages++))
                    else
                        ((errors++))
                    fi
                    ;;
                "dry-run")
                    if dry_run_role "$role"; then
                        ((passed_stages++))
                    else
                        ((errors++))
                    fi
                    ;;
                "check")
                    if check_role "$role"; then
                        ((passed_stages++))
                    else
                        ((errors++))
                    fi
                    ;;
                "apply")
                    if apply_role "$role"; then
                        ((passed_stages++))
                    else
                        ((errors++))
                    fi
                    ;;
                *)
                    log "WARN" "Unknown stage: $stage"
                    ;;
            esac
        done
    fi

    # Add result to summary
    echo "Role: $role" >> "$SUMMARY_FILE"
    echo "  Stages passed: $passed_stages/$total_stages" >> "$SUMMARY_FILE"
    echo "  Errors: $errors" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"

    if [ $errors -gt 0 ]; then
        return 1
    else
        return 0
    fi
}

# Ensure the logs directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# When running ansible-playbook with dry-run, capture the output to a detailed log file
run_ansible_playbook_dryrun() {
  local role=$1
  local detailed_log_file="${LOG_DIR}/ansible-${role}-detailed-$(date +%Y%m%d-%H%M%S).log"
  
  log_info "Running ansible-playbook with dry-run (--check) for $role"
  # Execute ansible-playbook and capture output to both console and log file
  ansible-playbook -i "${role}/tests/inventory" "${role}/tests/test.yml" --check -v | tee "$detailed_log_file"
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    log_test_result "Dry-run" "$role" "PASS"
  else
    log_test_result "Dry-run" "$role" "FAIL" "- See log for details at $detailed_log_file"
  fi
}

# Process command-line arguments
while getopts "hr:s:" opt; do
    case ${opt} in
        h)
            show_help
            exit 0
            ;;
        r)
            roles_to_test+=("$OPTARG")
            ;;
        s)
            stages_to_run+=("$OPTARG")
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            show_help
            exit 1
            ;;
    esac
done

# If no stages specified, run all stages
if [ ${#stages_to_run[@]} -eq 0 ]; then
    stages_to_run=("lint" "syntax" "dry-run" "check" "apply")
fi

# Start logging
log "INFO" "Starting Ansible tests"
log "INFO" "Log file: $LOG_FILE"

# Create summary file
echo "Ansible Test Summary - $(date)" > "$SUMMARY_FILE"
echo "==========================" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

# Check prerequisites
check_prerequisites

# Test each role
log "INFO" "Testing roles..."
total_roles=${#roles_to_test[@]}
passed_roles=0
failed_roles=0

for role in "${roles_to_test[@]}"; do
    if test_role "$role"; then
        ((passed_roles++))
    else
        ((failed_roles++))
    fi
done

# Print summary
echo "" >> "$SUMMARY_FILE"
echo "Test Summary" >> "$SUMMARY_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$SUMMARY_FILE"
echo "Total tests: $total_roles" | tee -a "$SUMMARY_FILE"
echo "Passed: $passed_roles" | tee -a "$SUMMARY_FILE"
echo "Failed: $failed_roles" | tee -a "$SUMMARY_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$SUMMARY_FILE"

log "INFO" "Test summary written to $SUMMARY_FILE"

if [ $failed_roles -gt 0 ]; then
    log "WARN" "Some tests failed. Check the log file for details: $LOG_FILE"
    exit 1
else
    log "INFO" "All tests passed!"
fi

log "INFO" "Testing completed"
exit 0
