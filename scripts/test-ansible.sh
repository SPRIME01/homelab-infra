#!/bin/bash
# test-ansible.sh - Script to test Ansible playbooks for homelab infrastructure
#
# This script performs various tests on Ansible playbooks including syntax checks,
# linting, dry runs, and targeted role tests with proper error handling.

# Set strict mode
set -e

# Script variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="${SCRIPT_DIR}/../ansible"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/ansible-test-$(date +%Y%m%d-%H%M%S).log"
ANSIBLE_VENV="${SCRIPT_DIR}/../ansible-venv"
SUMMARY_FILE="${LOG_DIR}/ansible-test-summary-$(date +%Y%m%d-%H%M%S).txt"
TEST_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

# ANSI color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display usage information
function show_usage() {
    cat << EOF
Usage: ${0} [OPTIONS]

Test Ansible playbooks for homelab setup.

Options:
  -h, --help           Show this help message and exit
  -p, --playbook FILE  Test a specific playbook (defaults to all)
  -r, --role NAME      Test a specific role
  -s, --skip TEST      Skip a test type (syntax, lint, dry-run)
  -t, --tags TAGS      Only test plays and tasks with these tags (comma-separated)
  -l, --limit HOSTS    Limit execution to the specified hosts (comma-separated)
  -v, --verbose        Increase verbosity (can be used multiple times)
  -y, --yes            Automatically answer yes to all prompts

Examples:
  ${0} --playbook initial_setup.yml       # Test only the initial_setup.yml playbook
  ${0} --role k3s_server                  # Test only the k3s_server role
  ${0} --skip lint                        # Skip the linting tests
  ${0} --tags k3s_control,k3s_agent       # Test only k3s tasks
  ${0} --limit control_nodes              # Test only on control nodes

EOF
    exit 0
}

# Function for logging
function log() {
    local level=$1
    local message=$2
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")

    # Log to file
    echo "${timestamp} [${level}] ${message}" >> "${LOG_FILE}"

    # Log to console with colors based on level
    case ${level} in
        "INFO")  echo -e "${GREEN}${timestamp} [${level}] ${message}${NC}" ;;
        "WARN")  echo -e "${YELLOW}${timestamp} [${level}] ${message}${NC}" ;;
        "ERROR") echo -e "${RED}${timestamp} [${level}] ${message}${NC}" ;;
        "TEST")  echo -e "${BLUE}${timestamp} [${level}] ${message}${NC}" ;;
        *)       echo -e "${timestamp} [${level}] ${message}" ;;
    esac
}

# Function to record test results
function record_result() {
    local test_name=$1
    local status=$2
    local message=$3

    TEST_COUNT=$((TEST_COUNT + 1))

    # Record result
    if [[ "${status}" == "PASS" ]]; then
        PASS_COUNT=$((PASS_COUNT + 1))
        log "TEST" "✅ ${test_name}: PASS - ${message}"
        echo "✅ ${test_name}: PASS - ${message}" >> "${SUMMARY_FILE}"
    else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        log "TEST" "❌ ${test_name}: FAIL - ${message}"
        echo "❌ ${test_name}: FAIL - ${message}" >> "${SUMMARY_FILE}"
    fi
}

# Function to check prerequisites
function check_prerequisites() {
    log "INFO" "Checking prerequisites..."

    # Create log directory if it doesn't exist
    if [ ! -d "${LOG_DIR}" ]; then
        mkdir -p "${LOG_DIR}"
        log "INFO" "Created log directory: ${LOG_DIR}"
    fi

    # Check if Ansible is installed
    if ! command -v ansible-playbook &> /dev/null; then
        log "INFO" "Ansible not found, activating virtual environment..."
        activate_venv
    fi

    # Check if ansible-lint is installed
    if ! command -v ansible-lint &> /dev/null; then
        log "ERROR" "ansible-lint is not installed. Please install it with:"
        log "ERROR" "  pip install ansible-lint"
        exit 1
    fi

    # Check if the Ansible directory exists
    if [ ! -d "${ANSIBLE_DIR}" ]; then
        log "ERROR" "Ansible directory not found: ${ANSIBLE_DIR}"
        exit 1
    fi

    log "INFO" "Prerequisites check completed successfully"
}

# Function to activate virtual environment
function activate_venv() {
    if [ -f "${ANSIBLE_VENV}/bin/activate" ]; then
        log "INFO" "Activating Ansible virtual environment"
        source "${ANSIBLE_VENV}/bin/activate"

        # Verify activation
        if [[ "$VIRTUAL_ENV" == *"ansible-venv"* ]]; then
            log "INFO" "Virtual environment activated successfully"
        else
            log "ERROR" "Failed to activate virtual environment"
            exit 1
        fi
    else
        log "ERROR" "Ansible virtual environment not found at ${ANSIBLE_VENV}"
        log "ERROR" "Please create it first with:"
        log "ERROR" "  python3 -m venv ansible-venv"
        log "ERROR" "  source ansible-venv/bin/activate"
        log "ERROR" "  pip install ansible ansible-lint netaddr jmespath"
        exit 1
    fi
}

# Function to find playbooks
function find_playbooks() {
    if [ -n "${PLAYBOOK}" ]; then
        # Check if the specified playbook exists
        if [ ! -f "${ANSIBLE_DIR}/playbooks/${PLAYBOOK}" ]; then
            log "ERROR" "Playbook not found: ${ANSIBLE_DIR}/playbooks/${PLAYBOOK}"
            exit 1
        fi
        echo "${PLAYBOOK}"
    else
        # Find all .yml files in the playbooks directory
        find "${ANSIBLE_DIR}/playbooks" -name "*.yml" -type f -printf "%f\n"
    fi
}

# Function to find roles
function find_roles() {
    if [ -n "${ROLE}" ]; then
        # Check if the specified role exists
        if [ ! -d "${ANSIBLE_DIR}/roles/${ROLE}" ]; then
            log "ERROR" "Role not found: ${ANSIBLE_DIR}/roles/${ROLE}"
            exit 1
        fi
        echo "${ROLE}"
    else
        # Find all role directories
        find "${ANSIBLE_DIR}/roles" -maxdepth 1 -mindepth 1 -type d -printf "%f\n"
    fi
}

# Function to run syntax check
function run_syntax_check() {
    local playbook=$1
    local playbook_path="${ANSIBLE_DIR}/playbooks/${playbook}"

    log "INFO" "Running syntax check for playbook: ${playbook}"

    # Add options based on script parameters
    local ansible_opts=()

    if [ -n "$TAGS" ]; then
        ansible_opts+=(--tags "$TAGS")
    fi

    if [ -n "$LIMIT" ]; then
        ansible_opts+=(--limit "$LIMIT")
    fi

    # Set verbosity
    if [ $VERBOSE -eq 1 ]; then
        ansible_opts+=(-v)
    elif [ $VERBOSE -eq 2 ]; then
        ansible_opts+=(-vv)
    elif [ $VERBOSE -ge 3 ]; then
        ansible_opts+=(-vvv)
    fi

    # Run ansible-playbook syntax check
    if ansible-playbook "${playbook_path}" --syntax-check "${ansible_opts[@]}" &>> "${LOG_FILE}"; then
        record_result "Syntax check: ${playbook}" "PASS" "Playbook syntax is valid"
        return 0
    else
        record_result "Syntax check: ${playbook}" "FAIL" "Playbook contains syntax errors"
        log "ERROR" "Syntax errors in playbook: ${playbook}"
        return 1
    fi
}

# Function to run ansible-lint
function run_lint_check() {
    local playbook=$1
    local playbook_path="${ANSIBLE_DIR}/playbooks/${playbook}"

    log "INFO" "Running lint check for playbook: ${playbook}"

    # Run ansible-lint
    if ansible-lint "${playbook_path}" -p &>> "${LOG_FILE}"; then
        record_result "Lint check: ${playbook}" "PASS" "Playbook passes linting"
        return 0
    else
        record_result "Lint check: ${playbook}" "FAIL" "Playbook has linting issues"
        log "ERROR" "Linting issues in playbook: ${playbook}"
        return 1
    fi
}

# Function to run a dry run
function run_dry_run() {
    local playbook=$1
    local playbook_path="${ANSIBLE_DIR}/playbooks/${playbook}"

    log "INFO" "Running dry run for playbook: ${playbook}"

    # Add options based on script parameters
    local ansible_opts=(--check --diff)

    if [ -n "$TAGS" ]; then
        ansible_opts+=(--tags "$TAGS")
    fi

    if [ -n "$LIMIT" ]; then
        ansible_opts+=(--limit "$LIMIT")
    fi

    # Set verbosity
    if [ $VERBOSE -eq 1 ]; then
        ansible_opts+=(-v)
    elif [ $VERBOSE -eq 2 ]; then
        ansible_opts+=(-vv)
    elif [ $VERBOSE -ge 3 ]; then
        ansible_opts+=(-vvv)
    fi

    # Run ansible-playbook dry run
    if ansible-playbook "${playbook_path}" "${ansible_opts[@]}" &>> "${LOG_FILE}"; then
        record_result "Dry run: ${playbook}" "PASS" "Playbook dry run completed successfully"
        return 0
    else
        record_result "Dry run: ${playbook}" "FAIL" "Playbook dry run encountered errors"
        log "ERROR" "Dry run errors in playbook: ${playbook}"
        return 1
    fi
}

# Function to test a specific role
function test_role() {
    local role=$1
    local role_path="${ANSIBLE_DIR}/roles/${role}"

    log "INFO" "Testing role: ${role}"

    # Check if role has tests
    if [ -d "${role_path}/tests" ] && [ -f "${role_path}/tests/test.yml" ]; then
        log "INFO" "Found test playbook for role: ${role}"

        # Add options based on script parameters
        local ansible_opts=(--check --connection=local)

        # Allow become for roles that require it
        if [[ "${ROLE}" == "jetson_setup" ]]; then
            ansible_opts+=(--become)
        else
            ansible_opts+=(--extra-vars "ansible_become=false")
        fi

        # Set verbosity
        if [ $VERBOSE -eq 1 ]; then
            ansible_opts+=(-v)
        elif [ $VERBOSE -eq 2 ]; then
            ansible_opts+=(-vv)
        elif [ $VERBOSE -ge 3 ]; then
            ansible_opts+=(-vvv)
        fi

        # Run ansible-playbook for role test
        if ansible-playbook "${role_path}/tests/test.yml" "${ansible_opts[@]}" &>> "${LOG_FILE}"; then
            record_result "Role test: ${role}" "PASS" "Role test completed successfully"
            return 0
        else
            record_result "Role test: ${role}" "FAIL" "Role test encountered errors"
            log "ERROR" "Test errors in role: ${role}"
            return 1
        fi
    else
        log "WARN" "No test playbook found for role: ${role}"
        record_result "Role test: ${role}" "SKIP" "No test playbook found"
        return 0
    fi
}

# Function to print a separator line
function print_separator() {
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Function to print test summary
function print_summary() {
    print_separator
    echo -e "${BLUE}Test Summary${NC}"
    print_separator
    echo -e "Total tests: ${TEST_COUNT}"
    echo -e "${GREEN}Passed: ${PASS_COUNT}${NC}"
    echo -e "${RED}Failed: ${FAIL_COUNT}${NC}"
    print_separator

    # Print summary to summary file
    echo "Test Summary" >> "${SUMMARY_FILE}"
    echo "Total tests: ${TEST_COUNT}" >> "${SUMMARY_FILE}"
    echo "Passed: ${PASS_COUNT}" >> "${SUMMARY_FILE}"
    echo "Failed: ${FAIL_COUNT}" >> "${SUMMARY_FILE}"

    log "INFO" "Test summary written to ${SUMMARY_FILE}"

    if [ ${FAIL_COUNT} -gt 0 ]; then
        log "WARN" "Some tests failed. Check the log file for details: ${LOG_FILE}"
        return 1
    else
        log "INFO" "All tests passed!"
        return 0
    fi
}

# Parse command line arguments
PLAYBOOK=""
ROLE=""
SKIP_TESTS=()
TAGS=""
LIMIT=""
VERBOSE=0
AUTO_YES=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -p|--playbook)
            PLAYBOOK="$2"
            shift 2
            ;;
        -r|--role)
            ROLE="$2"
            shift 2
            ;;
        -s|--skip)
            SKIP_TESTS+=("$2")
            shift 2
            ;;
        -t|--tags)
            TAGS="$2"
            shift 2
            ;;
        -l|--limit)
            LIMIT="$2"
            shift 2
            ;;
        -v|--verbose)
            ((VERBOSE++))
            shift
            ;;
        -y|--yes)
            AUTO_YES=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Main execution
{
    log "INFO" "Starting Ansible tests"
    log "INFO" "Log file: ${LOG_FILE}"

    # Initialize summary file
    echo "Ansible Test Summary - $(date)" > "${SUMMARY_FILE}"
    echo "===============================" >> "${SUMMARY_FILE}"
    echo "" >> "${SUMMARY_FILE}"

    # Check prerequisites
    check_prerequisites

    # Test playbooks
    if [[ -z "${ROLE}" ]]; then
        log "INFO" "Testing playbooks..."

        # Get the list of playbooks to test
        PLAYBOOKS=($(find_playbooks))

        for playbook in "${PLAYBOOKS[@]}"; do
            print_separator
            log "INFO" "Testing playbook: ${playbook}"

            # Run syntax check if not skipped
            if [[ ! " ${SKIP_TESTS[*]} " =~ " syntax " ]]; then
                run_syntax_check "${playbook}"
            else
                log "INFO" "Syntax check skipped for ${playbook}"
            fi

            # Run lint check if not skipped
            if [[ ! " ${SKIP_TESTS[*]} " =~ " lint " ]]; then
                run_lint_check "${playbook}"
            else
                log "INFO" "Lint check skipped for ${playbook}"
            fi

            # Run dry run if not skipped
            if [[ ! " ${SKIP_TESTS[*]} " =~ " dry-run " ]]; then
                run_dry_run "${playbook}"
            else
                log "INFO" "Dry run skipped for ${playbook}"
            fi
        done
    fi

    # Test roles
    if [[ -z "${PLAYBOOK}" || -n "${ROLE}" ]]; then
        log "INFO" "Testing roles..."

        # Get the list of roles to test
        ROLES=($(find_roles))

        for role in "${ROLES[@]}"; do
            print_separator
            log "INFO" "Testing role: ${role}"

            # Run role test
            test_role "${role}"
        done
    fi

    # Print test summary
    print_summary

    log "INFO" "Testing completed"
} || {
    error_code=$?
    log "ERROR" "Testing failed with error code: ${error_code}"
    exit $error_code
}

# Exit with appropriate code based on test results
if [ ${FAIL_COUNT} -gt 0 ]; then
    exit 1
else
    exit 0
fi
