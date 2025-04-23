# GitHub Copilot Prompts for Homelab Infrastructure

This guide provides a collection of example prompts for GitHub Copilot, designed to help generate infrastructure code for a typical homelab environment. These prompts cover common tools like Ansible, Pulumi (TypeScript), Shell scripting, and Kubernetes manifests.

**Tips for Effective Prompting:**

*   **Be Specific:** Clearly state the tool, language, desired resource, and key configurations.
*   **Provide Context:** Mention existing files, variables, or desired patterns if relevant.
*   **Iterate:** Start with a basic prompt and refine it based on Copilot's suggestions. Ask Copilot to modify its own output.
*   **Review and Verify:** Always review the generated code for correctness, security, and adherence to best practices before applying it.

---

## 1. Ansible Playbooks and Roles

Prompts for generating Ansible code to configure servers and services.

**Example Prompts:**

1.  **Prompt:** `Create an Ansible playbook to install and configure Nginx as a reverse proxy on Debian-based systems. Include tasks for installation, basic configuration (proxying to localhost:8080), enabling the service, and opening the firewall port.`
    *   **Generates:** A complete Ansible playbook (`.yml`) file.
    *   **Customization:** Change the backend port (`localhost:8080`), specify a different OS family, add SSL configuration, or include specific Nginx directives.

2.  **Prompt:** `Generate an Ansible role named 'common' that performs essential setup tasks for all servers: update packages, install common utilities (htop, vim, curl, wget), set the timezone to 'UTC', and create a specific user 'homelab-admin' with sudo privileges.`
    *   **Generates:** The directory structure and basic files for an Ansible role (`tasks/main.yml`, `defaults/main.yml`, `vars/main.yml`).
    *   **Customization:** Modify the list of utilities, change the timezone, specify different user details, or add tasks for SSH key management.

3.  **Prompt:** `Write an Ansible task to configure UFW (Uncomplicated Firewall) to allow SSH (port 22), HTTP (port 80), and HTTPS (port 443) traffic, and deny all other incoming connections.`
    *   **Generates:** A snippet for `tasks/main.yml` using the `ufw` module.
    *   **Customization:** Add or remove ports, specify source IP addresses for rules, or configure logging.

4.  **Prompt:** `Create an Ansible handler that restarts the 'docker' service. Ensure it's triggered by changes in the Docker configuration file.`
    *   **Generates:** A handler definition for `handlers/main.yml`.
    *   **Customization:** Change the service name or add conditions for the restart.

5.  **Prompt:** `Generate an Ansible playbook task using the 'template' module to deploy a configuration file `/etc/myapp/config.toml` from a Jinja2 template `templates/myapp/config.toml.j2`. Include variables for `database_host` and `api_key`.`
    *   **Generates:** A task for `tasks/main.yml` and potentially a basic structure for the Jinja2 template.
    *   **Customization:** Define the specific variables needed in the template and provide their values in `vars` or `defaults`.

6.  **Prompt:** `Write an Ansible task to ensure a specific directory `/data/backups` exists with owner 'backupuser' and group 'backupgroup' and permissions '0770'.`
    *   **Generates:** A task using the `file` module.
    *   **Customization:** Change the path, owner, group, or permissions.

---

## 2. Pulumi TypeScript Components for Kubernetes

Prompts for generating Pulumi code (TypeScript) to define Kubernetes resources.

**Example Prompts:**

1.  **Prompt:** `Create a Pulumi TypeScript component for a Kubernetes Deployment. It should accept parameters for the image name, number of replicas, container port, and application labels. Use the '@pulumi/kubernetes' package.`
    *   **Generates:** A TypeScript class extending `pulumi.ComponentResource` defining a `k8s.apps.v1.Deployment`.
    *   **Customization:** Add parameters for resource requests/limits, environment variables, volume mounts, or readiness/liveness probes.

2.  **Prompt:** `Generate Pulumi TypeScript code to create a Kubernetes Namespace called 'monitoring'.`
    *   **Generates:** A simple Pulumi resource definition using `k8s.core.v1.Namespace`.
    *   **Customization:** Add labels or annotations to the namespace.

3.  **Prompt:** `Write Pulumi TypeScript code to define a Kubernetes Service of type LoadBalancer exposing a Deployment named 'my-app-deployment' on port 80, targeting container port 8080.`
    *   **Generates:** A `k8s.core.v1.Service` resource definition.
    *   **Customization:** Change the service type (e.g., `ClusterIP`, `NodePort`), specify different ports, add selectors, or configure external IPs.

4.  **Prompt:** `Create a Pulumi TypeScript component for a Kubernetes PersistentVolumeClaim (PVC). It should take 'storageClassName' and 'size' (e.g., '10Gi') as inputs.`
    *   **Generates:** A TypeScript class extending `pulumi.ComponentResource` defining a `k8s.core.v1.PersistentVolumeClaim`.
    *   **Customization:** Specify access modes (`ReadWriteOnce`, `ReadOnlyMany`, `ReadWriteMany`), add selectors, or define volume modes.

5.  **Prompt:** `Generate Pulumi TypeScript code to create a Kubernetes ConfigMap named 'app-config' with data key 'config.yaml' containing basic YAML content: `{"setting1": "value1", "log_level": "info"}`.`
    *   **Generates:** A `k8s.core.v1.ConfigMap` resource definition.
    *   **Customization:** Add more data keys, load content from external files, or set binary data.

6.  **Prompt:** `Write Pulumi TypeScript code to define a Kubernetes Secret named 'db-credentials' containing base64 encoded username and password.`
    *   **Generates:** A `k8s.core.v1.Secret` resource definition, often prompting you for the actual values (ensure you handle secrets securely, potentially using Pulumi config).
    *   **Customization:** Change secret type (e.g., `kubernetes.io/tls`), add more data keys, or manage secrets using external secret managers.

---

## 3. Shell Scripts for System Management

Prompts for generating shell scripts (Bash) for various automation and management tasks.

**Example Prompts:**

1.  **Prompt:** `Write a Bash script to check the disk usage of '/' and send an email alert to 'admin@example.com' if usage exceeds 90%. Include the current usage percentage in the email subject.`
    *   **Generates:** A Bash script using `df`, `awk`/`grep`, and `mail` (or `sendmail`).
    *   **Customization:** Change the threshold percentage, the monitored filesystem, the recipient email address, or the mail command used.

2.  **Prompt:** `Create a Bash script to perform a daily backup of a directory `/srv/appdata` to `/mnt/backups` using rsync. Ensure it preserves permissions and deletes files in the destination that no longer exist in the source. Log output to `/var/log/backup.log`.`
    *   **Generates:** A script using `rsync` with appropriate flags and output redirection.
    *   **Customization:** Modify source/destination paths, change rsync options (e.g., add compression, exclude files), or implement log rotation.

3.  **Prompt:** `Generate a Bash script that takes a domain name as an argument and uses 'curl' and 'jq' to check if its SSL certificate expires within the next 14 days. Print a warning message if it does.`
    *   **Generates:** A script using `openssl s_client` or `curl` with date calculations.
    *   **Customization:** Change the expiry threshold (14 days), add error handling for invalid domains, or integrate with a monitoring system.

4.  **Prompt:** `Write a Bash script to find all files larger than 100MB in `/var/log` modified more than 30 days ago and compress them using gzip.`
    *   **Generates:** A script using `find` with size and time criteria, potentially piping results to `gzip` via `xargs`.
    *   **Customization:** Adjust the size threshold, time criteria, target directory, or compression tool (`bzip2`, `xz`).

5.  **Prompt:** `Create a simple Bash script to restart a systemd service named 'my-app.service'. The script should check if the service is active before attempting a restart and log the action.`
    *   **Generates:** A script using `systemctl is-active`, `systemctl restart`, and `logger` or `echo`.
    *   **Customization:** Change the service name, add checks for service existence, or implement more robust error handling.

---

## 4. Kubernetes Manifests

Prompts for generating raw Kubernetes YAML manifests.

**Example Prompts:**

1.  **Prompt:** `Generate a Kubernetes YAML manifest for a Deployment named 'hello-world' using the 'nginx:alpine' image with 3 replicas.`
    *   **Generates:** A standard Kubernetes Deployment YAML.
    *   **Customization:** Change image, replicas, add labels, selectors, resource limits, or volume mounts.

2.  **Prompt:** `Create a Kubernetes YAML manifest for a Service named 'hello-world-svc' of type ClusterIP, exposing the 'hello-world' Deployment (selector app=hello-world) on port 80.`
    *   **Generates:** A Kubernetes Service YAML.
    *   **Customization:** Change service type, ports, selector, or add annotations (e.g., for ingress controllers).

3.  **Prompt:** `Generate a Kubernetes YAML manifest for a ConfigMap named 'nginx-config' containing an 'nginx.conf' key with basic Nginx configuration content.`
    *   **Generates:** A ConfigMap YAML with placeholder or example Nginx config.
    *   **Customization:** Provide specific Nginx configuration details.

4.  **Prompt:** `Create a Kubernetes YAML manifest for a PersistentVolumeClaim (PVC) named 'data-pvc' requesting 5Gi of storage using the 'standard' storage class with 'ReadWriteOnce' access mode.`
    *   **Generates:** A PVC YAML manifest.
    *   **Customization:** Change name, storage size, storage class name, or access mode.

5.  **Prompt:** `Generate a Kubernetes YAML manifest for a Namespace called 'staging'.`
    *   **Generates:** A simple Namespace YAML.
    *   **Customization:** Add labels or annotations.

6.  **Prompt:** `Create a Kubernetes YAML manifest for an Ingress resource named 'myapp-ingress' that routes traffic for 'myapp.homelab.local' to the 'myapp-svc' service on port 80.`
    *   **Generates:** An Ingress YAML (usually requires an Ingress controller like Nginx Ingress or Traefik to be running in the cluster).
    *   **Customization:** Specify TLS settings, path-based routing, rewrite rules, or annotations specific to your Ingress controller.

---

## 5. Infrastructure Testing Scripts

Prompts for generating scripts to test infrastructure components.

**Example Prompts:**

1.  **Prompt:** `Write a Python script using the 'requests' library to check if a web service running at 'http://service.homelab.local' returns a 200 OK status code. Print success or failure message.`
    *   **Generates:** A Python script performing an HTTP GET request.
    *   **Customization:** Change the URL, check for specific content in the response, add timeouts, or handle different status codes.

2.  **Prompt:** `Create a Bash script to test if a specific port (e.g., 6379) is open and listening on a remote host (e.g., 'redis.homelab.local') using 'nc' (netcat).`
    *   **Generates:** A script using `nc -z -v <host> <port>`.
    *   **Customization:** Change the host, port, or add retry logic.

3.  **Prompt:** `Generate a simple test using 'pytest' in Python to verify that an Ansible role 'myrole' successfully creates a specific configuration file '/etc/myconfig' on a target node (assuming appropriate test setup like Molecule or Docker).`
    *   **Generates:** A basic `pytest` test function structure, likely needing integration with a testing framework like Molecule or Testinfra.
    *   **Customization:** Specify the exact file path, check file content or permissions, requires setting up the test environment.

4.  **Prompt:** `Write a shell command using 'kubectl' to verify that exactly 3 pods are running for the deployment 'my-app-deployment' in the 'default' namespace.`
    *   **Generates:** A `kubectl get pods ...` command combined with filtering (`grep`, `wc -l`) or using JSONPath/custom-columns.
    *   **Customization:** Change deployment name, namespace, or expected replica count.

5.  **Prompt:** `Create a Bash script that uses 'curl' to query a Prometheus endpoint ('http://prometheus.homelab.local:9090/api/v1/query?query=up') and uses 'jq' to check if a specific job (e.g., 'node-exporter') has a value of 1 (indicating it's up).`
    *   **Generates:** A script using `curl` and `jq` to parse Prometheus API output.
    *   **Customization:** Change the Prometheus URL, the PromQL query, or the job name to check.
