#!/bin/bash
# deploy-dashboards.sh - Script to deploy Grafana dashboards to Kubernetes
#
# This script automates the deployment of Grafana dashboards by creating ConfigMaps
# in Kubernetes from local JSON dashboard files.

set -e

# Script variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="${SCRIPT_DIR}/../monitoring/grafana/dashboards"
NAMESPACE="monitoring"
LOG_FILE="${SCRIPT_DIR}/../logs/dashboard-deploy-$(date +%Y%m%d-%H%M%S).log"

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

Deploy Grafana dashboards to Kubernetes as ConfigMaps.

Options:
  -h, --help               Show this help message and exit
  -n, --namespace NAME     Use the specified namespace (default: monitoring)
  -d, --dashboard NAME     Deploy only the specified dashboard
  -l, --list               List available dashboards
  -v, --verbose            Increase verbosity of output
  -a, --apply-only         Only apply dashboards, don't update Grafana sidecar

Examples:
  ${0}                            # Deploy all dashboards
  ${0} --namespace grafana        # Deploy to the grafana namespace
  ${0} --dashboard test-results   # Deploy only the test-results dashboard

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

    # Check if kubectl is installed
    if ! command -v kubectl &> /dev/null; then
        log "ERROR" "kubectl is not installed. Please install kubectl first."
        exit 1
    fi

    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        log "ERROR" "jq is not installed. Please install jq first."
        exit 1
    fi

    # Create log directory if it doesn't exist
    if [ ! -d "$(dirname "${LOG_FILE}")" ]; then
        mkdir -p "$(dirname "${LOG_FILE}")"
        log "INFO" "Created log directory: $(dirname "${LOG_FILE}")"
    fi

    # Check if dashboard directory exists
    if [ ! -d "${DASHBOARD_DIR}" ]; then
        log "ERROR" "Dashboard directory not found: ${DASHBOARD_DIR}"
        exit 1
    fi

    # Check Kubernetes connection
    if ! kubectl get ns &> /dev/null; then
        log "ERROR" "Failed to connect to Kubernetes. Please check your kubeconfig."
        exit 1
    fi

    log "INFO" "Prerequisites check completed successfully"
}

# Function to list available dashboards
function list_dashboards() {
    log "INFO" "Available dashboards:"

    for dashboard_file in "${DASHBOARD_DIR}"/*.json; do
        if [ -f "${dashboard_file}" ]; then
            dashboard_name=$(basename "${dashboard_file}" .json)
            dashboard_title=$(jq -r '.title' "${dashboard_file}")
            printf "  - %-30s %s\n" "${dashboard_name}" "${dashboard_title}"
        fi
    done
}

# Function to deploy a dashboard
function deploy_dashboard() {
    local dashboard_file=$1
    local dashboard_name=$(basename "${dashboard_file}" .json)

    log "INFO" "Deploying dashboard: ${dashboard_name}"

    # Read dashboard JSON
    local dashboard_json=$(cat "${dashboard_file}")

    # Create ConfigMap name based on dashboard filename
    local configmap_name="grafana-dashboard-${dashboard_name}"

    # Create ConfigMap with dashboard JSON
    kubectl create configmap "${configmap_name}" \
        --from-literal=dashboard.json="${dashboard_json}" \
        --dry-run=client -o yaml | \
        kubectl apply -n "${NAMESPACE}" -f -

    if [ $? -eq 0 ]; then
        log "INFO" "Successfully deployed dashboard: ${dashboard_name}"
    else
        log "ERROR" "Failed to deploy dashboard: ${dashboard_name}"
        return 1
    fi
}

# Function to refresh Grafana sidecar
function refresh_grafana_sidecar() {
    log "INFO" "Refreshing Grafana dashboard sidecar..."

    # Find Grafana pods
    local grafana_pods=$(kubectl get pods -n "${NAMESPACE}" -l app=grafana -o name)

    if [ -z "${grafana_pods}" ]; then
        log "WARN" "No Grafana pods found in namespace ${NAMESPACE}"
        return 0
    fi

    # Delete Grafana pods to trigger a refresh (the sidecar will reload dashboards)
    for pod in ${grafana_pods}; do
        kubectl delete -n "${NAMESPACE}" "${pod}"
        log "INFO" "Deleted ${pod} to trigger dashboard refresh"
    done

    # Wait for Grafana to be back up
    log "INFO" "Waiting for Grafana to restart..."
    kubectl wait --for=condition=ready pods -l app=grafana -n "${NAMESPACE}" --timeout=60s

    if [ $? -eq 0 ]; then
        log "INFO" "Grafana is ready"
    else
        log "WARN" "Timed out waiting for Grafana to be ready"
    fi
}

# Parse command line arguments
VERBOSE=false
SELECTED_DASHBOARD=""
LIST_DASHBOARDS=false
APPLY_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -d|--dashboard)
            SELECTED_DASHBOARD="$2"
            shift 2
            ;;
        -l|--list)
            LIST_DASHBOARDS=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -a|--apply-only)
            APPLY_ONLY=true
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
    log "INFO" "Starting dashboard deployment process"
    log "INFO" "Log file: ${LOG_FILE}"

    # Check prerequisites
    check_prerequisites

    # List dashboards if requested
    if [ "${LIST_DASHBOARDS}" = true ]; then
        list_dashboards
        exit 0
    fi

    # Deploy dashboards
    if [ -n "${SELECTED_DASHBOARD}" ]; then
        # Deploy specific dashboard
        dashboard_file="${DASHBOARD_DIR}/${SELECTED_DASHBOARD}.json"

        if [ -f "${dashboard_file}" ]; then
            deploy_dashboard "${dashboard_file}"
        else
            log "ERROR" "Dashboard file not found: ${dashboard_file}"
            exit 1
        fi
    else
        # Deploy all dashboards
        for dashboard_file in "${DASHBOARD_DIR}"/*.json; do
            if [ -f "${dashboard_file}" ]; then
                deploy_dashboard "${dashboard_file}"
            fi
        done
    fi

    # Refresh Grafana sidecar
    if [ "${APPLY_ONLY}" != true ]; then
        refresh_grafana_sidecar
    fi

    log "INFO" "Dashboard deployment completed"
} 2>&1 | tee -a "${LOG_FILE}"

# Exit with the status of the last command in the pipeline
exit ${PIPESTATUS[0]}
