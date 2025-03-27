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
    log_error "An error occurred during Jest setup. Please check the output above."
    exit 1
}

# Set up error trap
trap handle_error ERR

# Function to setup Jest testing for a Pulumi TypeScript project
setup_jest() {
    local project_dir=$1

    if [ -z "$project_dir" ]; then
        log_error "Project directory not specified"
        exit 1
    fi

    if [ ! -d "$project_dir" ]; then
        log_error "Project directory not found: $project_dir"
        exit 1
    fi

    log "Setting up Jest testing environment for: $project_dir"

    # Navigate to the project directory
    cd "$project_dir"

    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        log_error "package.json not found in $project_dir"
        exit 1
    fi

    # Install Jest dependencies
    log "Installing Jest dependencies..."
    npm install --save-dev jest @jest/globals @types/jest ts-jest

    # Create Jest config
    log "Creating Jest configuration..."
    cat > jest.config.js << 'EOF'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
EOF

    # Update tsconfig.json to include Jest types
    log "Updating TypeScript configuration..."
    if [ -f "tsconfig.json" ]; then
        # Check if types array exists
        if grep -q '"types"' tsconfig.json; then
            # Add jest to types if not already present
            if ! grep -q '"jest"' tsconfig.json; then
                # This is a simple sed that works for most cases, but might need manual adjustment
                sed -i 's/"types": \[\(".*"\)\]/"types": [\1, "jest"]/' tsconfig.json
            fi
        else
            # If no types array, we need to add one
            sed -i '/"compilerOptions": {/a \    "types": ["node", "jest"],' tsconfig.json
        fi
    else
        # Create tsconfig.json if it doesn't exist
        cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2018",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitThis": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "bin",
    "sourceMap": true,
    "esModuleInterop": true,
    "types": ["node", "jest"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.spec.ts"]
}
EOF
    fi

    # Update package.json to include test scripts
    log "Adding test scripts to package.json..."
    # This is a careful approach to modify package.json without breaking its structure
    # Extract scripts section
    if grep -q '"scripts"' package.json; then
        # Check if test script already exists
        if ! grep -q '"test":' package.json; then
            # Find the line with "scripts": {
            scripts_line=$(grep -n '"scripts"' package.json | cut -d: -f1)
            # Find the closing brace for scripts
            next_brace_line=$((scripts_line + 1))
            # Insert test scripts before the closing brace
            sed -i "${next_brace_line}i \    \"test\": \"jest\",\n    \"test:watch\": \"jest --watch\"," package.json
        fi
    else
        # If no scripts section exists, add one after the main field
        if grep -q '"main":' package.json; then
            main_line=$(grep -n '"main":' package.json | cut -d: -f1)
            next_line=$((main_line + 1))
            sed -i "${next_line}i \  \"scripts\": {\n    \"test\": \"jest\",\n    \"test:watch\": \"jest --watch\"\n  }," package.json
        else
            # Last resort, add after the name or version
            first_field_line=$(grep -n '"name\|"version"' package.json | head -1 | cut -d: -f1)
            next_line=$((first_field_line + 1))
            sed -i "${next_line}i \  \"scripts\": {\n    \"test\": \"jest\",\n    \"test:watch\": \"jest --watch\"\n  }," package.json
        fi
    fi

    # Create test directory if it doesn't exist
    log "Creating test directory structure..."
    mkdir -p src/__tests__

    # Create a sample test file if no tests exist yet
    if [ ! -f "src/__tests__/sample.test.ts" ] && [ "$(find src/__tests__ -name "*.test.ts" | wc -l)" -eq 0 ]; then
        log "Creating a sample test file..."
        cat > src/__tests__/sample.test.ts << 'EOF'
import { describe, test, expect } from '@jest/globals';

describe('Sample test', () => {
    test('adds 1 + 2 to equal 3', () => {
        expect(1 + 2).toBe(3);
    });
});
EOF
    fi

    log "Jest testing environment setup complete for: $project_dir"
    log "You can now run tests with: npm test"
}

# Process command line arguments
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo "Usage: $0 [project_directory]"
    echo ""
    echo "If no project directory is specified, it will attempt to setup Jest"
    echo "for all Pulumi projects in the homelab-infra/pulumi directory."
    exit 0
fi

# If a specific directory is provided, set up Jest just for that directory
if [ -n "$1" ]; then
    setup_jest "$1"
    exit 0
fi

# Otherwise, set up Jest for all Pulumi projects
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PULUMI_DIR="$PROJECT_ROOT/pulumi"

if [ ! -d "$PULUMI_DIR" ]; then
    log_error "Pulumi directory not found: $PULUMI_DIR"
    exit 1
fi

# Set up Jest for each Pulumi project
log "Setting up Jest for all Pulumi projects..."
for project in "$PULUMI_DIR"/*; do
    if [ -d "$project" ]; then
        setup_jest "$project"
    fi
done

log "Jest setup complete for all Pulumi projects!"
