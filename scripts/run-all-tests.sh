#!/bin/bash

# =============================================================================
# Complete End-to-End Test Suite
# Runs all tests in the project with proper error handling and reporting
# =============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/test-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
JUNIT_DIR="${LOG_DIR}/junit"
COVERAGE_DIR="${LOG_DIR}/coverage"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
declare -A TEST_RESULTS
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Command line options
VERBOSE=false
SKIP_LINT=false
SKIP_UNIT=false
SKIP_INTEGRATION=false
SKIP_ANSIBLE=false
SKIP_PULUMI=false
PARALLEL=false
ENVIRONMENT="local"

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Run complete end-to-end test suite for the project.

OPTIONS:
    -v, --verbose           Enable verbose output
    -h, --help             Show this help message
    --skip-lint            Skip linting and formatting checks
    --skip-unit            Skip unit tests
    --skip-integration     Skip integration tests
    --skip-ansible         Skip Ansible role tests
    --skip-pulumi          Skip Pulumi infrastructure tests
    --parallel             Run tests in parallel where possible
    --env ENVIRONMENT      Set environment (local, ci, staging) [default: local]

EXAMPLES:
    $0                     # Run all tests
    $0 --verbose           # Run with verbose output
    $0 --skip-lint         # Skip linting checks
    $0 --parallel --env ci # Run in parallel for CI environment
EOF
}

setup_test_environment() {
    print_header "Setting Up Test Environment"

    # Create log directories
    mkdir -p "${LOG_DIR}" "${JUNIT_DIR}" "${COVERAGE_DIR}"

    # Check dependencies
    print_info "Checking dependencies..."

    local missing_deps=()

    command -v python3 >/dev/null 2>&1 || missing_deps+=("python3")
    command -v uv >/dev/null 2>&1 || missing_deps+=("uv")
    command -v ansible >/dev/null 2>&1 || missing_deps+=("ansible")
    command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
    command -v node >/dev/null 2>&1 || missing_deps+=("node")
    command -v pulumi >/dev/null 2>&1 || missing_deps+=("pulumi")

    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing dependencies: ${missing_deps[*]}"
        print_info "Please install missing dependencies before running tests"
        exit 1
    fi

    # Change to project root
    cd "${PROJECT_ROOT}"

    print_success "Test environment setup complete"
}

record_test_result() {
    local test_name="$1"
    local result="$2"
    local duration="$3"

    TEST_RESULTS["$test_name"]="$result"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    if [ "$result" = "PASSED" ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        print_success "$test_name completed in ${duration}s"
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        print_error "$test_name failed after ${duration}s"
    fi
}

run_with_timeout() {
    local timeout_duration="$1"
    local test_name="$2"
    shift 2
    local command=("$@")

    local start_time=$(date +%s)

    if timeout "${timeout_duration}" "${command[@]}"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        record_test_result "$test_name" "PASSED" "$duration"
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        record_test_result "$test_name" "FAILED" "$duration"
        return 1
    fi
}

# =============================================================================
# Test Execution Functions
# =============================================================================

run_pre_commit_checks() {
    if [ "$SKIP_LINT" = true ]; then
        print_warning "Skipping pre-commit checks"
        return 0
    fi

    print_header "Running Pre-commit Checks"

    # Install pre-commit hooks if not already installed
    if ! pre-commit --version >/dev/null 2>&1; then
        print_info "Installing pre-commit..."
        pip install pre-commit
    fi

    local log_file="${LOG_DIR}/precommit_${TIMESTAMP}.log"

    if [ "$VERBOSE" = true ]; then
        run_with_timeout 600 "Pre-commit Checks" \
            pre-commit run --all-files --verbose 2>&1 | tee "$log_file"
    else
        run_with_timeout 600 "Pre-commit Checks" \
            pre-commit run --all-files > "$log_file" 2>&1
    fi
}

run_python_tests() {
    if [ "$SKIP_UNIT" = true ] && [ "$SKIP_INTEGRATION" = true ]; then
        print_warning "Skipping Python tests"
        return 0
    fi

    print_header "Running Python Tests"

    local pytest_args=(
        "--tb=short"
        "--strict-markers"
        "--strict-config"
        "--junit-xml=${JUNIT_DIR}/pytest_results.xml"
        "--cov-report=html:${COVERAGE_DIR}/pytest"
        "--cov-report=xml:${COVERAGE_DIR}/pytest_coverage.xml"
        "--cov-report=term-missing"
    )

    if [ "$VERBOSE" = true ]; then
        pytest_args+=("-v")
    fi

    if [ "$PARALLEL" = true ] && command -v pytest-xdist >/dev/null 2>&1; then
        pytest_args+=("-n" "auto")
    fi

    local log_file="${LOG_DIR}/pytest_${TIMESTAMP}.log"

    if [ "$VERBOSE" = true ]; then
        run_with_timeout 1200 "Python Tests" \
            uv run pytest tests/ "${pytest_args[@]}" 2>&1 | tee "$log_file"
    else
        run_with_timeout 1200 "Python Tests" \
            uv run pytest tests/ "${pytest_args[@]}" > "$log_file" 2>&1
    fi
}

run_ansible_tests() {
    if [ "$SKIP_ANSIBLE" = true ]; then
        print_warning "Skipping Ansible tests"
        return 0
    fi

    print_header "Running Ansible Role Tests"

    # Find all Ansible roles
    local roles_dir="${PROJECT_ROOT}/ansible/roles"
    if [ ! -d "$roles_dir" ]; then
        print_warning "No Ansible roles directory found, skipping Ansible tests"
        return 0
    fi

    local roles=($(find "$roles_dir" -maxdepth 1 -type d -exec basename {} \; | grep -v "^roles$" || true))

    if [ ${#roles[@]} -eq 0 ]; then
        print_warning "No Ansible roles found, skipping Ansible tests"
        return 0
    fi

    local ansible_log="${LOG_DIR}/ansible_${TIMESTAMP}.log"
    local all_passed=true

    for role in "${roles[@]}"; do
        print_info "Testing Ansible role: $role"

        local role_log="${LOG_DIR}/ansible_${role}_${TIMESTAMP}.log"

        if [ -f "${PROJECT_ROOT}/scripts/run-molecule-tests.sh" ]; then
            if [ "$VERBOSE" = true ]; then
                if ! run_with_timeout 900 "Ansible Role: $role" \
                    "${PROJECT_ROOT}/scripts/run-molecule-tests.sh" "$role" 2>&1 | tee "$role_log"; then
                    all_passed=false
                fi
            else
                if ! run_with_timeout 900 "Ansible Role: $role" \
                    "${PROJECT_ROOT}/scripts/run-molecule-tests.sh" "$role" > "$role_log" 2>&1; then
                    all_passed=false
                fi
            fi
        else
            # Fallback to direct molecule command
            cd "${roles_dir}/${role}"
            if [ "$VERBOSE" = true ]; then
                if ! run_with_timeout 900 "Ansible Role: $role" \
                    molecule test 2>&1 | tee "$role_log"; then
                    all_passed=false
                fi
            else
                if ! run_with_timeout 900 "Ansible Role: $role" \
                    molecule test > "$role_log" 2>&1; then
                    all_passed=false
                fi
            fi
            cd "${PROJECT_ROOT}"
        fi

        cat "$role_log" >> "$ansible_log"
    done

    if [ "$all_passed" = false ]; then
        record_test_result "Ansible Tests Overall" "FAILED" "0"
    fi
}

run_pulumi_tests() {
    if [ "$SKIP_PULUMI" = true ]; then
        print_warning "Skipping Pulumi tests"
        return 0
    fi

    print_header "Running Pulumi Infrastructure Tests"

    local pulumi_dir="${PROJECT_ROOT}/pulumi"
    if [ ! -d "$pulumi_dir" ]; then
        print_warning "No Pulumi directory found, skipping Pulumi tests"
        return 0
    fi

    cd "$pulumi_dir"

    # Install dependencies
    print_info "Installing Pulumi dependencies..."
    npm install

    local log_file="${LOG_DIR}/pulumi_${TIMESTAMP}.log"

    # Run TypeScript compilation check
    if [ "$VERBOSE" = true ]; then
        run_with_timeout 300 "Pulumi TypeScript Compilation" \
            npx tsc --noEmit 2>&1 | tee "$log_file"
    else
        run_with_timeout 300 "Pulumi TypeScript Compilation" \
            npx tsc --noEmit > "$log_file" 2>&1
    fi

    # Run Pulumi validation
    if [ -f "${PROJECT_ROOT}/scripts/test-pulumi.sh" ]; then
        if [ "$VERBOSE" = true ]; then
            run_with_timeout 600 "Pulumi Stack Validation" \
                "${PROJECT_ROOT}/scripts/test-pulumi.sh" 2>&1 | tee -a "$log_file"
        else
            run_with_timeout 600 "Pulumi Stack Validation" \
                "${PROJECT_ROOT}/scripts/test-pulumi.sh" >> "$log_file" 2>&1
        fi
    else
        # Fallback to basic pulumi preview
        if [ "$VERBOSE" = true ]; then
            run_with_timeout 600 "Pulumi Preview" \
                pulumi preview --non-interactive 2>&1 | tee -a "$log_file"
        else
            run_with_timeout 600 "Pulumi Preview" \
                pulumi preview --non-interactive >> "$log_file" 2>&1
        fi
    fi

    cd "${PROJECT_ROOT}"
}

run_home_assistant_tests() {
    print_header "Running Home Assistant Tests"

    if [ -f "${PROJECT_ROOT}/scripts/test-home-assistant.sh" ]; then
        local log_file="${LOG_DIR}/home_assistant_${TIMESTAMP}.log"

        if [ "$VERBOSE" = true ]; then
            run_with_timeout 600 "Home Assistant Tests" \
                "${PROJECT_ROOT}/scripts/test-home-assistant.sh" 2>&1 | tee "$log_file"
        else
            run_with_timeout 600 "Home Assistant Tests" \
                "${PROJECT_ROOT}/scripts/test-home-assistant.sh" > "$log_file" 2>&1
        fi
    else
        print_warning "Home Assistant test script not found, skipping"
    fi
}

# =============================================================================
# Reporting Functions
# =============================================================================

generate_summary_report() {
    print_header "Test Summary Report"

    local report_file="${LOG_DIR}/summary_${TIMESTAMP}.txt"

    {
        echo "================================================"
        echo "End-to-End Test Suite Summary"
        echo "================================================"
        echo "Timestamp: $(date)"
        echo "Environment: $ENVIRONMENT"
        echo "Project Root: $PROJECT_ROOT"
        echo ""
        echo "Test Results:"
        echo "  Total Tests: $TOTAL_TESTS"
        echo "  Passed: $PASSED_TESTS"
        echo "  Failed: $FAILED_TESTS"
        echo "  Success Rate: $(( PASSED_TESTS * 100 / TOTAL_TESTS ))%"
        echo ""
        echo "Individual Test Results:"

        for test_name in "${!TEST_RESULTS[@]}"; do
            printf "  %-30s %s\n" "$test_name" "${TEST_RESULTS[$test_name]}"
        done

        echo ""
        echo "Log Files Location: $LOG_DIR"
        echo "JUnit XML Reports: $JUNIT_DIR"
        echo "Coverage Reports: $COVERAGE_DIR"

    } | tee "$report_file"

    # Display colored summary
    echo ""
    if [ $FAILED_TESTS -eq 0 ]; then
        print_success "All tests passed! 🎉"
    else
        print_error "$FAILED_TESTS test(s) failed"
        echo ""
        print_info "Check the following log files for details:"
        find "$LOG_DIR" -name "*${TIMESTAMP}.log" -type f | while read -r log_file; do
            echo "  - $log_file"
        done
    fi
}

cleanup_and_exit() {
    local exit_code=$1

    print_info "Cleaning up temporary files..."

    # Archive test results if in CI environment
    if [ "$ENVIRONMENT" = "ci" ]; then
        tar -czf "test-results-${TIMESTAMP}.tar.gz" -C "$LOG_DIR" .
        print_info "Test results archived to test-results-${TIMESTAMP}.tar.gz"
    fi

    exit $exit_code
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            --skip-lint)
                SKIP_LINT=true
                shift
                ;;
            --skip-unit)
                SKIP_UNIT=true
                shift
                ;;
            --skip-integration)
                SKIP_INTEGRATION=true
                shift
                ;;
            --skip-ansible)
                SKIP_ANSIBLE=true
                shift
                ;;
            --skip-pulumi)
                SKIP_PULUMI=true
                shift
                ;;
            --parallel)
                PARALLEL=true
                shift
                ;;
            --env)
                ENVIRONMENT="$2"
                shift 2
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    # Trap for cleanup
    trap 'cleanup_and_exit $?' EXIT

    print_header "Starting Complete End-to-End Test Suite"
    print_info "Environment: $ENVIRONMENT"
    print_info "Timestamp: $TIMESTAMP"
    print_info "Log Directory: $LOG_DIR"

    # Setup
    setup_test_environment

    # Run test suites
    run_pre_commit_checks
    run_python_tests
    run_ansible_tests
    run_pulumi_tests
    run_home_assistant_tests

    # Generate reports
    generate_summary_report

    # Exit with appropriate code
    if [ $FAILED_TESTS -eq 0 ]; then
        cleanup_and_exit 0
    else
        cleanup_and_exit 1
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
