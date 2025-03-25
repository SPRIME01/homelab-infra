#!/bin/bash

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

# Get the directory of this script and the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

# Function to display help
show_help() {
    echo "Pulumi Environment Variable Loader"
    echo
    echo "Usage: source ./pulumi_env.sh [OPTIONS]"
    echo
    echo "This script must be sourced, not executed, to make environment variables available in your current shell."
    echo
    echo "Options:"
    echo "  -h, --help         Show this help message"
    echo "  -a, --alias        Create shell aliases for common Pulumi commands"
    echo "  --install-bash     Add source command to .bashrc for automatic loading"
    echo "  --install-zsh      Add source command to .zshrc for automatic loading"
    echo "  --install-all      Add source command to both .bashrc and .zshrc"
    echo
    echo "Example:"
    echo "  source ./pulumi_env.sh"
    echo "  source ./pulumi_env.sh --alias"
}

# Check if the script is being sourced
(return 0 2>/dev/null) && SOURCED=1 || SOURCED=0

if [ $SOURCED -eq 0 ]; then
    log_error "This script must be sourced, not executed."
    log_error "Please run: source $0"
    exit 1
fi

# Process command line arguments
CREATE_ALIASES=0
INSTALL_TO_BASHRC=0
INSTALL_TO_ZSHRC=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help)
            show_help
            return 0
            ;;
        -a|--alias)
            CREATE_ALIASES=1
            shift
            ;;
        --install-bash)
            INSTALL_TO_BASHRC=1
            shift
            ;;
        --install-zsh)
            INSTALL_TO_ZSHRC=1
            shift
            ;;
        --install-all)
            INSTALL_TO_BASHRC=1
            INSTALL_TO_ZSHRC=1
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            return 1
            ;;
    esac
done

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    log_error "Environment file not found: $ENV_FILE"
    log_error "Please run the Pulumi setup script first"
    return 1
fi

# Source the .env file
log "Loading Pulumi environment from $ENV_FILE"
source "$ENV_FILE"

# Validate required environment variables
if [ -z "$PULUMI_CONFIG_PASSPHRASE" ]; then
    log_error "PULUMI_CONFIG_PASSPHRASE is not set in $ENV_FILE"
    return 1
fi

if [ -z "$PULUMI_BACKEND_URL" ]; then
    log_error "PULUMI_BACKEND_URL is not set in $ENV_FILE"
    return 1
fi

# Export variables to ensure they are available
export PULUMI_CONFIG_PASSPHRASE
export PULUMI_BACKEND_URL

log "Pulumi environment variables loaded successfully:"
log "  Backend URL: $PULUMI_BACKEND_URL"
log "  Config passphrase: [set]"

# Create aliases if requested
if [ $CREATE_ALIASES -eq 1 ]; then
    log "Creating Pulumi aliases..."
    alias pup="pulumi up"
    alias ppr="pulumi preview"
    alias pst="pulumi stack"
    alias pcl="cd $PROJECT_ROOT/pulumi/cluster-setup"
    alias pcs="cd $PROJECT_ROOT/pulumi/core-services"
    alias pst="cd $PROJECT_ROOT/pulumi/storage"

    log "Aliases created:"
    log "  pup - Run pulumi up"
    log "  ppr - Run pulumi preview"
    log "  pst - Manage Pulumi stacks"
    log "  pcl - Change to cluster-setup directory"
    log "  pcs - Change to core-services directory"
    log "  pst - Change to storage directory"
fi

# Add to shell configuration files if requested
if [ $INSTALL_TO_BASHRC -eq 1 ]; then
    log "Adding source command to .bashrc..."

    # Check if already in .bashrc
    if grep -q "source $SCRIPT_DIR/pulumi_env.sh" ~/.bashrc; then
        log_warning "Source command already exists in .bashrc"
    else
        echo "" >> ~/.bashrc
        echo "# Pulumi environment loader" >> ~/.bashrc
        echo "source $SCRIPT_DIR/pulumi_env.sh" >> ~/.bashrc
        log "Added to ~/.bashrc - will be automatically loaded in new bash sessions"
    fi
fi

if [ $INSTALL_TO_ZSHRC -eq 1 ]; then
    log "Adding source command to .zshrc..."

    # Check if .zshrc exists, create if it doesn't
    if [ ! -f ~/.zshrc ]; then
        touch ~/.zshrc
        log "Created ~/.zshrc file"
    fi

    # Check if already in .zshrc
    if grep -q "source $SCRIPT_DIR/pulumi_env.sh" ~/.zshrc; then
        log_warning "Source command already exists in .zshrc"
    else
        echo "" >> ~/.zshrc
        echo "# Pulumi environment loader" >> ~/.zshrc
        echo "source $SCRIPT_DIR/pulumi_env.sh" >> ~/.zshrc
        log "Added to ~/.zshrc - will be automatically loaded in new zsh sessions"
    fi
fi

log "Done! Your Pulumi environment is ready to use."
