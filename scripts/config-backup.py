#!/usr/bin/env python3

import os
import subprocess
import shutil
import datetime
import logging
from git import Repo, GitCommandError

# --- Configuration ---
BACKUP_ROOT_DIR = os.getenv("BACKUP_ROOT_DIR", "/backups/config-backup")
KUBECTL_CONTEXT = os.getenv("KUBECTL_CONTEXT", "homelab-cluster")
ANSIBLE_DIR = os.getenv("ANSIBLE_DIR", "/home/sprime01/homelab/ansible")
PULUMI_DIR = os.getenv("PULUMI_DIR", "/home/sprime01/homelab/homelab-infra/pulumi")
CUSTOM_CONFIG_PATHS = os.getenv("CUSTOM_CONFIG_PATHS", "/etc/homelab,/home/sprime01/.config").split(',')
GIT_REMOTE_URL = os.getenv("GIT_REMOTE_URL", "git@github.com:username/config-backup.git")
TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

# --- Helper Functions ---
def run_command(command, cwd=None):
    """Runs a shell command and logs the output."""
    logging.info(f"Running command: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=cwd,
            check=True,
            text=True
        )
        if result.stdout:
            logging.info(f"Command stdout:\n{result.stdout.strip()}")
        if result.stderr:
            logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        logging.error(f"Command failed with exit code {e.returncode}: {' '.join(command)}")
        logging.error(f"Error output:\n{e.stderr.strip()}")
        raise

def ensure_dir(path):
    """Ensures a directory exists."""
    if not os.path.exists(path):
        logging.info(f"Creating directory: {path}")
        os.makedirs(path, exist_ok=True)

def backup_kubernetes_resources(backup_dir):
    """Backs up Kubernetes resources to YAML files."""
    resources = ["deployments", "services", "configmaps"]
    resource_dir = os.path.join(backup_dir, "kubernetes")
    ensure_dir(resource_dir)

    for resource in resources:
        output_file = os.path.join(resource_dir, f"{resource}.yaml")
        logging.info(f"Backing up Kubernetes {resource} to {output_file}...")
        try:
            run_command([
                "kubectl", "get", resource, "--all-namespaces",
                "--context", KUBECTL_CONTEXT,
                "-o", "yaml"
            ], cwd=resource_dir)
            with open(output_file, "w") as f:
                f.write(output_file)
        except Exception as e:
            logging.warning(f"Failed to backup Kubernetes {resource}: {e}")

def backup_directory(source_dir, target_dir):
    """Copies a directory to the target location."""
    if not os.path.exists(source_dir):
        logging.warning(f"Source directory does not exist: {source_dir}")
        return
    logging.info(f"Backing up directory {source_dir} to {target_dir}...")
    shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)

def backup_custom_configs(backup_dir):
    """Backs up custom configuration files."""
    config_dir = os.path.join(backup_dir, "custom-configs")
    ensure_dir(config_dir)

    for path in CUSTOM_CONFIG_PATHS:
        if os.path.exists(path):
            target_path = os.path.join(config_dir, os.path.basename(path))
            backup_directory(path, target_path)
        else:
            logging.warning(f"Custom config path does not exist: {path}")

def initialize_git_repo(repo_dir):
    """Initializes a Git repository if not already initialized."""
    try:
        if not os.path.exists(os.path.join(repo_dir, ".git")):
            logging.info(f"Initializing Git repository in {repo_dir}...")
            repo = Repo.init(repo_dir)
            repo.create_remote("origin", GIT_REMOTE_URL)
        else:
            repo = Repo(repo_dir)
        return repo
    except GitCommandError as e:
        logging.error(f"Git error: {e}")
        raise

def commit_and_push_changes(repo, message):
    """Commits and pushes changes to the remote Git repository."""
    try:
        repo.git.add(all=True)
        if repo.is_dirty():
            logging.info("Committing changes...")
            repo.index.commit(message)
            logging.info("Pushing changes to remote repository...")
            repo.git.push("origin", "main")
        else:
            logging.info("No changes to commit.")
    except GitCommandError as e:
        logging.error(f"Git error during commit/push: {e}")
        raise

# --- Main Execution ---
def main():
    logging.info("Starting Configuration Backup Process...")
    start_time = datetime.datetime.now()
    timestamp = start_time.strftime(TIMESTAMP_FORMAT)

    # Ensure backup root directory exists
    ensure_dir(BACKUP_ROOT_DIR)

    # Backup Kubernetes resources
    backup_kubernetes_resources(BACKUP_ROOT_DIR)

    # Backup Ansible and Pulumi directories
    backup_directory(ANSIBLE_DIR, os.path.join(BACKUP_ROOT_DIR, "ansible"))
    backup_directory(PULUMI_DIR, os.path.join(BACKUP_ROOT_DIR, "pulumi"))

    # Backup custom configuration files
    backup_custom_configs(BACKUP_ROOT_DIR)

    # Initialize Git repository and commit changes
    repo = initialize_git_repo(BACKUP_ROOT_DIR)
    commit_message = f"Configuration backup on {timestamp}"
    commit_and_push_changes(repo, commit_message)

    # Report completion
    end_time = datetime.datetime.now()
    duration = end_time - start_time
    logging.info(f"Configuration backup completed in {duration}.")

if __name__ == "__main__":
    main()
