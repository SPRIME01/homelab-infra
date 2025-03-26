#!/bin/bash
# test-pulumi.sh - Script to test Pulumi stacks for homelab infrastructure
#
# This script performs various tests on Pulumi stacks including TypeScript validation,
# Pulumi previews, and unit tests with proper error handling.

# Set strict mode
set -e

# Script variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PULUMI_DIR="${SCRIPT_DIR}/../pulumi"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/pulumi-test-$(date +%Y%m%d-%H%M%S).log"
SUMMARY_FILE="${LOG_DIR}/pulumi-test-summary-$(date +%Y%m%d-%H%M%S).txt"
TEST_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0
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

Test Pulumi stacks for homelab setup.

Options:
  -h, --help           Show this help message and exit
  -s, --stack STACK    Only test a specific stack (can be used multiple times)
                       Valid stacks: ${PROJECTS[*]}
  -t, --test-only      Only run unit tests, skip TypeScript validation and previews
  -p, --preview-only   Only run Pulumi previews, skip TypeScript validation and unit tests
  -v, --validate-only  Only run TypeScript validation, skip previews and unit tests
  --skip-tests         Skip unit tests
  --skip-preview       Skip Pulumi previews
  --skip-validation    Skip TypeScript validation
  --verbose            Increase verbosity of output
  --clean              Clean test artifacts before running tests

Examples:
  ${0} --stack cluster-setup       # Test only the cluster-setup stack
  ${0} --test-only                 # Only run unit tests for all stacks
  ${0} --preview-only              # Only run previews for all stacks
  ${0} --validate-only             # Only run TypeScript validation for all stacks
  ${0} --verbose                   # Run all tests with increased verbosity

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

    # Check if Pulumi is installed
    if ! command -v pulumi &> /dev/null; then
        log "ERROR" "Pulumi is not installed. Please install Pulumi first."
        exit 1
    fi

    # Check if Node.js and npm are installed
    if ! command -v node &> /dev/null; then
        log "ERROR" "Node.js is not installed. Please install Node.js first."
        exit 1
    fi

    if ! command -v npm &> /dev/null; then
        log "ERROR" "npm is not installed. Please install npm first."
        exit 1
    fi

    # Check if TypeScript compiler is installed
    if ! command -v tsc &> /dev/null; then
        log "WARN" "TypeScript compiler (tsc) is not installed globally."
        log "WARN" "Will attempt to use project-local tsc for validation."
    fi

    # Check if Jest is installed for unit tests
    if ! command -v jest &> /dev/null; then
        log "WARN" "Jest is not installed globally."
        log "WARN" "Will attempt to use project-local Jest for unit tests."
    fi

    log "INFO" "Prerequisites check completed successfully"
}

# Function to validate TypeScript
function validate_typescript() {
    local project=$1
    local project_dir="${PULUMI_DIR}/${project}"

    log "INFO" "Validating TypeScript for project: ${project}"

    # Change to the project directory
    cd "${project_dir}"

    # Check if tsconfig.json exists
    if [ ! -f "tsconfig.json" ]; then
        log "ERROR" "tsconfig.json not found in project: ${project}"
        record_result "TypeScript validation: ${project}" "FAIL" "tsconfig.json not found"
        return 1
    fi

    # Run TypeScript validation
    if [ -f "node_modules/.bin/tsc" ]; then
        # Use project-local tsc
        if ./node_modules/.bin/tsc --noEmit --pretty 2>&1 | tee -a "${LOG_FILE}"; then
            record_result "TypeScript validation: ${project}" "PASS" "TypeScript validation passed"
            return 0
        else
            record_result "TypeScript validation: ${project}" "FAIL" "TypeScript validation failed"
            log "ERROR" "TypeScript validation failed for project: ${project}"
            return 1
        fi
    elif command -v tsc &> /dev/null; then
        # Use global tsc
        if tsc --noEmit --pretty 2>&1 | tee -a "${LOG_FILE}"; then
            record_result "TypeScript validation: ${project}" "PASS" "TypeScript validation passed"
            return 0
        else
            record_result "TypeScript validation: ${project}" "FAIL" "TypeScript validation failed"
            log "ERROR" "TypeScript validation failed for project: ${project}"
            return 1
        fi
    else
        log "ERROR" "TypeScript compiler not found for project: ${project}"
        record_result "TypeScript validation: ${project}" "FAIL" "TypeScript compiler not found"
        return 1
    fi
}

# Function to run Pulumi preview
function run_pulumi_preview() {
    local project=$1
    local project_dir="${PULUMI_DIR}/${project}"

    log "INFO" "Running Pulumi preview for project: ${project}"

    # Change to the project directory
    cd "${project_dir}"

    # Add verbose flag if requested
    local verbose_flag=""
    if [ "$VERBOSE" = true ]; then
        verbose_flag="--verbose=3"
    fi

    # Run Pulumi preview
    if pulumi preview ${verbose_flag} 2>&1 | tee -a "${LOG_FILE}"; then
        record_result "Pulumi preview: ${project}" "PASS" "Pulumi preview completed successfully"
        return 0
    else
        record_result "Pulumi preview: ${project}" "FAIL" "Pulumi preview encountered errors"
        log "ERROR" "Pulumi preview failed for project: ${project}"
        return 1
    fi
}

# Function to run unit tests
function run_unit_tests() {
    local project=$1
    local project_dir="${PULUMI_DIR}/${project}"

    log "INFO" "Running unit tests for project: ${project}"

    # Change to the project directory
    cd "${project_dir}"

    # Check if tests directory exists
    if [ ! -d "src/__tests__" ] && [ ! -d "tests" ]; then
        log "WARN" "No tests directory found for project: ${project}"
        record_result "Unit tests: ${project}" "SKIP" "No tests directory found"
        return 0
    fi

    # Check if package.json has test script
    if ! grep -q '"test"' package.json; then
        log "WARN" "No test script found in package.json for project: ${project}"
        record_result "Unit tests: ${project}" "SKIP" "No test script found in package.json"
        return 0
    fi

    # Run tests
    if npm test 2>&1 | tee -a "${LOG_FILE}"; then
        record_result "Unit tests: ${project}" "PASS" "Unit tests passed"
        return 0
    else
        record_result "Unit tests: ${project}" "FAIL" "Unit tests failed"
        log "ERROR" "Unit tests failed for project: ${project}"
        return 1
    fi
}

# Function to clean test artifacts
function clean_artifacts() {
    local project=$1
    local project_dir="${PULUMI_DIR}/${project}"

    log "INFO" "Cleaning test artifacts for project: ${project}"

    # Change to the project directory
    cd "${project_dir}"

    # Remove test artifacts
    if [ -d "coverage" ]; then
        rm -rf coverage
        log "INFO" "Removed coverage directory"
    fi

    if [ -d ".nyc_output" ]; then
        rm -rf .nyc_output
        log "INFO" "Removed .nyc_output directory"
    fi

    if [ -d "bin" ]; then
        rm -rf bin
        log "INFO" "Removed bin directory"
    fi

    log "INFO" "Cleaning completed for project: ${project}"
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
SELECTED_STACKS=()
TEST_ONLY=false
PREVIEW_ONLY=false
VALIDATE_ONLY=false
SKIP_TESTS=false
SKIP_PREVIEW=false
SKIP_VALIDATION=false
VERBOSE=false
CLEAN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -s|--stack)
            SELECTED_STACKS+=("$2")
            shift 2
            ;;
        -t|--test-only)
            TEST_ONLY=true
            shift
            ;;
        -p|--preview-only)
            PREVIEW_ONLY=true
            shift
            ;;
        -v|--validate-only)
            VALIDATE_ONLY=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-preview)
            SKIP_PREVIEW=true
            shift
            ;;
        --skip-validation)
            SKIP_VALIDATION=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            ;;
    esac
done

# If only one test type is selected, skip others
if [ "$TEST_ONLY" = true ]; then
    SKIP_PREVIEW=true
    SKIP_VALIDATION=true
elif [ "$PREVIEW_ONLY" = true ]; then
    SKIP_TESTS=true
    SKIP_VALIDATION=true
elif [ "$VALIDATE_ONLY" = true ]; then
    SKIP_TESTS=true
    SKIP_PREVIEW=true
fi

# Filter projects based on selected stacks
if [ ${#SELECTED_STACKS[@]} -gt 0 ]; then
    # Verify all selected stacks are valid
    for stack in "${SELECTED_STACKS[@]}"; do
        if [[ ! " ${PROJECTS[*]} " =~ " ${stack} " ]]; then
            log "ERROR" "Invalid stack selected: ${stack}"
            log "ERROR" "Valid stacks are: ${PROJECTS[*]}"
            exit 1
        fi
    done

    # Use only selected stacks
    PROJECTS=("${SELECTED_STACKS[@]}")
fi

# Main execution
{
    log "INFO" "Starting Pulumi tests"
    log "INFO" "Log file: ${LOG_FILE}"

    # Initialize summary file
    echo "Pulumi Test Summary - $(date)" > "${SUMMARY_FILE}"
    echo "===============================" >> "${SUMMARY_FILE}"
    echo "" >> "${SUMMARY_FILE}"

    # Check prerequisites
    check_prerequisites

    # Test each project
    for project in "${PROJECTS[@]}"; do
        print_separator
        log "INFO" "Testing project: ${project}"

        # Clean artifacts if requested
        if [ "$CLEAN" = true ]; then
            clean_artifacts "${project}"
        fi

        # Skip validation if requested
        if [ "$SKIP_VALIDATION" != true ]; then
            validate_typescript "${project}"
            # Continue even if validation fails
        fi

        # Skip preview if requested
        if [ "$SKIP_PREVIEW" != true ]; then
            run_pulumi_preview "${project}"
            # Continue even if preview fails
        fi

        # Skip tests if requested
        if [ "$SKIP_TESTS" != true ]; then
            run_unit_tests "${project}"
            # Continue even if tests fail
        fi
    done

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
