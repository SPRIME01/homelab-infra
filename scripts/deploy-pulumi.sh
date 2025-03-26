#!/bin/bash
# deploy-pulumi.sh - Script to deploy homelab infrastructure using Pulumi
#
# This script automates the deployment of the homelab infrastructure
# by running Pulumi deployments in the correct order with proper error handling.

# Set script to exit immediately if a command fails
set -e

# Script variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PULUMI_DIR="${SCRIPT_DIR}/../pulumi"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/pulumi-deploy-$(date +%Y%m%d-%H%M%S).log"
PREVIEW_ONLY=false
SELECTED_STACKS=()
AUTO_YES=false
PROJECTS=(
    "cluster-setup"
    "storage"
    "core-services"
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

Deploy homelab infrastructure using Pulumi stacks.

Options:
  -h, --help           Show this help message and exit
  -p, --preview        Perform a preview only (no actual deployment)
  -s, --stack STACK    Only deploy the specified stack (can be used multiple times)
                       Valid stacks: ${PROJECTS[*]}
  -y, --yes            Automatically answer yes to all prompts
  -v, --verbose        Increase verbosity of Pulumi commands
  -o, --outputs        Display stack outputs after deployment
  --skip STACK         Skip the specified stack (can be used multiple times)

Examples:
  ${0} --preview                      # Preview all stacks with no deployment
  ${0} --stack cluster-setup          # Only deploy the cluster-setup stack
  ${0} --stack storage --stack core-services  # Deploy only storage and core-services
  ${0} --yes                          # Deploy all stacks without prompting

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

# Function to check prerequisites
function check_prerequisites() {
    log "INFO" "Checking prerequisites..."

    # Check if Pulumi is installed
    if ! command -v pulumi &> /dev/null; then
        log "ERROR" "Pulumi is not installed. Please install Pulumi first."
        exit 1
    fi

    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        log "ERROR" "Node.js is not installed. Please install Node.js first."
        exit 1
    fi

    # Check if the project directories exist
    for project in "${PROJECTS[@]}"; do
        if [ ! -d "${PULUMI_DIR}/${project}" ]; then
            log "ERROR" "Project directory not found: ${PULUMI_DIR}/${project}"
            exit 1
        fi

        # Check if Pulumi.yaml exists in the project directory
        if [ ! -f "${PULUMI_DIR}/${project}/Pulumi.yaml" ]; then
            log "ERROR" "Pulumi.yaml not found in project: ${PULUMI_DIR}/${project}"
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

# Function to get active stack name for a project
function get_active_stack() {
    local project_dir=$1
    cd "${project_dir}"

    # Get the active stack
    pulumi stack ls | grep "* " | awk '{print $2}'
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

# Function to run Pulumi preview
function run_preview() {
    local project=$1
    local project_dir="${PULUMI_DIR}/${project}"
    local stack=$(get_active_stack "${project_dir}")

    log "INFO" "Previewing changes for project: ${project} (stack: ${stack})"

    cd "${project_dir}"

    # Add verbose flag if requested
    local verbose_flag=""
    if [ "$VERBOSE" = true ]; then
        verbose_flag="--verbose=3"
    fi

    # Run Pulumi preview
    if ! pulumi preview ${verbose_flag} 2>&1 | tee -a "${LOG_FILE}"; then
        log "ERROR" "Pulumi preview failed for project: ${project}"
        return 1
    fi

    log "INFO" "Preview completed for project: ${project}"
    return 0
}

# Function to run Pulumi up
function run_deployment() {
    local project=$1
    local project_dir="${PULUMI_DIR}/${project}"
    local stack=$(get_active_stack "${project_dir}")

    log "INFO" "Deploying project: ${project} (stack: ${stack})"

    cd "${project_dir}"

    # Add verbose flag if requested
    local verbose_flag=""
    if [ "$VERBOSE" = true ]; then
        verbose_flag="--verbose=3"
    fi

    # Add yes flag if auto-yes is enabled
    local yes_flag=""
    if [ "$AUTO_YES" = true ]; then
        yes_flag="--yes"
    fi

    # Run Pulumi up
    if ! pulumi up ${yes_flag} ${verbose_flag} 2>&1 | tee -a "${LOG_FILE}"; then
        log "ERROR" "Pulumi deployment failed for project: ${project}"
        return 1
    fi

    log "INFO" "Deployment completed for project: ${project}"
    return 0
}

# Function to display stack outputs
function display_outputs() {
    local project=$1
    local project_dir="${PULUMI_DIR}/${project}"
    local stack=$(get_active_stack "${project_dir}")

    log "INFO" "Getting outputs for project: ${project} (stack: ${stack})"

    cd "${project_dir}"

    # Run Pulumi stack output
    echo -e "${BLUE}Outputs for ${project}:${NC}"
    pulumi stack output -j | jq -r '.' | tee -a "${LOG_FILE}"

    log "INFO" "Outputs displayed for project: ${project}"
}

# Parse command line arguments
VERBOSE=false
SHOW_OUTPUTS=false
SKIP_STACKS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -p|--preview)
            PREVIEW_ONLY=true
            shift
            ;;
        -s|--stack)
            SELECTED_STACKS+=("$2")
            shift 2
            ;;
        -y|--yes)
            AUTO_YES=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -o|--outputs)
            SHOW_OUTPUTS=true
            shift
            ;;
        --skip)
            SKIP_STACKS+=("$2")
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Filter projects based on selected and skipped stacks
if [ ${#SELECTED_STACKS[@]} -gt 0 ]; then
    # Verify all selected stacks are valid
    for stack in "${SELECTED_STACKS[@]}"; do
        if [[ ! " ${PROJECTS[*]} " =~ " ${stack} " ]]; then
            log "ERROR" "Invalid stack selected: ${stack}"
            log "ERROR" "Valid stacks are: ${PROJECTS[*]}"
            exit 1
        fi
    done

    # Use only selected stacks in their original order
    FILTERED_PROJECTS=()
    for project in "${PROJECTS[@]}"; do
        for selected in "${SELECTED_STACKS[@]}"; do
            if [ "$project" = "$selected" ]; then
                FILTERED_PROJECTS+=("$project")
                break
            fi
        done
    done
    PROJECTS=("${FILTERED_PROJECTS[@]}")
fi

# Remove skipped stacks from the projects list
if [ ${#SKIP_STACKS[@]} -gt 0 ]; then
    for skip in "${SKIP_STACKS[@]}"; do
        log "INFO" "Skipping stack: ${skip}"
        FILTERED_PROJECTS=()
        for project in "${PROJECTS[@]}"; do
            if [ "$project" != "$skip" ]; then
                FILTERED_PROJECTS+=("$project")
            fi
        done
        PROJECTS=("${FILTERED_PROJECTS[@]}")
    done
fi

# Main execution
{
    log "INFO" "Starting homelab Pulumi deployment process"
    log "INFO" "Log file: ${LOG_FILE}"

    # Check prerequisites
    check_prerequisites

    # Show planned execution
    log "INFO" "The following Pulumi projects will be processed in order:"
    for project in "${PROJECTS[@]}"; do
        local project_dir="${PULUMI_DIR}/${project}"
        local stack=$(get_active_stack "${project_dir}")
        log "INFO" "  - ${project} (stack: ${stack})"
    done

    # Determine action based on preview flag
    if [ "$PREVIEW_ONLY" = true ]; then
        log "INFO" "Preview mode enabled, no actual deployments will be made"

        # Confirm preview
        if ! confirm_execution "Do you want to preview all projects?"; then
            log "INFO" "Preview cancelled by user"
            exit 0
        fi

        # Run previews for all projects
        for project in "${PROJECTS[@]}"; do
            if ! run_preview "$project"; then
                log "ERROR" "Preview failed for project: ${project}"
                exit 1
            fi

            # Pause for user to review
            echo
            echo -e "${YELLOW}Preview completed for ${project}. Press Enter to continue...${NC}"
            read -r
        done

        log "INFO" "All previews completed successfully"
        exit 0
    else
        # Deployment mode
        log "INFO" "Deployment mode enabled, resources will be created/updated"

        # Confirm deployment
        if ! confirm_execution "Do you want to proceed with the deployment?"; then
            log "INFO" "Deployment cancelled by user"
            exit 0
        fi

        # Run deployments for all projects
        for project in "${PROJECTS[@]}"; do
            # First preview
            if ! run_preview "$project"; then
                log "ERROR" "Preview failed for project: ${project}"
                exit 1
            fi

            # Confirm deployment after preview
            if ! confirm_execution "Do you want to deploy ${project}?"; then
                log "INFO" "Deployment skipped for project: ${project}"
                continue
            fi

            # Run deployment
            if ! run_deployment "$project"; then
                log "ERROR" "Deployment failed for project: ${project}"
                exit 1
            fi

            # Show outputs if requested
            if [ "$SHOW_OUTPUTS" = true ]; then
                display_outputs "$project"
            fi

            # If not the last project, prompt for continuation
            if [ "$project" != "${PROJECTS[-1]}" ]; then
                if ! confirm_execution "Continue with the next project?"; then
                    log "INFO" "Deployment paused by user after project: ${project}"
                    exit 0
                fi
            fi
        done

        log "INFO" "All deployments completed successfully"

        # Final outputs
        if [ "$SHOW_OUTPUTS" = true ]; then
            log "INFO" "Summary of all outputs:"
            for project in "${PROJECTS[@]}"; do
                display_outputs "$project"
                echo
            done
        fi
    fi
} || {
    error_code=$?
    log "ERROR" "Deployment failed with error code: ${error_code}"
    exit $error_code
}

exit 0
