# Homelab Troubleshooting Guide

This guide provides a structured approach to troubleshooting common issues within the homelab environment, organized by subsystem. It serves as a practical reference during incident response.

---

## 1. Infrastructure (Host OS, Hardware, Virtualization)

### Common Issues & Symptoms

*   **Host Unreachable:** Cannot SSH, ping, or access management UI (e.g., Proxmox).
*   **High CPU/RAM Usage:** Sluggish performance, services unresponsive, OOM killer active.
*   **Disk Space Full:** Services failing to write data, errors related to disk space (`No space left on device`).
*   **Hardware Errors:** Kernel messages about hardware failures (disk I/O errors, memory errors), unexpected reboots.
*   **VM/Hypervisor Issues:** VMs failing to start/stop, slow VM performance, migration failures (Proxmox).

### Diagnostic Approaches & Commands

*   **Check Physical Layer:** Verify power, network cable connections, link lights.
*   **Console Access:** Use physical console or IPMI/iDRAC/ILO if available.
*   **Basic Connectivity:**
    *   `ping <host_ip>` (from another machine)
    *   `ip addr` or `ip a` (on host, check IP configuration)
    *   `ip route` (check routing table)
    *   `traceroute <destination_ip>` (check network path)
*   **Resource Usage:**
    *   `htop` or `top` (real-time CPU/RAM usage per process)
    *   `free -h` (memory usage summary)
    *   `df -h` (disk filesystem usage)
    *   `du -sh /path/*` (disk usage per directory)
    *   `iotop` (disk I/O per process)
    *   `vmstat 1` (system-wide resource statistics)
*   **System Logs:**
    *   `dmesg` or `journalctl -k` (kernel ring buffer, hardware messages)
    *   `journalctl -u <service_name>` (logs for a specific systemd service)
    *   `journalctl -f` (follow system logs)
    *   `/var/log/syslog`, `/var/log/messages` (general system logs)
*   **Hardware Diagnostics:**
    *   `smartctl -a /dev/sdX` (check disk health via SMART)
    *   `memtest86+` (bootable memory test)
*   **Proxmox Specific:**
    *   `pveversion -v` (check PVE versions)
    *   `qm status <vmid>` (check VM status)
    *   `pct status <vmid>` (check container status)
    *   `pvecm status` (check cluster status)
    *   Logs in `/var/log/pve/`, `/var/log/qemu-server/`, `/var/log/lxc/`

### Resolution Steps

*   **Host Unreachable:**
    *   Check physical layer.
    *   Verify IP configuration (`ip a`). Check for conflicts.
    *   Check firewall rules (`ufw status`, `iptables -L`).
    *   Check SSH service (`systemctl status sshd`). Restart if needed (`systemctl restart sshd`). Check `sshd_config`.
    *   Check management UI service (e.g., `systemctl status pveproxy`).
*   **High CPU/RAM Usage:**
    *   Identify offending process using `htop`.
    *   Analyze process logs or behavior. Is it stuck in a loop? Leaking memory?
    *   Consider resource limits (Docker `resources`, K8s `limits`, systemd slices).
    *   Restart the problematic service/container/VM.
    *   If persistent, investigate application configuration or bugs. Consider upgrading hardware.
*   **Disk Space Full:**
    *   Identify large files/directories using `du`. Check `/var/log`, Docker volumes (`/var/lib/docker/volumes`), backup directories.
    *   Clean up old logs (logrotate), Docker images/volumes (`docker system prune -af --volumes`), old backups.
    *   Resize filesystem or add more storage.
*   **Hardware Errors:**
    *   Check `dmesg` for specific error messages.
    *   Run `smartctl` for disk errors. Plan disk replacement if failing.
    *   Run `memtest86+` overnight for memory errors. Replace faulty RAM modules.
    *   Check system temperatures. Improve cooling if overheating.
*   **VM/Hypervisor Issues:**
    *   Check VM/container logs (`journalctl`, Proxmox logs).
    *   Verify storage availability and health (`df -h`, `smartctl`).
    *   Check network configuration (bridges, VLANs).
    *   Ensure sufficient host resources (CPU/RAM).
    *   Check Proxmox cluster quorum (`pvecm status`).

### Preventive Measures

*   **Monitoring:** Set up Prometheus/Grafana/Alertmanager to monitor host resources (CPU, RAM, disk, network, SMART data).
*   **Log Rotation:** Configure `logrotate` properly for system and application logs.
*   **Regular Updates:** Keep host OS and firmware updated.
*   **Resource Planning:** Estimate resource needs before deploying new services.
*   **Hardware Burn-in:** Test new hardware thoroughly before putting into production.
*   **Configuration Management:** Use Ansible/Terraform to manage host configuration consistently.

### Escalation Paths

*   Consult Proxmox/OS documentation and forums.
*   Check hardware vendor support resources.
*   If using enterprise hardware, contact vendor support.

---

## 2. Kubernetes (K3s/K0s/RKE2)

### Common Issues & Symptoms

*   **Pods Pending:** Pods stuck in `Pending` state, not getting scheduled.
*   **Pods CrashLoopBackOff/Error:** Pods repeatedly restarting or failing to start.
*   **Service Not Reachable:** Cannot access application via Service IP/NodePort/Ingress.
*   **Nodes NotReady:** Nodes showing `NotReady` status in `kubectl get nodes`.
*   **Ingress Issues:** Ingress controller not routing traffic correctly, TLS errors.
*   **PersistentVolumeClaim (PVC) Pending:** PVCs stuck in `Pending` state.

### Diagnostic Approaches & Commands

*   **Check Cluster Status:**
    *   `kubectl get nodes -o wide`
    *   `kubectl get pods -A -o wide` (check status across all namespaces)
    *   `kubectl cluster-info`
    *   `kubectl get events -A --sort-by='.lastTimestamp'` (crucial for diagnosing scheduling/pod issues)
*   **Diagnose Pods:**
    *   `kubectl describe pod <pod_name> -n <namespace>` (shows events, status, volume mounts, node assignment)
    *   `kubectl logs <pod_name> -n <namespace>`
    *   `kubectl logs <pod_name> -n <namespace> -p` (logs from previous container instance)
    *   `kubectl exec -it <pod_name> -n <namespace> -- /bin/sh` (exec into running container)
*   **Diagnose Services & Network:**
    *   `kubectl get svc <service_name> -n <namespace> -o wide`
    *   `kubectl describe svc <service_name> -n <namespace>` (check selectors, endpoints)
    *   `kubectl get endpoints <service_name> -n <namespace>` (verify pods backing the service)
    *   Check CNI logs (e.g., Flannel, Calico) on nodes (`journalctl -u <cni_service>`).
    *   Check CoreDNS logs (`kubectl logs -l k8s-app=kube-dns -n kube-system`).
*   **Diagnose Nodes:**
    *   `kubectl describe node <node_name>` (check conditions, taints, capacity, allocated resources)
    *   Check Kubelet logs on the node (`journalctl -u kubelet` or specific service like `k3s`, `k0scontroller`, `rke2-server`/`rke2-agent`).
    *   Check container runtime logs (`journalctl -u containerd` or `docker`).
*   **Diagnose Ingress:**
    *   `kubectl get ingress <ingress_name> -n <namespace>`
    *   `kubectl describe ingress <ingress_name> -n <namespace>`
    *   Check Ingress controller logs (e.g., Traefik, Nginx Ingress) (`kubectl logs -l app.kubernetes.io/name=traefik -n <namespace>`).
    *   Check associated Service and Endpoints.
*   **Diagnose Storage:**
    *   `kubectl get pvc <pvc_name> -n <namespace>`
    *   `kubectl describe pvc <pvc_name> -n <namespace>`
    *   `kubectl get pv <pv_name>`
    *   `kubectl describe pv <pv_name>`
    *   Check StorageClass (`kubectl get sc`).
    *   Check CSI driver logs (if applicable). Check underlying storage health (NFS, Ceph, hostPath).

### Resolution Steps

*   **Pods Pending:**
    *   Check `kubectl describe pod` and `kubectl get events`. Reasons: Insufficient resources (CPU/RAM), node selectors/affinity rules not matching, taints on nodes, unbound PVCs.
    *   Scale cluster or adjust resource requests/limits. Fix selectors/affinity/tolerations. Address storage issues.
*   **Pods CrashLoopBackOff/Error:**
    *   Check `kubectl logs`. Application error? Configuration issue? Liveness/Readiness probe failures?
    *   Check `kubectl describe pod` for reasons (e.g., OOMKilled). Increase memory limits if needed.
    *   Fix application code, configuration (ConfigMaps/Secrets), or probe settings.
*   **Service Not Reachable:**
    *   Verify Service selector matches Pod labels (`kubectl describe svc`, `kubectl get pods -l <key>=<value>`).
    *   Check Endpoints object (`kubectl get endpoints`). Are pod IPs listed?
    *   Check NetworkPolicies (`kubectl get networkpolicy -A`). Are they blocking traffic?
    *   Check CNI networking. Restart CNI pods/daemonsets if necessary.
    *   Check `kube-proxy` logs on nodes.
*   **Nodes NotReady:**
    *   Check Kubelet logs on the affected node (`journalctl -u kubelet`). Is it running? Can it reach the API server?
    *   Check resource pressure (CPU, memory, disk) on the node.
    *   Check container runtime status (`systemctl status containerd`).
    *   Check CNI pod status on the node.
*   **Ingress Issues:**
    *   Verify Ingress definition (rules, service backend, TLS settings).
    *   Check Ingress controller logs for errors.
    *   Ensure Ingress controller Service is correctly exposed (LoadBalancer, NodePort).
    *   Check DNS records point to the correct Ingress IP/host.
    *   Verify TLS secret exists and is valid (`kubectl describe secret <tls_secret>`).
*   **PVC Pending:**
    *   Check `kubectl describe pvc` for events. Reason: No matching PV available? StorageClass not found? CSI provisioner issues?
    *   Ensure a PV exists with matching capacity/accessModes/StorageClass, or that the StorageClass has a working provisioner. Check CSI driver logs.

### Preventive Measures

*   **Monitoring:** Monitor cluster state (nodes, pods), resource usage, control plane health using Prometheus/Grafana.
*   **Resource Management:** Define sensible resource `requests` and `limits` for pods.
*   **Probes:** Configure appropriate Liveness and Readiness probes.
*   **Logging:** Ensure application logging is effective and accessible via `kubectl logs`. Centralize logs using Loki/EFK.
*   **IaC:** Manage Kubernetes manifests using GitOps (Argo CD, Flux) or Helm with version control.
*   **NetworkPolicies:** Implement NetworkPolicies for security and isolation.
*   **Regular Backups:** Back up etcd (for control plane state) and PV data. Use tools like Velero.

### Escalation Paths

*   Consult Kubernetes documentation (kubernetes.io).
*   Check GitHub issues for the specific Kubernetes distribution (K3s, etc.) or components (CNI, Ingress controller).
*   Ask in relevant community forums/Slack/Discord channels.

---

## 3. AI Services (Triton, Ray)

### Common Issues & Symptoms

*   **Triton: Model Not Loading/Ready:** Model repository scan fails, model status is `UNAVAILABLE`.
*   **Triton: Inference Errors:** Client receives errors during inference requests (e.g., shape mismatch, internal server error).
*   **Triton: Low Performance:** High latency, low throughput.
*   **Ray: Cluster Formation Issues:** Workers cannot connect to the head node.
*   **Ray: Task/Actor Failures:** Ray tasks or actors fail unexpectedly. `RayActorError`, `RayTaskError`.
*   **Ray: Resource Deadlock:** Tasks waiting indefinitely for resources that are not available.

### Diagnostic Approaches & Commands

*   **Triton:**
    *   Check Triton server logs (`docker logs <triton_container>` or `kubectl logs <triton_pod>`). Look for errors during model loading. Verbose logging (`--log-verbose=1`).
    *   Check model repository structure and `config.pbtxt` files for correctness.
    *   Use Triton's API to check model status: `curl localhost:8000/v2/repository/index` or `curl localhost:8000/v2/models/<model_name>`.
    *   Check GPU status on the host/node (`nvidia-smi`). Are GPUs recognized by Triton?
    *   Use `perf_analyzer` tool to benchmark models and diagnose performance issues.
*   **Ray:**
    *   Check Ray head node logs.
    *   Check Ray worker node logs. Look for connection errors, task/actor errors.
    *   Use the Ray Dashboard (usually port `8265`) for cluster overview, logs, and resource usage.
    *   `ray status` CLI command.
    *   `ray memory` CLI command (if object store issues suspected).
    *   Check resource availability (`ray.nodes()`, dashboard).
    *   Examine stack traces for failed tasks/actors in logs or dashboard.

### Resolution Steps

*   **Triton: Model Not Loading:**
    *   Verify model repository path is correctly mounted/accessible.
    *   Validate `config.pbtxt` syntax and parameters (platform, input/output names, shapes, dtypes).
    *   Ensure model files (SavedModel, ONNX, etc.) are complete and not corrupted.
    *   Check Triton logs for specific errors (e.g., missing backend, unsupported ops). Ensure required backends are built/included.
    *   Check GPU driver/CUDA compatibility with the Triton version.
*   **Triton: Inference Errors:**
    *   Verify client request matches the model's expected input names, shapes, and dtypes defined in `config.pbtxt`.
    *   Check Triton logs for backend errors during inference execution.
    *   Test with a simple, known-good client request.
*   **Triton: Low Performance:**
    *   Check `nvidia-smi` during inference. Are GPUs utilized?
    *   Experiment with `config.pbtxt` settings: dynamic batching, instance groups (multiple instances per GPU or across GPUs).
    *   Ensure model is optimized (e.g., TensorRT, ONNX Runtime optimizations, quantization).
    *   Benchmark using `perf_analyzer` to isolate bottlenecks.
*   **Ray: Cluster Formation Issues:**
    *   Verify network connectivity between head and worker nodes (ping, check firewalls).
    *   Ensure head node address specified for workers is correct.
    *   Check Ray version consistency across all nodes.
    *   Verify Ray ports are open (default `6379`, `8265`, `10001`, etc.).
*   **Ray: Task/Actor Failures:**
    *   Analyze application code within the task/actor. Check logs for exceptions.
    *   Check for resource exhaustion (memory OOM, disk full) within the task/actor environment. Increase resource requests/limits if needed.
    *   Handle potential exceptions within the Ray task/actor code.
*   **Ray: Resource Deadlock:**
    *   Check resource requests (`.options(num_cpus=..., num_gpus=...)`) vs. available cluster resources (Ray dashboard, `ray.cluster_resources()`).
    *   Look for circular dependencies or tasks requesting unavailable custom resources.
    *   Consider reducing resource requests or increasing cluster capacity.

### Preventive Measures

*   **Triton:** Validate `config.pbtxt` using schemas or linters. Test models locally before deploying. Monitor GPU utilization and temperature.
*   **Ray:** Monitor cluster resources and task/actor states via the dashboard. Define appropriate resource requests for tasks/actors. Use consistent Ray versions. Implement robust error handling in Ray applications.
*   **Version Control:** Store model configurations and Ray application code in Git.
*   **CI/CD:** Automate model validation and deployment. Automate Ray application testing.

### Escalation Paths

*   Consult Triton documentation (GitHub, NVIDIA docs).
*   Consult Ray documentation (docs.ray.io).
*   Check GitHub issues for Triton and Ray projects.
*   Ask in NVIDIA forums (for Triton) or Ray community Slack/forums.

---

## 4. Data Mesh (RabbitMQ, Kafka, MinIO, Databases)

### Common Issues & Symptoms

*   **Message Queue (RabbitMQ/Kafka):** Messages not being published/consumed, high queue depth, consumers crashing, connection issues.
*   **Object Storage (MinIO):** Unable to upload/download objects, permission errors, slow performance, server unavailable.
*   **Databases (PostgreSQL, etc.):** Connection refused, slow queries, authentication failures, data corruption, replication lag.

### Diagnostic Approaches & Commands

*   **RabbitMQ:**
    *   Check RabbitMQ server logs (`/var/log/rabbitmq/`).
    *   Use RabbitMQ Management UI (port `15672`): Check connections, channels, queues (status, message rates, queue depth), exchanges, user permissions.
    *   `rabbitmqctl status`
    *   `rabbitmqctl list_queues name messages consumers`
    *   `rabbitmqctl list_connections`
    *   Check client application logs for connection/publishing/consuming errors.
*   **Kafka:**
    *   Check Kafka broker logs.
    *   Check Zookeeper logs (if applicable).
    *   Use Kafka command-line tools (`kafka-topics.sh`, `kafka-console-consumer.sh`, `kafka-console-producer.sh`) to list topics, produce/consume messages manually.
    *   Check consumer group lag (`kafka-consumer-groups.sh --describe`).
    *   Check client application logs.
*   **MinIO:**
    *   Check MinIO server logs (`docker logs <minio_container>` or `journalctl -u minio.service`).
    *   Use MinIO Client (`mc`): `mc alias set ...`, `mc admin info <alias>`, `mc ls <alias>/<bucket>`, `mc cp ...`.
    *   Check network connectivity and firewall rules to MinIO server ports (default `9000`, `9001`).
    *   Verify access keys and policies/permissions.
*   **Databases (PostgreSQL Example):**
    *   Check PostgreSQL server logs (location defined in `postgresql.conf`).
    *   Check server status (`systemctl status postgresql`).
    *   Verify network connectivity and firewall rules to port `5432`.
    *   Check `pg_hba.conf` for client authentication rules.
    *   Check user credentials and database permissions.
    *   Connect using `psql -h <host> -U <user> -d <db>` and run diagnostic queries (`\l`, `\dt`, check `pg_stat_activity`).
    *   Use `EXPLAIN ANALYZE <query>` for slow queries.

### Resolution Steps

*   **Message Queue:**
    *   **Connectivity:** Check network, firewalls, client credentials, vhost permissions.
    *   **Messages Stuck:** Check consumer status. Are consumers running? Are they crashing (check logs)? Is there a poison message? Are bindings correct? Check queue/message TTL.
    *   **High Queue Depth:** Increase number of consumers, optimize consumer processing speed, check for publisher spikes.
*   **Object Storage:**
    *   **Connectivity/Availability:** Check server logs, network, firewalls. Restart MinIO service.
    *   **Permissions:** Verify access/secret keys. Check bucket/user policies using `mc admin policy`.
    *   **Performance:** Check underlying disk performance (`iotop`), network bandwidth. Consider MinIO erasure coding setup.
*   **Databases:**
    *   **Connectivity:** Check network, firewalls, PostgreSQL `listen_addresses` setting in `postgresql.conf`.
    *   **Authentication:** Verify user/password. Check `pg_hba.conf` rules match client IP/method.
    *   **Slow Queries:** Analyze query plan (`EXPLAIN ANALYZE`). Add indexes, rewrite query, increase server resources, tune `postgresql.conf` settings (e.g., `shared_buffers`, `work_mem`).
    *   **Replication Lag:** Check logs on primary and replica. Verify network connectivity between them. Check replica I/O performance.

### Preventive Measures

*   **Monitoring:** Monitor queue depths, message rates, consumer lag, connection counts, disk usage (MinIO/DBs), query latency, replication lag.
*   **Alerting:** Set alerts for high queue depth, consumer inactivity, high latency, low disk space, replication lag.
*   **Client Error Handling:** Implement robust error handling and retry logic in client applications. Use dead-letter queues (RabbitMQ/Kafka).
*   **Resource Provisioning:** Ensure sufficient CPU, RAM, disk I/O for data services.
*   **Regular Maintenance:** Perform database maintenance (VACUUM, ANALYZE), check MinIO disk health.
*   **Backup & Recovery:** Implement and regularly test backups for databases and MinIO data.

### Escalation Paths

*   Consult documentation for RabbitMQ, Kafka, MinIO, PostgreSQL, etc.
*   Check relevant community forums, mailing lists, Stack Overflow.
*   Review GitHub issues for the respective projects.

---

*(Continue for Observability, Automation, Security, Networking subsystems following the same structure)*

---

## 5. Observability (Prometheus, Grafana, Loki, Alertmanager)

### Common Issues & Symptoms

*   **Prometheus: Targets Down:** Scrape targets showing `DOWN` state in Prometheus UI (`/targets`).
*   **Prometheus: No Data/Gaps in Graphs:** Grafana graphs showing "No data" or missing data points.
*   **Prometheus: High Resource Usage:** Prometheus consuming excessive CPU/RAM/Disk.
*   **Grafana: Dashboard Errors:** Panels showing errors ("Metric not found", "Datasource error").
*   **Grafana: Login Issues:** Unable to log into Grafana.
*   **Loki: No Logs:** Grafana Explore showing no logs for specific services. LogQL queries return empty results.
*   **Alertmanager: Alerts Not Firing/Notifying:** Alerts firing in Prometheus but no notifications received, or alerts not firing at all.

### Diagnostic Approaches & Commands

*   **Prometheus:**
    *   Check Prometheus UI (`/targets`): Look at error messages for down targets (connection refused, timeout, 404).
    *   Check Prometheus logs (`docker logs`/`kubectl logs`): Look for scrape errors, configuration loading issues.
    *   Query Prometheus directly (`/graph` UI): Check if the metric exists (`up{job="myjob"}`). Check for label mismatches.
    *   Check Prometheus configuration (`prometheus.yml`) syntax and scrape config logic.
    *   Check network connectivity from Prometheus to scrape targets. Check target endpoint (`/metrics`) manually (`curl <target_ip>:<port>/metrics`).
    *   Check Prometheus TSDB status/size (`/status` UI).
*   **Grafana:**
    *   Check Grafana server logs (`docker logs`/`kubectl logs` or `/var/log/grafana/grafana.log`). Look for datasource errors, login errors, rendering issues.
    *   Inspect browser's developer console for frontend errors.
    *   Verify datasource configuration in Grafana UI: Is the URL correct? Can Grafana reach Prometheus/Loki? Test datasource connection.
    *   Check query syntax in failing panels. Test the query directly in Prometheus/Loki.
    *   Check Grafana user authentication settings (`grafana.ini` or environment variables).
*   **Loki & Promtail/Fluentd:**
    *   Check Loki logs (`docker logs`/`kubectl logs`).
    *   Check Promtail/Fluentd logs: Are they discovering log files? Can they connect to Loki? Permission errors reading log files?
    *   Verify Promtail/Fluentd configuration: Correct file paths, labels, Loki URL.
    *   Check network connectivity from log agent to Loki.
    *   Use Grafana Explore: Check label selectors (`{job="myapp"}`). Are logs arriving with the expected labels? Check time range.
*   **Alertmanager:**
    *   Check Alertmanager logs (`docker logs`/`kubectl logs`).
    *   Check Alertmanager UI (`/#/alerts`): Are alerts received from Prometheus? Are they inhibited/silenced?
    *   Check Prometheus UI (`/alerts`): Are alerts firing? Is Alertmanager configured correctly in Prometheus (`alertmanagers` config)?
    *   Verify Alertmanager configuration (`alertmanager.yml`): Correct routing rules, receiver configurations (webhook URLs, API keys, email settings).
    *   Test receiver integration manually (e.g., send a test message via `curl` to Discord webhook).
    *   Check network connectivity from Alertmanager to notification endpoints.

### Resolution Steps

*   **Prometheus Targets Down:** Fix network connectivity/firewall issues. Ensure exporter is running on target. Correct scrape config (address, port, path, labels).
*   **Prometheus No Data:** Verify metric name and labels in Grafana match Prometheus. Check Prometheus scrape interval vs. Grafana time range/refresh. Ensure target is up and exposing the metric. Check Prometheus retention period.
*   **Prometheus High Resource Usage:** Investigate high cardinality metrics (`/tsdb-status` UI). Adjust scrape intervals. Reduce metric/label cardinality at the source (exporters). Increase Prometheus resources or scale horizontally. Tune TSDB retention.
*   **Grafana Dashboard Errors:** Correct datasource configuration. Fix query syntax/labels. Ensure metric/log stream exists. Restart Grafana if necessary.
*   **Grafana Login Issues:** Check authentication configuration (e.g., OAuth settings, LDAP config, internal user passwords). Check Grafana logs.
*   **Loki No Logs:** Fix Promtail/Fluentd configuration (paths, permissions, labels). Ensure agent can connect to Loki (network, URL). Verify label selectors in Grafana match labels applied by the agent.
*   **Alertmanager Not Firing/Notifying:** Correct Prometheus alerting rules or Alertmanager configuration in Prometheus. Fix Alertmanager routing rules or receiver configuration (URLs, tokens). Check network connectivity to notification service. Check for silences in Alertmanager UI.

### Preventive Measures

*   **Monitor the Monitors:** Use Prometheus to scrape itself, Grafana, Alertmanager, Loki. Set up meta-alerting (e.g., `alertmanager_notifications_failed_total`, `up == 0`).
*   **Configuration Validation:** Use `promtool check config` and `amtool check-config`. Lint Grafana JSON/Loki YAML. Store configs in Git.
*   **Standardize Labels:** Use consistent labeling across exporters, Prometheus, Alertmanager for easier querying and routing.
*   **Resource Planning:** Allocate sufficient resources for observability components, especially Prometheus and Loki storage.
*   **Regular Review:** Periodically review dashboards, alert rules, and log queries for relevance and correctness.

### Escalation Paths

*   Consult documentation for Prometheus, Grafana, Loki, Alertmanager.
*   Check GitHub issues and community forums/Slack channels for each tool.

---

*(Continue for Automation, Security, Networking subsystems)*

---

## 6. Automation (n8n, Home Assistant, Ansible)

### Common Issues & Symptoms

*   **n8n:** Workflows not triggering (webhook, schedule), nodes showing errors, credential issues, workflows stuck/running long.
*   **Home Assistant:** Automations not firing, devices unavailable/unresponsive, integrations failing to load, frontend slow/unresponsive.
*   **Ansible:** Playbook execution failures (syntax errors, task failures, host unreachable), unexpected changes or no changes applied.

### Diagnostic Approaches & Commands

*   **n8n:**
    *   Check n8n logs (`docker logs`/`kubectl logs`).
    *   Check Execution List in n8n UI: Look for failed executions, examine input/output data and error messages for specific nodes.
    *   Test triggers manually (e.g., call webhook URL with `curl`).
    *   Verify credentials used in nodes are correct and have necessary permissions.
    *   Check resource usage of the n8n container/pod.
*   **Home Assistant:**
    *   Check Home Assistant logs (`Configuration` -> `Logs` in UI, or `home-assistant.log` file / `docker logs`/`kubectl logs`). Filter by integration or automation.
    *   Check `Developer Tools` -> `States`: Verify entity states and attributes.
    *   Check `Developer Tools` -> `Events`: Listen for events to debug triggers.
    *   Check `Developer Tools` -> `Services`: Test service calls manually.
    *   Check `Configuration` -> `Automations & Scenes`: Trace automation runs. Validate automation YAML syntax.
    *   Check `Configuration` -> `Devices & Services`: Look for integration errors.
    *   Check resource usage of the Home Assistant host/container.
*   **Ansible:**
    *   Increase playbook verbosity (`-v`, `-vv`, `-vvv`).
    *   Run `ansible-playbook --syntax-check <playbook.yml>`.
    *   Run `ansible-lint <playbook.yml>`.
    *   Run playbook with `--check` (dry run) and `--diff` modes.
    *   Test connectivity to target hosts (`ansible <host_pattern> -m ping`).
    *   Verify SSH keys, user permissions (`become` settings), and inventory file correctness.
    *   Examine module documentation for required parameters and return values.
    *   Check logs on the *target* machine if a task fails.

### Resolution Steps

*   **n8n:**
    *   **Not Triggering:** Verify trigger configuration (schedule, webhook URL, event source). Check logs for trigger errors. Ensure n8n is running.
    *   **Node Errors:** Examine node input data and configuration. Correct API keys/credentials. Fix data transformation logic (Function node). Check external service status.
    *   **Stuck Workflows:** Check for infinite loops, long-running external calls, or resource exhaustion. Optimize workflow logic. Increase resources if needed.
*   **Home Assistant:**
    *   **Automations Not Firing:** Check trigger definition (entity ID, platform, state/event data). Verify conditions. Check HA logs for errors during execution. Ensure automation is enabled.
    *   **Devices Unavailable:** Check device power/network. Check integration logs for connection errors. Reload integration or restart HA. Check for breaking changes after HA updates.
    *   **Integrations Failing:** Check logs for specific errors. Verify API keys/credentials. Check for required dependencies. Update integration/HA Core.
*   **Ansible:**
    *   **Syntax Errors:** Correct YAML syntax based on error messages and `ansible-lint`.
    *   **Task Failures:** Analyze verbose output and error messages. Check module documentation. Verify parameters. Check state on the target machine. Fix underlying issue on target (e.g., missing package, incorrect file permissions).
    *   **Host Unreachable:** Verify inventory, SSH keys, user, port. Check network connectivity and firewall rules.

### Preventive Measures

*   **Version Control:** Store n8n workflows (JSON export), Home Assistant configuration (YAML), and Ansible playbooks in Git.
*   **Testing:** Test n8n workflows with sample data. Test HA automations using Developer Tools. Use Ansible `--check` mode and Molecule for role testing.
*   **Documentation:** Document complex workflows, automations, and playbooks.
*   **Secrets Management:** Avoid hardcoding credentials; use n8n credential manager, HA `secrets.yaml`, Ansible Vault.
*   **Idempotency (Ansible):** Write Ansible tasks to be idempotent (running multiple times yields the same result).

### Escalation Paths

*   Consult documentation for n8n, Home Assistant, Ansible.
*   Check community forums and Discord/Slack channels for each tool.
*   Review GitHub issues for relevant projects/integrations/modules.

---

## 7. Security (Firewall, VPN, Auth)

### Common Issues & Symptoms

*   **Firewall Blocking Traffic:** Legitimate connections being dropped/rejected.
*   **VPN Connection Failure:** Client cannot connect to VPN server (WireGuard/OpenVPN).
*   **VPN Connected, No Traffic:** VPN connected, but cannot access internal resources or internet.
*   **Authentication Failure:** Unable to log in via SSO (Authelia/Keycloak), basic auth, or service-specific auth. Incorrect redirects.
*   **TLS/Certificate Errors:** Browser warnings (NET::ERR_CERT_INVALID), client connection failures due to certificate issues.

### Diagnostic Approaches & Commands

*   **Firewall (ufw/iptables):**
    *   `ufw status verbose` or `iptables -L -v -n` (list rules with packet/byte counts).
    *   Check firewall logs (`/var/log/ufw.log` or kernel logs for iptables logging rules).
    *   Use `tcpdump` or `wireshark` on relevant interfaces to capture traffic and see if it reaches/leaves the firewall.
*   **VPN (WireGuard Example):**
    *   Server: `wg show` (check interface status, peers, latest handshake). Check server logs (`journalctl -u wg-quick@wg0`). Check firewall allows UDP port.
    *   Client: `wg show`. Check client logs. Verify client config (keys, endpoint IP/port, allowed IPs). `ping` VPN server's internal IP. `traceroute` to internal resource.
*   **Authentication (Authelia Example):**
    *   Check Authelia logs (`docker logs`/`kubectl logs`). Look for login attempts, errors validating credentials, Redis/LDAP connection issues.
    *   Check reverse proxy (Nginx/Traefik) logs for errors related to forwarding auth requests.
    *   Verify Authelia configuration (`configuration.yml`) - user backend, notifier settings, session domain/secret.
    *   Verify reverse proxy configuration forwards correct headers to Authelia and respects auth responses.
    *   Use browser developer tools (Network tab) to trace redirects and check cookies.
*   **TLS/Certificates:**
    *   Use browser developer tools to inspect certificate details (issuer, validity period, subject).
    *   Use `openssl s_client -connect <domain>:<port> -servername <domain>` to check certificate chain and details.
    *   Use `testssl.sh <domain>:<port>` for comprehensive TLS checks.
    *   Verify certificate files (PEM format, correct chain order) used by the server (Nginx, Traefik, etc.).
    *   Check Let's Encrypt logs (e.g., Traefik logs for ACME challenges) if using automated certificates.

### Resolution Steps

*   **Firewall Blocking:** Identify the blocking rule using logs or rule listing. Modify/add rules to allow necessary traffic (specific port, protocol, source/destination IP). Reload firewall (`ufw reload`).
*   **VPN Connection Failure:** Verify keys match between client/server peers. Ensure server endpoint IP/port is correct and reachable (check firewalls). Restart VPN service on server/client.
*   **VPN No Traffic:** Check `AllowedIPs` on client (for routing) and server (for allowed client source IPs). Check server firewall/NAT rules (`PostUp`/`PostDown` in `wg0.conf`) allow traffic forwarding from VPN clients. Check DNS settings pushed to/used by client.
*   **Authentication Failure:** Correct user credentials. Fix Authelia configuration (user source, session settings). Fix reverse proxy configuration (forwarding headers, auth URLs). Ensure Redis/LDAP backend is reachable by Authelia. Clear browser cookies/cache.
*   **TLS/Certificate Errors:** Renew expired certificates. Ensure correct certificate chain is served. Fix domain name mismatch between certificate and server name. Ensure clients trust the issuing CA (especially for internal CAs). Correct file paths/permissions for certificate files.

### Preventive Measures

*   **Firewall Audits:** Regularly review firewall rules for necessity and correctness.
*   **VPN Key Management:** Securely store and manage VPN keys. Rotate if necessary.
*   **Certificate Monitoring:** Monitor certificate expiry using Prometheus (`blackbox_exporter`) or dedicated tools. Automate renewal (Let's Encrypt).
*   **Strong Authentication:** Enforce strong passwords, use MFA where possible.
*   **Configuration Management:** Manage firewall rules, VPN configs, auth configs using IaC tools (Ansible, Terraform) and version control.
*   **Least Privilege:** Apply least privilege principle for firewall rules and user permissions.

### Escalation Paths

*   Consult documentation for firewall software, VPN software, authentication provider.
*   Use online TLS checker tools (e.g., SSL Labs).
*   Check relevant security forums and communities.

---

## 8. Networking (DNS, DHCP, Switches)

### Common Issues & Symptoms

*   **Cannot Resolve Internal/External Hostnames:** DNS lookup failures (`nslookup`, `dig`).
*   **Clients Not Getting IP Addresses:** Devices failing to connect to network, getting APIPA addresses (169.254.x.x).
*   **Slow Network Performance:** Slow file transfers, high latency between hosts.
*   **Intermittent Connectivity:** Connections dropping randomly.
*   **VLAN Misconfiguration:** Devices unable to communicate across VLANs or getting IPs from wrong subnet.

### Diagnostic Approaches & Commands

*   **DNS:**
    *   `ipconfig /all` (Windows) or `cat /etc/resolv.conf` (Linux) - Check DNS server assigned to client.
    *   `nslookup <hostname> [dns_server]`
    *   `dig <hostname> @<dns_server>` (more detailed)
    *   Check DNS server logs (e.g., Pi-hole, AdGuard Home, BIND).
    *   Check upstream DNS forwarders used by the local DNS server.
*   **DHCP:**
    *   Check DHCP server logs (router, Pi-hole, Windows Server, `isc-dhcp-server`). Look for DISCOVER, OFFER, REQUEST, ACK messages.
    *   Check DHCP server configuration: IP address pool range, lease time, gateway/DNS options. Is the pool exhausted?
    *   Check client network configuration (`ipconfig /renew`, `dhclient -r; dhclient`).
    *   Use `tcpdump` or Wireshark on the client or server network segment, filtering for UDP ports 67 and 68, to observe DHCP traffic. Check for rogue DHCP servers.
*   **Switch/Physical Layer:**
    *   Check link lights on devices and switch ports.
    *   Try different network cables and switch ports.
    *   Check switch management interface (if managed switch): Port status, error counters (CRC errors, collisions), VLAN configuration, Spanning Tree Protocol (STP) status.
    *   Use `ping -s <large_size> <destination>` or `iperf3` between hosts to test throughput and packet loss.
*   **VLANs:**
    *   Verify port VLAN assignments (tagged/untagged) on switches match device configurations.
    *   Check trunk port configurations allow necessary VLANs.
    *   Verify router/L3 switch configuration for inter-VLAN routing (if needed). Check firewall rules between VLANs.

### Resolution Steps

*   **DNS Resolution Failure:** Correct DNS server address on client or in DHCP settings. Fix DNS server configuration (forwarders, local records). Restart DNS server process. Check firewall rules blocking DNS (port 53 UDP/TCP).
*   **DHCP Failure:** Correct/Restart DHCP server configuration. Increase IP pool size. Check for rogue DHCP servers. Ensure DHCP relay agent is configured correctly if server is on a different subnet. Verify client device network settings.
*   **Slow Network/Intermittent Connectivity:** Replace faulty cables/ports. Check for duplex mismatches on switch ports. Investigate high error counters on switch ports. Check for network loops (STP issues). Reduce network congestion or upgrade hardware (switch, NICs).
*   **VLAN Misconfiguration:** Correct port tagging/untagging on switches. Ensure trunk ports carry the required VLANs. Fix router/L3 switch inter-VLAN routing configuration and associated firewall rules.

### Preventive Measures

*   **Network Diagram:** Maintain an up-to-date network diagram including IP addresses, VLANs, switch connections.
*   **Standardized Configuration:** Use consistent IP addressing schemes and VLAN IDs.
*   **Managed Switches:** Use managed switches for better visibility and control (VLANs, monitoring).
*   **Cable Management:** Use good quality cables and label them clearly.
*   **Monitoring:** Monitor switch port status, traffic levels, error rates (via SNMP if possible). Monitor DNS/DHCP server health.
*   **Configuration Backups:** Regularly back up switch/router configurations.

### Escalation Paths

*   Consult switch/router vendor documentation.
*   Check vendor support forums or communities (e.g., Ubiquiti, MikroTik forums).
*   Use network analysis tools (`iperf3`, `wireshark`) for deeper investigation.

---
