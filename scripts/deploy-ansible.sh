#!/bin/bash
# deploy-ansible.sh - Script to deploy homelab infrastructure using Ansible
#
# This script automates the deployment of the homelab infrastructure
# by running Ansible playbooks in the correct order with proper error handling.

# Set script to exit immediately if a command fails
set -e

# Script variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="${SCRIPT_DIR}/../ansible"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/ansible-deploy-$(date +%Y%m%d-%H%M%S).log"
ANSIBLE_VENV="${SCRIPT_DIR}/../ansible-venv"
DRY_RUN=false
TAGS=""
LIMIT=""
VERBOSE=1
PLAYBOOKS=(
    "initial_setup.yml"
    "k3s_cluster.yml"
)

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

Deploy homelab infrastructure using Ansible playbooks.

Options:
  -h, --help           Show this help message and exit
  -d, --dry-run        Perform a dry run (--check mode in Ansible)
  -t, --tags TAGS      Only run plays and tasks tagged with these values (comma-separated)
  -l, --limit HOSTS    Limit execution to the specified hosts (comma-separated)
  -v, --verbose        Increase verbosity (can be used multiple times)
  -p, --playbook NAME  Run only the specified playbook (can be used multiple times)
  -y, --yes            Automatically answer yes to all prompts
  -s, --skip-venv      Skip virtual environment activation (use system Ansible)

Examples:
  ${0} --dry-run                      # Perform a dry run of all playbooks
  ${0} --tags k3s_server,k3s_agent    # Only run tasks with k3s_server or k3s_agent tags
  ${0} --limit control_nodes          # Only run on control_nodes group
  ${0} --playbook k3s_cluster.yml     # Only run the k3s_cluster.yml playbook
  ${0} -v -t security                 # Run security-tagged tasks with increased verbosity

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
        *)       echo -e "${BLUE}${timestamp} [${level}] ${message}${NC}" ;;
    esac
}

# Function to check required tools
function check_prerequisites() {
    log "INFO" "Checking prerequisites..."

    # Check if Ansible is installed
    if ! command -v ansible-playbook &> /dev/null && [ "$SKIP_VENV" = true ]; then
        log "ERROR" "Ansible is not installed and --skip-venv was specified"
        exit 1
    fi

    # Check if the Ansible directory exists
    if [ ! -d "${ANSIBLE_DIR}" ]; then
        log "ERROR" "Ansible directory not found: ${ANSIBLE_DIR}"
        exit 1
    fi

    # Check if playbooks exist
    for playbook in "${PLAYBOOKS[@]}"; do
        if [ ! -f "${ANSIBLE_DIR}/playbooks/${playbook}" ]; then
            log "ERROR" "Playbook not found: ${ANSIBLE_DIR}/playbooks/${playbook}"
            exit 1
        fi
    done

    # Create log directory if it doesn't exist
    if [ ! -d "${LOG_DIR}" ]; then
        mkdir -p "${LOG_DIR}"
        log "INFO" "Created log directory: ${LOG_DIR}"
    fi

    log "INFO" "Prerequisites check completed successfully"
}

# Function to activate virtual environment
function activate_venv() {
    if [ "$SKIP_VENV" = true ]; then
        log "INFO" "Skipping virtual environment activation"
        return
    fi

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
        log "WARN" "Ansible virtual environment not found at ${ANSIBLE_VENV}"
        log "WARN" "Will use system-installed Ansible if available"

        # Check if Ansible is available
        if ! command -v ansible-playbook &> /dev/null; then
            log "ERROR" "Ansible is not installed. Please install Ansible or create the virtual environment."
            exit 1
        fi
    fi
}

# Function to run a playbook
function run_playbook() {
    local playbook=$1
    local playbook_path="${ANSIBLE_DIR}/playbooks/${playbook}"
    local ansible_opts=()

    log "INFO" "Preparing to run playbook: ${playbook}"

    # Add options based on script parameters
    if [ "$DRY_RUN" = true ]; then
        ansible_opts+=(--check --diff)
        log "INFO" "Dry run mode enabled (--check --diff)"
    fi

    if [ -n "$TAGS" ]; then
        ansible_opts+=(--tags "$TAGS")
        log "INFO" "Using tags: $TAGS"
    fi

    if [ -n "$LIMIT" ]; then
        ansible_opts+=(--limit "$LIMIT")
        log "INFO" "Limiting to hosts: $LIMIT"
    fi

    # Set verbosity
    if [ $VERBOSE -eq 1 ]; then
        ansible_opts+=(-v)
    elif [ $VERBOSE -eq 2 ]; then
        ansible_opts+=(-vv)
    elif [ $VERBOSE -ge 3 ]; then
        ansible_opts+=(-vvv)
    fi

    # Run the playbook
    log "INFO" "Running playbook: ansible-playbook ${playbook_path} ${ansible_opts[*]}"
    if ! ansible-playbook "${playbook_path}" "${ansible_opts[@]}" 2>&1 | tee -a "${LOG_FILE}"; then
        log "ERROR" "Playbook execution failed: ${playbook}"
        return 1
    fi

    log "INFO" "Playbook execution completed successfully: ${playbook}"
    return 0
}

# Function to prompt user for confirmation
function confirm_execution() {
    if [ "$AUTO_YES" = true ]; then
        return 0
    fi

    local message=$1
    local response

    echo -e "${YELLOW}${message} (y/n)${NC}"
    read -r response

    if [[ "$response" =~ ^[Yy]$ ]]; then
        return 0
    else
        return 1
    fi
}

# Parse command line arguments
AUTO_YES=false
SKIP_VENV=false
CUSTOM_PLAYBOOKS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
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
        -p|--playbook)
            CUSTOM_PLAYBOOKS+=("$2")
            shift 2
            ;;
        -y|--yes)
            AUTO_YES=true
            shift
            ;;
        -s|--skip-venv)
            SKIP_VENV=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Set custom playbooks if specified
if [ ${#CUSTOM_PLAYBOOKS[@]} -gt 0 ]; then
    PLAYBOOKS=("${CUSTOM_PLAYBOOKS[@]}")
fi

# Main execution
{
    log "INFO" "Starting homelab deployment process"
    log "INFO" "Log file: ${LOG_FILE}"

    # Check prerequisites
    check_prerequisites

    # Activate virtual environment
    activate_venv

    # Show planned execution
    log "INFO" "The following playbooks will be executed in order:"
    for playbook in "${PLAYBOOKS[@]}"; do
        log "INFO" "  - ${playbook}"
    done

    # Confirm execution
    if ! confirm_execution "Do you want to proceed with the deployment?"; then
        log "INFO" "Deployment cancelled by user"
        exit 0
    fi

    # Start deployment
    log "INFO" "Starting deployment process"

    # Run playbooks in order
    for playbook in "${PLAYBOOKS[@]}"; do
        if ! run_playbook "$playbook"; then
            log "ERROR" "Deployment failed during playbook: ${playbook}"
            exit 1
        fi

        # If not the last playbook, prompt for continuation
        if [ "$playbook" != "${PLAYBOOKS[-1]}" ] && ! confirm_execution "Continue with the next playbook?"; then
            log "INFO" "Deployment paused by user after playbook: ${playbook}"
            exit 0
        fi
    done

    log "INFO" "Deployment completed successfully"
} || {
    error_code=$?
    log "ERROR" "Deployment failed with error code: ${error_code}"
    exit $error_code
}

exit 0
