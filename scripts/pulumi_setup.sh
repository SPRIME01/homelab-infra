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

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to handle errors
handle_error() {
    log_error "An error occurred during setup. Please check the output above."
    exit 1
}

# Function to cleanup partial installations
cleanup() {
    log "Cleaning up any partial installations..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

    # Remove any partial Pulumi project directories
    rm -rf "$PROJECT_ROOT/pulumi/cluster-setup" "$PROJECT_ROOT/pulumi/core-services" "$PROJECT_ROOT/pulumi/storage" 2>/dev/null || true

    log "Cleanup complete. You can now run the script again."
}

# Function to safely update Node.js
update_nodejs() {
    log "Removing old Node.js packages to prevent conflicts..."
    sudo apt-get remove -y nodejs nodejs-doc libnode-dev || true
    sudo apt-get autoremove -y

    log "Installing Node.js 18..."
    sudo apt-get install -y ca-certificates curl gnupg
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    NODE_MAJOR=18
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
    sudo apt-get update
    sudo apt-get install -y nodejs
}

# Function to generate a random secure passphrase
generate_passphrase() {
    # Generate a 32-character random string for the passphrase
    if command_exists openssl; then
        openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32
    else
        # Fallback if openssl is not available
        cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 32
    fi
}

# Set up error trap
trap handle_error ERR

# Check for --cleanup flag
if [ "$1" == "--cleanup" ]; then
    cleanup
    exit 0
fi

# Ensure running on WSL2 Ubuntu
if ! grep -q "microsoft" /proc/version; then
    log_warning "This script is designed for WSL2 Ubuntu. Proceed with caution."
fi

log "Starting Pulumi setup with TypeScript..."

# Update package list
log "Updating package list..."
sudo apt-get update

# Check Node.js version and update if needed
NODE_VERSION=$(node -v 2>/dev/null || echo "v0.0.0")
REQUIRED_NODE_VERSION="v18"
if [[ "$NODE_VERSION" < "$REQUIRED_NODE_VERSION" ]]; then
    log_warning "Node.js $NODE_VERSION is too old. Pulumi requires Node.js 18 or later."
    update_nodejs
else
    log "Node.js $NODE_VERSION is already installed."
fi

# Verify Node.js and npm installation
log "Verifying Node.js and npm installation..."
node -v
npm -v

# Install Pulumi CLI if not already installed
if ! command_exists pulumi; then
    log "Installing Pulumi CLI..."
    curl -fsSL https://get.pulumi.com | sh
    # Add Pulumi to PATH for current session
    source ~/.bashrc
    # Verify that the path is set correctly
    if ! command_exists pulumi; then
        log "Adding Pulumi to PATH..."
        export PATH="$PATH:$HOME/.pulumi/bin"
    fi
else
    log "Pulumi CLI is already installed."
fi

# Verify Pulumi installation
log "Verifying Pulumi installation..."
pulumi version

# Configure Pulumi to use local filesystem backend
log "Configuring Pulumi to use local filesystem backend..."
# Use a consistent backend location relative to the script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PULUMI_BACKEND_DIR="$PROJECT_ROOT/.pulumi-state"
mkdir -p "$PULUMI_BACKEND_DIR"
export PULUMI_BACKEND_URL="file://$PULUMI_BACKEND_DIR"

# Generate and set a secure passphrase for Pulumi config encryption
if [ -z "$PULUMI_CONFIG_PASSPHRASE" ]; then
    log "Generating a secure passphrase for Pulumi secrets..."
    PULUMI_PASSPHRASE=$(generate_passphrase)
    export PULUMI_CONFIG_PASSPHRASE="$PULUMI_PASSPHRASE"

    # Save passphrase to a .env file for future use
    ENV_FILE="$PROJECT_ROOT/.env"
    if [ -f "$ENV_FILE" ]; then
        # If .env exists, check if passphrase is already set
        if ! grep -q "PULUMI_CONFIG_PASSPHRASE=" "$ENV_FILE"; then
            echo "PULUMI_CONFIG_PASSPHRASE=\"$PULUMI_PASSPHRASE\"" >> "$ENV_FILE"
        fi
    else
        # Create new .env file with the passphrase
        echo "# Pulumi configuration" > "$ENV_FILE"
        echo "PULUMI_CONFIG_PASSPHRASE=\"$PULUMI_PASSPHRASE\"" >> "$ENV_FILE"
        echo "PULUMI_BACKEND_URL=\"file://$PULUMI_BACKEND_DIR\"" >> "$ENV_FILE"
    fi

    # Set proper permissions for .env file
    chmod 600 "$ENV_FILE"

    log "Passphrase saved to $ENV_FILE (keep this secure)"
    log "To use in future sessions, run: source $ENV_FILE"
fi

# Make the backend URL configuration permanent (still in .bashrc for convenience)
if ! grep -q "PULUMI_BACKEND_URL" ~/.bashrc; then
    echo "export PULUMI_BACKEND_URL=\"file://$PULUMI_BACKEND_DIR\"" >> ~/.bashrc
fi

# Set up proper directory structure for Pulumi projects
log "Setting up Pulumi project directory structure..."
mkdir -p "$PROJECT_ROOT/pulumi/"{cluster-setup,core-services,storage}

# Configure npm to avoid hanging
log "Configuring npm settings to improve performance..."
npm config set fetch-timeout 300000
npm config set fund false
npm config set audit false
npm config set progress false
npm config set legacy-peer-deps true

# Create minimal package.json files to avoid interactive prompts
create_minimal_package() {
    local dir=$1
    local name=$(basename "$dir")
    cat > "$dir/package.json" << EOF
{
  "name": "$name",
  "version": "0.1.0",
  "description": "Pulumi project for $name",
  "main": "index.js",
  "scripts": {
    "build": "tsc",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC"
}
EOF
}

# Initialize Pulumi TypeScript projects with minimal interaction
for PROJECT in cluster-setup core-services storage; do
    log "Initializing Pulumi TypeScript project: $PROJECT..."
    PROJECT_DIR="$PROJECT_ROOT/pulumi/$PROJECT"
    cd "$PROJECT_DIR"
    # Create directories
    mkdir -p src src/__tests__
    # Create minimal package.json to avoid prompts
    create_minimal_package "$PROJECT_DIR"
    # Create minimal tsconfig.json
    cat > "$PROJECT_DIR/tsconfig.json" << EOF
{
  "compilerOptions": {
    "target": "ES2018",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "sourceMap": true,
    "outDir": "bin",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true
  },
  "files": [
    "index.ts"
  ]
}
EOF
    # Create minimal Pulumi.yaml
    cat > "$PROJECT_DIR/Pulumi.yaml" << EOF
name: $PROJECT
runtime: nodejs
description: A Pulumi project for $PROJECT
EOF
    # Create minimal index.ts
    cat > "$PROJECT_DIR/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
export const message = "Hello, Pulumi!";
EOF
    # Install dependencies with legacy-peer-deps to avoid compatibility issues
    log "Installing dependencies for $PROJECT (this may take a while)..."
    npm install --save @pulumi/pulumi --no-fund --no-audit --prefer-offline --no-progress --legacy-peer-deps

    # Install additional dependencies separately to avoid hanging
    log "Installing additional dependencies for $PROJECT..."
    npm install --save @pulumi/kubernetes --no-fund --no-audit --prefer-offline --no-progress --legacy-peer-deps
    npm install --save @pulumi/random @pulumi/command --no-fund --no-audit --prefer-offline --no-progress --legacy-peer-deps

    # Create Pulumi stack if it doesn't exist
    if ! pulumi stack ls 2>/dev/null | grep -q "dev"; then
        log "Creating Pulumi stack 'dev' for $PROJECT..."
        # Use the already exported PULUMI_CONFIG_PASSPHRASE
        pulumi stack init dev --non-interactive
    fi

    # Add a brief pause between projects
    sleep 2
done

log "Pulumi TypeScript project setup complete!"
log "Your Pulumi projects are located at: $PROJECT_ROOT/pulumi"
log "To start working with a project, navigate to one of the project directories and run 'pulumi up'"

log "Remember to edit your Pulumi.yaml and index.ts files to configure your infrastructure!"

log "If you encounter issues, you can run this script with the --cleanup flag to remove partial installations:"
log "  $0 --cleanup"
