#!/bin/bash
# deploy-correlator.sh - Script to deploy the log-metric correlator
#
# This script deploys the log-metric correlator service which connects logs from Loki
# with metrics from Prometheus for enhanced monitoring and diagnostics.

set -e

# Script variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORRELATOR_DIR="${SCRIPT_DIR}/../monitoring/correlator"
CORRELATOR_PY="${CORRELATOR_DIR}/log_metric_correlator.py"
DEPLOYMENT_YAML="${CORRELATOR_DIR}/deployment.yaml"
NAMESPACE="monitoring"

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

Deploy the log-metric correlator service to Kubernetes.

Options:
  -h, --help               Show this help message and exit
  -n, --namespace NAME     Use the specified namespace (default: monitoring)
  -v, --verbose            Increase verbosity of output

Examples:
  ${0}                           # Deploy the correlator to the monitoring namespace
  ${0} --namespace observability  # Deploy to the observability namespace

EOF
    exit 0
}

# Function for logging
function log() {
    local level=$1
    local message=$2
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")

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

    # Check if base64 is installed
    if ! command -v base64 &> /dev/null; then
        log "ERROR" "base64 is not installed. Please install base64 first."
        exit 1
    fi

    # Check if the correlator script exists
    if [ ! -f "${CORRELATOR_PY}" ]; then
        log "ERROR" "Correlator script not found: ${CORRELATOR_PY}"
        exit 1
    fi

    # Check if the deployment YAML exists
    if [ ! -f "${DEPLOYMENT_YAML}" ]; then
        log "ERROR" "Deployment YAML not found: ${DEPLOYMENT_YAML}"
        exit 1
    fi

    # Check Kubernetes connection
    if ! kubectl get ns &> /dev/null; then
        log "ERROR" "Failed to connect to Kubernetes. Please check your kubeconfig."
        exit 1
    fi

    log "INFO" "Prerequisites check completed successfully"
}

# Function to update the ConfigMap in the deployment YAML
function update_configmap() {
    log "INFO" "Updating ConfigMap with correlator script..."
    
    # Read the correlator script
    local script_content=$(cat "${CORRELATOR_PY}")
    
    # Create a temporary deployment file with the script content
    local temp_deployment=$(mktemp)
    awk -v script="${script_content}" '
        /log_metric_correlator.py: \|/ {
            print "  log_metric_correlator.py: |"
            split(script, lines, "\n")
            for (i in lines) {
                print "    " lines[i]
            }
            skip_next = 1
            next
        }
        skip_next && /^    / {
            skip_next = ($0 ~ /^    [^ ]/) ? 1 : 0
            next
        }
        { skip_next = 0; print }
    ' "${DEPLOYMENT_YAML}" > "${temp_deployment}"
    
    mv "${temp_deployment}" "${DEPLOYMENT_YAML}"
    log "INFO" "ConfigMap updated successfully"
}

# Function to deploy the correlator
function deploy_correlator() {
    log "INFO" "Deploying log-metric correlator to namespace ${NAMESPACE}..."
    
    # Check if namespace exists, create if not
    if ! kubectl get namespace "${NAMESPACE}" &> /dev/null; then
        log "INFO" "Creating namespace: ${NAMESPACE}"
        kubectl create namespace "${NAMESPACE}"
    fi
    
    # Apply the deployment
    kubectl apply -f "${DEPLOYMENT_YAML}" -n "${NAMESPACE}"
    
    log "INFO" "Log-metric correlator deployed successfully"
    
    # Wait for deployment to be ready
    log "INFO" "Waiting for deployment to be ready..."
    kubectl rollout status deployment/log-metric-correlator -n "${NAMESPACE}" --timeout=120s
    
    if [ $? -eq 0 ]; then
        log "INFO" "Deployment is ready"
    else
        log "WARN" "Timed out waiting for deployment to be ready"
    fi
}

# Parse command line arguments
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Main execution
check_prerequisites
update_configmap
deploy_correlator

log "INFO" "Log-metric correlator deployment completed"
