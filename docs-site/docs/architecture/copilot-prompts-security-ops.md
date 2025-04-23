# GitHub Copilot Prompts for Homelab Security & Operations

This guide provides example prompts for GitHub Copilot to assist with common security and operations tasks in a homelab environment.

## 1. Authentication and Authorization Configurations

Prompts for setting up user authentication, access control, and secrets management.

1.  **Generate Nginx config for basic authentication:**
    *   **Prompt:** `// Nginx location block for '/secure' requiring basic authentication using the password file '/etc/nginx/htpasswd'.`
    *   **Explanation:** Creates an Nginx configuration snippet that password-protects a specific URL path using HTTP Basic Auth. Requires a separate `htpasswd` file.
    *   **Customization:** Change the location path (`/secure`), the `auth_basic` realm message, and the path to the `htpasswd` file.

2.  **Generate Nginx config for OAuth2/OIDC proxying (using `oauth2-proxy`):**
    *   **Prompt:** `// Nginx location block for '/' that proxies authentication checks to an oauth2-proxy instance running at http://127.0.0.1:4180. Forward original request headers.`
    *   **Explanation:** Sets up Nginx to delegate authentication to an external `oauth2-proxy` service, enabling SSO with providers like Google, GitHub, Keycloak, etc. Assumes `oauth2-proxy` is configured separately.
    *   **Customization:** Change the `oauth2-proxy` upstream address/port, configure header forwarding (`proxy_set_header`), and adjust error handling for authentication failures.

3.  **Create a Docker Compose snippet for Authelia:**
    *   **Prompt:** `// Docker Compose service definition for Authelia using image authelia/authelia:latest. Mount configuration from ./authelia/configuration.yml and use a Redis instance at 'redis:6379' for session storage.`
    *   **Explanation:** Generates a Docker Compose service block for deploying Authelia, a popular open-source authentication portal often used with reverse proxies.
    *   **Customization:** Adjust image tag, configuration file path, Redis hostname/port, network settings, and potentially add labels for Traefik/Nginx Proxy Manager integration.

4.  **Generate Authelia `configuration.yml` snippet for file-based users:**
    *   **Prompt:** `// Authelia configuration.yml snippet for the 'authentication_backend' section using the 'file' provider. Point to './authelia/users_database.yml' and use bcrypt password hashing.`
    *   **Explanation:** Configures Authelia to use a local YAML file for storing user credentials.
    *   **Customization:** Change the path to the user database file, adjust password hashing parameters (iterations, salt length). *Note: Consider LDAP or OIDC for more robust user management.*

5.  **Generate SSH `sshd_config` hardening options:**
    *   **Prompt:** `// Generate recommended sshd_config settings to harden SSH access: Disable root login, disable password authentication, permit only specific users/groups, change default port to 2222.`
    *   **Explanation:** Provides common security settings for the SSH daemon configuration file to reduce attack surface.
    *   **Customization:** Change the `Port`, specify allowed `AllowUsers` or `AllowGroups`, adjust `MaxAuthTries`. *Remember to configure SSH keys before disabling password authentication.*

6.  **Create a Python script using `hvac` to read a secret from HashiCorp Vault:**
    *   **Prompt:** `// Python script using the hvac library to connect to Vault at 'http://vault.local:8200' using token authentication (token from 'VAULT_TOKEN' env var). Read the secret 'database/credentials' from the kv-v2 engine and print the 'password' field.`
    *   **Explanation:** Demonstrates programmatic access to secrets stored securely in HashiCorp Vault.
    *   **Customization:** Change Vault address, authentication method (token, AppRole, etc.), secret path, KV engine version, and the specific secret field to retrieve.

7.  **Generate `.env` file example for service credentials:**
    *   **Prompt:** `// Generate an example .env file structure for a web application needing database credentials (DB_USER, DB_PASSWORD, DB_HOST) and an API key (EXTERNAL_API_KEY).`
    *   **Explanation:** Creates a template `.env` file commonly used by applications (especially in Docker setups) to load configuration from environment variables.
    *   **Customization:** Add or remove variables specific to your application's needs. *Remember to add `.env` to `.gitignore`.*

## 2. Network Security and Encryption

Prompts for configuring firewalls, VPNs, reverse proxies with TLS, and network segmentation.

1.  **Generate `ufw` commands to allow specific ports:**
    *   **Prompt:** `// Generate ufw commands to allow incoming traffic on ports 80 (HTTP), 443 (HTTPS), and 2222 (SSH) from any source.`
    *   **Explanation:** Creates commands for the Uncomplicated Firewall (ufw) tool, common on Ubuntu, to open necessary ports.
    *   **Customization:** Change port numbers, protocols (tcp/udp), and specify source IP addresses/subnets for stricter rules (e.g., `ufw allow from 192.168.1.0/24 to any port 2222 proto tcp`).

2.  **Generate `iptables` rules for basic NAT/port forwarding:**
    *   **Prompt:** `// Generate iptables rules to forward incoming traffic on host port 8443 to internal container IP 172.17.0.5 port 443.`
    *   **Explanation:** Creates Linux `iptables` commands for Network Address Translation (NAT), specifically port forwarding, often needed when not using a reverse proxy.
    *   **Customization:** Change the host port (`--dport`), destination IP (`--to-destination`), and destination port. Ensure IP forwarding is enabled (`sysctl net.ipv4.ip_forward=1`).

3.  **Create Docker Compose snippet for Traefik with Let's Encrypt:**
    *   **Prompt:** `// Docker Compose service definition for Traefik v2 proxy. Enable Docker provider, expose ports 80/443. Configure Let's Encrypt staging resolver using http challenge, storing certs in './letsencrypt' volume. Use email 'myemail@example.com'.`
    *   **Explanation:** Sets up Traefik as a reverse proxy and container router, automatically obtaining TLS certificates from Let's Encrypt (using the staging environment initially).
    *   **Customization:** Change Let's Encrypt email, challenge type (`httpChallenge`, `tlsChallenge`, `dnsChallenge`), volume path, and switch to the production resolver (`acme-v02.api.letsencrypt.org/directory`) after testing. Add labels to target containers for Traefik routing.

4.  **Generate Nginx config for reverse proxy with TLS termination:**
    *   **Prompt:** `// Nginx server block listening on port 443 for 'myapp.homelab.local'. Enable SSL/TLS using certificate '/etc/nginx/ssl/myapp.crt' and key '/etc/nginx/ssl/myapp.key'. Proxy requests to backend service at 'http://127.0.0.1:8080'. Include recommended SSL settings.`
    *   **Explanation:** Configures Nginx to handle incoming HTTPS traffic, decrypt it, and forward plain HTTP requests to a backend application. Requires manually obtained TLS certificates.
    *   **Customization:** Change `server_name`, certificate/key paths, `proxy_pass` upstream address, and adjust SSL/TLS protocols/ciphers as needed. Add an HTTP-to-HTTPS redirect block.

5.  **Generate WireGuard server configuration (`wg0.conf`):**
    *   **Prompt:** `// Generate a basic WireGuard server configuration file (wg0.conf). Set private key (use placeholder 'SERVER_PRIVATE_KEY'), listen port 51820, and assign IP address 10.0.10.1/24 to the interface. Include placeholder peer sections.`
    *   **Explanation:** Creates the server-side configuration file for a WireGuard VPN tunnel. Requires generating actual keys using `wg genkey`.
    *   **Customization:** Replace placeholder keys with actual keys (`wg genkey | tee privatekey | wg pubkey > publickey`), adjust `ListenPort`, `Address` range, and add `[Peer]` sections for each client with their public key and allowed IPs. Add `PostUp`/`PostDown` rules for firewall/NAT configuration.

6.  **Generate WireGuard client configuration:**
    *   **Prompt:** `// Generate a WireGuard client configuration file. Set private key (placeholder 'CLIENT_PRIVATE_KEY'), assign client IP 10.0.10.2/32. Define peer section for server public key (placeholder 'SERVER_PUBLIC_KEY'), endpoint 'vpn.homelab.local:51820', and set AllowedIPs to 0.0.0.0/0 for full tunneling.`
    *   **Explanation:** Creates a client-side configuration file to connect to the WireGuard server.
    *   **Customization:** Replace placeholder keys, adjust client `Address`, server `PublicKey`, `Endpoint` address/port, and `AllowedIPs` (e.g., `10.0.10.0/24, 192.168.1.0/24` for split tunneling).

## 3. Monitoring and Alerting Setup

Prompts for configuring monitoring tools like Prometheus, Grafana, and setting up alerts.

1.  **Generate Prometheus `prometheus.yml` scrape config for node_exporter:**
    *   **Prompt:** `// Prometheus scrape_configs snippet in prometheus.yml to scrape metrics from node_exporter instances discovered via static_configs at targets ['node1.local:9100', 'node2.local:9100']. Set job_name to 'node_exporter'.`
    *   **Explanation:** Configures Prometheus to collect metrics (CPU, memory, disk, network) from hosts running the `node_exporter` agent.
    *   **Customization:** Change `job_name`, target addresses/ports, add labels, or use other service discovery methods (`dns_sd_configs`, `file_sd_configs`, `docker_sd_configs`).

2.  **Generate Prometheus `prometheus.yml` scrape config for Docker container metrics (cAdvisor):**
    *   **Prompt:** `// Prometheus scrape_configs snippet to scrape metrics from cAdvisor running at 'cadvisor:8080'. Set job_name to 'cadvisor'.`
    *   **Explanation:** Configures Prometheus to collect resource usage metrics for Docker containers via cAdvisor.
    *   **Customization:** Change `job_name`, cAdvisor target address/port.

3.  **Generate Prometheus alerting rule for high CPU usage:**
    *   **Prompt:** `// Prometheus alerting rule (YAML format for rule file): Alert named 'HostHighCpuLoad' if node_load15 (from node_exporter) is greater than number of CPUs * 2 for 5 minutes. Add summary and description annotations.`
    *   **Explanation:** Creates a rule definition file that Prometheus uses (often in conjunction with Alertmanager) to trigger alerts based on metric conditions. Requires `node_exporter` metrics.
    *   **Customization:** Adjust the expression (metric name, condition, threshold calculation), `for` duration, alert name, labels (`severity`, `instance`), and annotation content.

4.  **Generate Docker Compose snippet for Prometheus and Grafana:**
    *   **Prompt:** `// Docker Compose services for Prometheus and Grafana. Mount prometheus.yml config for Prometheus. Mount Grafana provisioning directory './grafana/provisioning'. Expose Grafana on port 3000.`
    *   **Explanation:** Sets up the core monitoring stack (Prometheus for data collection, Grafana for visualization) using Docker Compose.
    *   **Customization:** Adjust image tags, volume paths, network configuration, and Grafana provisioning setup (datasources, dashboards).

5.  **Generate Grafana datasource provisioning YAML for Prometheus:**
    *   **Prompt:** `// Grafana datasource provisioning YAML (datasources.yml): Define a Prometheus datasource named 'Prometheus-Homelab' pointing to 'http://prometheus:9090'. Set as default.`
    *   **Explanation:** Creates a configuration file that Grafana uses on startup to automatically configure its connection to the Prometheus backend. Place this in the Grafana provisioning directory.
    *   **Customization:** Change the datasource `name`, `uid`, Prometheus `url`, and access mode (`proxy`, `direct`).

6.  **Generate Docker Compose snippet for Alertmanager:**
    *   **Prompt:** `// Docker Compose service definition for Alertmanager. Mount configuration file './alertmanager/alertmanager.yml'. Expose port 9093.`
    *   **Explanation:** Adds the Alertmanager component, which receives alerts from Prometheus, deduplicates/groups them, and routes them to notification channels.
    *   **Customization:** Adjust image tag, volume path, port mapping. Requires configuring `alertmanager.yml` and linking Prometheus to it.

7.  **Generate Alertmanager `alertmanager.yml` config for Discord notifications:**
    *   **Prompt:** `// Alertmanager configuration snippet (alertmanager.yml): Define a receiver 'discord-notifications' using 'discord_configs' to send alerts to a Discord webhook URL from 'DISCORD_WEBHOOK_URL' env var. Set the default route to use this receiver.`
    *   **Explanation:** Configures Alertmanager to send notifications via a Discord webhook.
    *   **Customization:** Change receiver name, webhook URL source (or hardcode it, though env var is better), customize message templates, and define more complex routing based on alert labels.

## 4. Backup and Recovery Scripts

Prompts for creating scripts to back up data, configurations, and test recovery.

1.  **Generate a shell script using `rsync` for local directory backup:**
    *   **Prompt:** `// Shell script using rsync to back up '/srv/data' directory to '/mnt/backup/data_backup'. Use archive mode, verbose output, preserve permissions, delete extraneous files from destination, and exclude '*.tmp' files.`
    *   **Explanation:** Creates a script for efficient local backups, copying only changed files.
    *   **Customization:** Change source/destination paths, add/remove `rsync` options (e.g., `--compress`, `--bwlimit`), modify exclude patterns.

2.  **Generate a shell script to back up Docker volumes:**
    *   **Prompt:** `// Shell script to back up a Docker volume named 'my_app_data'. Stop the associated container 'my_app', run a temporary container to tar the volume contents to '/mnt/backup/my_app_data.tar.gz', and restart the 'my_app' container.`
    *   **Explanation:** Provides a common pattern for backing up persistent data stored in Docker volumes, ensuring data consistency by stopping the container during backup.
    *   **Customization:** Change volume name, container name, backup destination path, compression format. Consider using volume snapshot features if available on the filesystem.

3.  **Generate a shell script using `restic` to back up to Backblaze B2:**
    *   **Prompt:** `// Shell script using restic: Initialize a restic repository on Backblaze B2 (bucket 'my-homelab-restic-repo', path '/data'). Set B2_ACCOUNT_ID and B2_ACCOUNT_KEY environment variables. Perform a backup of '/srv/important_data'. Prune old snapshots keeping last 7 daily, 4 weekly, 6 monthly.`
    *   **Explanation:** Creates a script using `restic`, a modern backup tool supporting encryption, deduplication, and various backends like B2. Assumes `restic` is installed and B2 credentials are set as environment variables.
    *   **Customization:** Change B2 bucket/path, source directory path (`/srv/important_data`), repository password handling (e.g., `--password-file`), prune policy (`--keep-daily`, etc.).

4.  **Generate a Python script to dump a PostgreSQL database:**
    *   **Prompt:** `// Python script using subprocess module to run 'pg_dump'. Connect to database 'mydb' on host 'db.local' as user 'backup_user' (password from 'PGPASSWORD' env var). Dump to a timestamped SQL file in '/mnt/backup/postgres'.`
    *   **Explanation:** Automates the process of creating a logical backup of a PostgreSQL database.
    *   **Customization:** Change database name, host, user, backup directory, dump format (`-F c` for custom format), and password handling.

5.  **Generate a shell script to test restoring a `restic` backup:**
    *   **Prompt:** `// Shell script using restic: Set B2 credentials and repository info. Mount the latest restic snapshot to '/mnt/restic_restore_test'. Check if a specific file 'critical_config.txt' exists in the mounted backup. Unmount afterwards.`
    *   **Explanation:** Outlines a basic procedure to verify backup integrity by mounting the backup and checking for a known file. *This is a simplified check; full restore tests are recommended.*
    *   **Customization:** Change repository info, mount point, the file/directory to check, and potentially add checksum verification.

## 5. Maintenance and Health Check Procedures

Prompts for scripts and configurations related to routine maintenance and system health checks.

1.  **Generate a shell script for system updates (APT-based):**
    *   **Prompt:** `// Shell script for Ubuntu/Debian: Run 'apt update', then 'apt upgrade -y', then 'apt autoremove -y'. Log output to '/var/log/system_updates.log'.`
    *   **Explanation:** Basic script to keep an APT-based Linux system up-to-date. *Caution: Unattended upgrades can sometimes cause issues; run manually or with careful monitoring.*
    *   **Customization:** Add error checking, specific package handling, or use tools like `unattended-upgrades` for more robust automation.

2.  **Generate a Docker Compose command to update all running services:**
    *   **Prompt:** `// Shell command sequence using Docker Compose: Navigate to '/opt/docker-compose-app', pull fresh images ('docker-compose pull'), then recreate containers ('docker-compose up -d --remove-orphans').`
    *   **Explanation:** Common sequence to update applications deployed via Docker Compose by pulling the latest image tags specified in the `docker-compose.yml` file.
    *   **Customization:** Change the path to the Docker Compose project directory. Consider tools like Watchtower for fully automated container updates (use with caution).

3.  **Generate a Python script to check disk space usage:**
    *   **Prompt:** `// Python script using shutil.disk_usage: Check the percentage of used disk space for '/'. If usage exceeds 90%, print a critical alert message to stderr.`
    *   **Explanation:** Simple script to monitor disk space, often run periodically via cron/systemd timer.
    *   **Customization:** Change the mount point to check, the threshold percentage, and the alerting mechanism (e.g., send email, call webhook).

4.  **Generate a shell script to check TLS certificate expiry:**
    *   **Prompt:** `// Shell script using openssl: Check the expiration date of the TLS certificate for 'myapp.homelab.local:443'. Print a warning if it expires within the next 14 days.`
    *   **Explanation:** Checks the validity period of a specific TLS certificate.
    *   **Customization:** Change the hostname/port, the warning threshold (days), and output formatting/alerting. Tools like Prometheus `blackbox_exporter` can monitor this continuously.

5.  **Generate Ansible playbook task to check service status:**
    *   **Prompt:** `// Ansible playbook task: Use the 'systemd' module to check if the 'nginx.service' is active and enabled on target host 'webserver'. Fail if not running.`
    *   **Explanation:** Uses Ansible to verify that a critical service is running on a remote host.
    *   **Customization:** Change the `name` of the service, the target `hosts`, and the desired `state` (`started`, `stopped`, `restarted`).

6.  **Generate a basic health check endpoint in a Python Flask app:**
    *   **Prompt:** `// Add a Flask route '/healthz' that returns a JSON response {'status': 'ok'} and HTTP status code 200.`
    *   **Explanation:** Creates a simple endpoint often used by load balancers, container orchestrators (like Kubernetes), or monitoring systems to check if the application is running and responsive.
    *   **Customization:** Add more complex checks within the health endpoint (e.g., database connectivity, dependency status) and return different statuses/codes accordingly.
