#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Function for logging
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to handle errors
handle_error() {
    log_error "An error occurred during migration. Please check the output above."
    exit 1
}

# Function to check cluster connectivity
check_cluster_connectivity() {
    # Check if kubectl is installed
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    }

    # Check if KUBECONFIG is set
    if [ -z "$KUBECONFIG" ]; then
        # Try default location
        if [ -f "$HOME/.kube/config" ]; then
            export KUBECONFIG="$HOME/.kube/config"
        else
            log_error "KUBECONFIG is not set and no config found at $HOME/.kube/config"
            log_error "Please set KUBECONFIG environment variable or provide a valid kubeconfig file"
            exit 1
        }
    fi

    # Test cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        log_error "Please check your KUBECONFIG and cluster status"
        exit 1
    }

    log "Successfully connected to Kubernetes cluster"
}

# Set up error trap
trap handle_error ERR

# Function to create operator version of CustomResourceDefinitions for Traefik
setup_operator_crds() {
    local namespace=$1

    log "Setting up Traefik Operator CRDs in namespace: $namespace"

    # First create OLM namespace if it doesn't exist
    kubectl get namespace olm &>/dev/null || kubectl create namespace olm

    # Create OperatorGroup if it doesn't exist
    if ! kubectl get operatorgroup -n $namespace &>/dev/null; then
        log "Creating OperatorGroup in namespace: $namespace"
        kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: traefik-operator-group
  namespace: $namespace
spec:
  targetNamespaces:
  - $namespace
EOF
    fi

    # Create CatalogSource if it doesn't exist
    if ! kubectl get catalogsource -n olm operatorhubio-catalog &>/dev/null; then
        log "Creating OperatorHub catalog source"
        kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: CatalogSource
metadata:
  name: operatorhubio-catalog
  namespace: olm
spec:
  sourceType: grpc
  image: quay.io/operatorhubio/catalog:latest
  displayName: OperatorHub.io Catalog
  publisher: OperatorHub.io
EOF
    fi

    # Create Subscription for Traefik Operator
    log "Creating Traefik Operator subscription"
    kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: traefik-operator
  namespace: $namespace
spec:
  channel: alpha
  name: traefik-operator
  source: operatorhubio-catalog
  sourceNamespace: olm
EOF

    log "Waiting for Traefik operator to be installed..."
    sleep 10

    # Check if the operator is installed
    for i in {1..12}; do
        if kubectl get csv -n $namespace | grep -q traefik-operator; then
            log "Traefik operator installed successfully"
            return 0
        fi
        log "Waiting for operator installation (attempt $i/12)..."
        sleep 10
    done

    log_error "Timed out waiting for Traefik operator to be installed"
    return 1
}

# Function to migrate Traefik Helm chart to Operator
migrate_traefik() {
    # Get current Traefik namespace
    local current_namespace=$(kubectl get svc -A | grep traefik | head -1 | awk '{print $1}')

    if [ -z "$current_namespace" ]; then
        log_error "Could not detect current Traefik installation. Please specify the namespace with --namespace."
        exit 1
    fi

    log "Detected Traefik installation in namespace: $current_namespace"

    # Setup the operator and CRDs
    setup_operator_crds "$current_namespace"

    # Get current Traefik configuration
    log "Extracting current Traefik configuration..."

    # Get replica count
    local replicas=$(kubectl get deployment -n $current_namespace traefik -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")

    # Get resource settings
    local cpu_request=$(kubectl get deployment -n $current_namespace traefik -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || echo "100m")
    local memory_request=$(kubectl get deployment -n $current_namespace traefik -o jsonpath='{.spec.template.spec.containers[0].resources.requests.memory}' 2>/dev/null || echo "128Mi")
    local cpu_limit=$(kubectl get deployment -n $current_namespace traefik -o jsonpath='{.spec.template.spec.containers[0].resources.limits.cpu}' 2>/dev/null || echo "300m")
    local memory_limit=$(kubectl get deployment -n $current_namespace traefik -o jsonpath='{.spec.template.spec.containers[0].resources.limits.memory}' 2>/dev/null || echo "256Mi")

    # Create TraefikController CR
    log "Creating TraefikController custom resource..."
    kubectl apply -f - <<EOF
apiVersion: traefik.io/v1alpha1
kind: TraefikController
metadata:
  name: traefik-controller
  namespace: $current_namespace
spec:
  replicas: $replicas
  resources:
    requests:
      cpu: $cpu_request
      memory: $memory_request
    limits:
      cpu: $cpu_limit
      memory: $memory_limit
  logging:
    level: "INFO"
  additionalArguments:
    - "--api.dashboard=true"
    - "--api.insecure=false"
    - "--serverstransport.insecureskipverify=true"
    - "--providers.kubernetesingress.ingressclass=traefik"
    - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
    - "--entrypoints.web.http.redirections.entryPoint.scheme=https"
    - "--entrypoints.web.http.redirections.entrypoint.permanent=true"
EOF

    log "Waiting for TraefikController to be ready..."
    sleep 10

    # Check if existing Helm chart resources exist and warn user
    if kubectl get helmrelease -n $current_namespace traefik &>/dev/null || kubectl get deployment -n $current_namespace traefik &>/dev/null; then
        log_warning "Detected existing Traefik Helm chart resources."
        log_warning "You may need to manually clean up these resources after verifying the operator is working."
        log_warning "To clean up Helm resources, run:"
        log_warning "  kubectl delete helmrelease -n $current_namespace traefik"
        log_warning "  kubectl delete deployment -n $current_namespace traefik"
        log_warning "  kubectl delete service -n $current_namespace traefik"
    fi

    log "Traefik migration completed successfully!"
    log "The operator-based Traefik should now be running alongside the Helm-based one."
    log "After verifying it works, remove the Helm-based resources as mentioned above."
}

# Parse command-line arguments
NAMESPACE=""
KUBECONFIG_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --kubeconfig)
            KUBECONFIG_PATH="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [--namespace NAMESPACE] [--kubeconfig PATH]"
            echo ""
            echo "Options:"
            echo "  --namespace NAMESPACE    Specify the namespace of your current Traefik installation"
            echo "  --kubeconfig PATH       Path to kubeconfig file"
            echo "  --help                  Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help to see available options"
            exit 1
            ;;
    esac
done

# Set KUBECONFIG if provided
if [ -n "$KUBECONFIG_PATH" ]; then
    if [ -f "$KUBECONFIG_PATH" ]; then
        export KUBECONFIG="$KUBECONFIG_PATH"
    else
        log_error "Kubeconfig file not found: $KUBECONFIG_PATH"
        exit 1
    fi
fi

# Check cluster connectivity before proceeding
check_cluster_connectivity

# If namespace is provided, use it
if [ -n "$NAMESPACE" ]; then
    log "Using provided namespace: $NAMESPACE"
    migrate_traefik "$NAMESPACE"
else
    migrate_traefik
fi
