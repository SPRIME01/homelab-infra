#!/bin/bash
# Setup a dedicated testing environment with Docker or Vagrant
# This isolates tests from your system

set -e

# Create test container with proper permissions
docker run -d --name k3s-test \
  --privileged \
  -v "$(pwd):/code" \
  ubuntu:22.04

# Install dependencies in container
docker exec k3s-test bash -c "
  apt-get update &&
  apt-get install -y python3 python3-pip sudo systemd &&
  pip3 install ansible ansible-lint
"

# Run tests in container
docker exec k3s-test bash -c "cd /code && ansible-playbook tests/test.yml"

# Cleanup
docker stop k3s-test
docker rm k3s-test
