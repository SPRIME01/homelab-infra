#!/usr/bin/env bash
# This script wraps sudo commands for tests to handle permission issues

set -e

# If we're testing, we use a different approach for directory permissions
if [ -n "$ANSIBLE_TEST_MODE" ]; then
  # Skip sudo and run the command directly
  "$@"
else
  # Use real sudo
  sudo "$@"
fi
