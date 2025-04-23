# 🚨 Homelab Manual Recovery Procedures 🚨

This document outlines manual procedures for recovering from significant failure scenarios in the homelab environment. Always attempt automated recovery scripts first if available. Proceed with manual recovery only when necessary and with caution.

**General Prerequisites:**

*   💻 Access to a management machine with necessary tools (`kubectl`, `ssh`, `git`, cloud provider CLI, backup client, etc.).
*   🔑 SSH access to surviving nodes (if applicable).
*   🔑 Access to infrastructure management tools (e.g., Proxmox, vSphere, cloud console).
*   🔑 Access to backup storage (local and offsite).
*   🔑 GPG private key for decrypting backups (if applicable).
*   📚 Familiarity with the homelab architecture and deployed services.
*   📄 Access to configuration backups (Git repository, Pulumi state, Ansible playbooks).

---

##  Scenario 1: Complete Node Failure (Requiring Reinstallation) 💣

This covers a physical node failure (hardware issue, OS corruption beyond repair) where the node needs to be rebuilt and rejoined to the cluster.

### Diagnosis 🤔

```mermaid
graph TD
    A[Node Unresponsive?] -- Yes --> B{Pingable?};
    A -- No --> Z([✅ Node OK]);
    B -- No --> C{Check Physical/VM Power & Network};
    B -- Yes --> D{SSH Access?};
    C -- Issue Found --> C1[Fix Power/Network];
    C -- No Issue --> D;
    D -- No --> E{Console Access (IPMI/VM Console)?};
    D -- Yes --> F{Check OS Logs / `journalctl`};
    E -- No --> G[💀 Assume Total Failure];
    E -- Yes --> F;
    F -- OS Boot Issues / Filesystem Corruption --> G;
    F -- Service Issues --> H[Attempt Service Repair / Reboot];
    H -- Success --> Z;
    H -- Failure --> G;
    G -- Proceed --> I[Initiate Node Reinstallation Procedure];
```

### Prerequisites

*   Replacement hardware or fixed existing hardware.
*   OS installation media (e.g., USB drive with Ubuntu Server).
*   Node configuration details (IP address, hostname, etc.).
*   Access to Ansible playbooks or setup scripts for node bootstrapping.
*   Kubernetes cluster join token (or ability to generate one).

### Step-by-Step Recovery 🛠️

1.  **Isolate the Failed Node:**
    *   Physically disconnect the node from the network (optional but recommended).
    *   Power off the failed node via IPMI, VM console, or physically.
    *   If the node is still listed in Kubernetes, attempt to drain it (this might fail):
        ```bash
        kubectl drain <failed-node-name> --ignore-daemonsets --delete-emptydir-data --force
        ```
    *   Remove the node object from Kubernetes:
        ```bash
        kubectl delete node <failed-node-name>
        ```

2.  **Prepare Replacement Hardware/OS:**
    *   Install the operating system (e.g., Ubuntu Server) following standard procedures.
    *   Configure basic networking (static IP, hostname) matching the old node or a new configuration.
    *   Ensure SSH access is working.

3.  **Bootstrap the New Node:**
    *   Run necessary bootstrapping scripts (e.g., Ansible playbooks) to:
        *   Install required packages (container runtime like `containerd`, `kubelet`, `kubeadm`, `kubectl`, NFS client, etc.).
        *   Configure the container runtime.
        *   Configure `kubelet`.
        *   Pull necessary container images (`kubeadm config images pull`).

4.  **Join the Node to the Cluster:**
    *   **If Control Plane Node:** Follow specific procedures for restoring/adding a control plane node (often involves restoring etcd from backup - see Scenario 2). **This is complex and high-risk.**
    *   **If Worker Node:**
        *   Generate a new join token on an existing control plane node:
            ```bash
            kubeadm token create --print-join-command
            ```
        *   Copy the output command (looks like `kubeadm join <api-server-ip>:<port> --token <token> --discovery-token-ca-cert-hash sha256:<hash>`).
        *   Run the join command on the **new worker node** using `sudo`.

5.  **Verify Node Status:**
    *   On a control plane node, check if the new node joins and becomes `Ready`:
        ```bash
        kubectl get nodes -o wide
        watch kubectl get nodes
        ```
    *   Check logs on the new node if issues arise (`journalctl -u kubelet`).

6.  **Apply Labels/Taints (If Necessary):**
    *   If the old node had specific labels or taints, re-apply them to the new node:
        ```bash
        kubectl label node <new-node-name> key=value
        kubectl taint node <new-node-name> key=value:Effect
        ```

### Verification ✅

*   `kubectl get nodes` shows the new node as `Ready`.
*   Pods start scheduling onto the new node (if applicable).
*   Workloads previously running on the failed node (that were replicated) are running elsewhere or are rescheduled onto the new node.
*   Run cluster health checks.

---

## Scenario 2: Kubernetes Control Plane Issues 🤯

This covers issues affecting the Kubernetes API server, etcd, scheduler, or controller manager, potentially making the cluster unresponsive or unstable.

### Diagnosis 🤔

```mermaid
graph TD
    A[API Server Unresponsive?] -- `kubectl` commands fail --> B{Check Control Plane Node(s) Status};
    A -- `kubectl` works but errors --> C{Check Component Status};
    B -- Node(s) Down --> D[Refer to Node Failure Scenario];
    B -- Node(s) Up --> E{Check `kube-apiserver` Pod Logs};
    C -- Check Pod Status --> F{`kubectl get pods -n kube-system`};
    F -- Pods Crashing/Error --> G{Check Logs of Failing Pods};
    E -- Errors Found --> H{Analyze API Server Logs};
    G -- Errors Found --> I{Analyze Component Logs (etcd, scheduler, controller-manager)};
    H -- Certificate Issues --> J[Check/Renew Certificates];
    H -- etcd Connection Issues --> K[Check etcd Health];
    I -- etcd Issues --> K;
    I -- Other Errors --> L[Troubleshoot Specific Component];
    K -- etcd Cluster Healthy? --> M{Check Network Between CP Nodes};
    K -- etcd Unhealthy --> N[Initiate etcd Recovery];
    J -- Success --> Z([✅ Issue Resolved]);
    L -- Success --> Z;
    M -- Network OK --> L;
    M -- Network Issue --> O[Fix Network];
    N -- Proceed --> P[Follow etcd Restore Procedure];
    O -- Success --> Z;
    P -- Success --> Z;
```

### Prerequisites

*   SSH access to all control plane nodes.
*   `kubectl` configured to potentially talk directly to a specific API server instance if the load balancer/VIP is down.
*   Access to etcd backups (if needing restore).
*   Knowledge of certificate management procedures (`kubeadm certs check-expiration`, renewal commands).
*   `etcdctl` utility (often included with Kubernetes or installable).

### Step-by-Step Recovery 🛠️

*(Steps depend heavily on the specific diagnosis)*

**A. Certificate Issues:**

1.  Check expiration: `sudo kubeadm certs check-expiration`.
2.  Renew certificates if needed (follow official Kubernetes documentation for `kubeadm certs renew`). Requires restarting control plane components.

**B. Specific Component Failure (API Server, Scheduler, Controller Manager):**

1.  Check pod logs: `kubectl logs <pod-name> -n kube-system`.
2.  If a pod is crashing, investigate the reason (resource limits, configuration error, bug).
3.  Try deleting the pod to let the static pod definition (or Deployment/DaemonSet) recreate it: `kubectl delete pod <pod-name> -n kube-system`.
4.  Check underlying node health.

**C. etcd Issues (Requires Quorum):**

1.  **Check Health:** On each control plane node, run:
    ```bash
    # Adjust endpoints, cert paths as per your setup
    ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
      --cacert=/etc/kubernetes/pki/etcd/ca.crt \
      --cert=/etc/kubernetes/pki/etcd/server.crt \
      --key=/etc/kubernetes/pki/etcd/server.key \
      endpoint health --cluster
    ```
2.  **If Quorum Lost / Data Corruption Suspected:**
    *   **STOP KUBERNETES API SERVERS ON ALL CONTROL PLANE NODES** to prevent further writes. (e.g., `sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/` on each node). Wait for pods to stop.
    *   Identify a healthy etcd member or decide to restore from backup.
    *   **Restore from Backup (Most Common for Corruption/Total Failure):**
        *   Follow the official Kubernetes documentation for restoring etcd using `etcdctl snapshot restore`.
        *   This involves stopping etcd, running the restore command, fixing file ownership, potentially adjusting `--initial-cluster` flags, and restarting etcd.
        *   **CRITICAL:** Ensure all control plane nodes are restored/reconfigured consistently before restarting API servers.
    *   **Restart API Servers:** `sudo mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/` on each node.

### Verification ✅

*   `kubectl get nodes` works and shows correct status.
*   `kubectl get pods -n kube-system` shows all control plane components running.
*   `etcdctl endpoint health --cluster` shows all members healthy.
*   Deployments and services function correctly.

---

## Scenario 3: Complex Database Corruption 💾💥

This covers scenarios where automated backup/restore might fail or where specific data recovery techniques are needed beyond simple log detection.

### Diagnosis 🤔

*   Application errors related to database reads/writes.
*   Database logs show persistent errors even after restarts (see `detect_db_corruption.py` patterns).
*   Database process fails to start.
*   Standard restore procedures fail.

### Prerequisites

*   Deep knowledge of the specific database system (PostgreSQL, InfluxDB, Redis).
*   Database-specific command-line tools (`psql`, `influx`, `redis-cli`).
*   Access to database backups (multiple points in time if possible).
*   Access to the persistent volume where database data resides.

### Step-by-Step Recovery 🛠️

*(Highly database-specific - examples below)*

**General Approach:**

1.  **STOP the Application:** Prevent further writes/reads to the potentially corrupted database. Scale down related Kubernetes Deployments/StatefulSets:
    ```bash
    kubectl scale deployment <app-deployment> --replicas=0 -n <app-namespace>
    ```
2.  **STOP the Database:** Scale down the database StatefulSet/Deployment:
    ```bash
    kubectl scale statefulset <db-statefulset> --replicas=0 -n <db-namespace>
    ```
3.  **Attempt Filesystem Check (If Applicable):** If using block storage, try running `fsck` on the unmounted volume (requires node access and unmounting). **RISKY.**
4.  **Attempt Database-Specific Recovery Tools:**
    *   **PostgreSQL:** Tools like `pg_resetwal` (last resort), or attempting to dump data from a partially running instance. Consult PostgreSQL documentation for corruption recovery.
    *   **InfluxDB:** Tools like `influxd inspect verify-tsm` or procedures for rebuilding TSM/index data. Consult InfluxDB documentation.
    *   **Redis:** If using AOF, `redis-check-aof --fix`. If using RDB, `redis-check-rdb`.

5.  **Restore from Last Known Good Backup:**
    *   Identify the latest backup *before* the corruption likely occurred.
    *   **Wipe the existing Persistent Volume:** Ensure the corrupted data is gone. Delete and recreate the PVC, or manually clear the data on the volume.
    *   Scale up the database StatefulSet/Deployment to 1 replica (or its minimum).
    *   Follow the documented restore procedure for your database using the chosen backup file (e.g., `psql < backup.sql`, `influx restore`, copy RDB file).
    *   Verify the restore was successful using database tools.

6.  **Restart Application:** Scale the application deployment back up:
    ```bash
    kubectl scale deployment <app-deployment> --replicas=<original-replicas> -n <app-namespace>
    ```

### Verification ✅

*   Database starts successfully without errors in logs.
*   Application connects to the database and functions correctly.
*   Data appears consistent (manual checks, application-level tests).
*   Run database integrity checks if available.

---

## Scenario 4: Security Incidents 🛡️⚔️

This covers suspected compromises, unauthorized access, or malware. **Speed and containment are critical.**

### Diagnosis 🤔

*   Alerts from security monitoring tools (IDS, vulnerability scanners).
*   Unusual network traffic patterns.
*   Unexpected system behavior (high resource usage, new processes, modified files).
*   Unauthorized logins detected.
*   Ransomware notes or system lockout.

### Prerequisites

*   Incident Response Plan (even a basic one).
*   Network isolation capabilities (firewall rules, VLAN changes).
*   Forensic tools (optional, for investigation).
*   Clean OS images and application configurations.
*   Offsite, verified backups.

### Step-by-Step Recovery 🛠️

1.  **Containment:**
    *   **ISOLATE:** Immediately disconnect affected systems from the network (change firewall rules, disconnect cables, disable virtual NICs). Prioritize critical systems and potential attacker entry points.
    *   Do **NOT** turn off affected machines immediately if forensic analysis is desired, but disconnect them.
    *   Change potentially compromised credentials (SSH keys, passwords, API tokens). Start with infrastructure/admin accounts.

2.  **Assessment:**
    *   Identify the scope of the incident: Which systems/services are affected? What data might be compromised?
    *   Determine the likely attack vector if possible.
    *   Review logs (system, application, firewall, Kubernetes audit logs) for suspicious activity *from a secure, separate machine*.

3.  **Eradication:**
    *   **WIPE AND REBUILD:** The safest approach is to assume affected systems are fully compromised. Reinstall the OS from a trusted source. Do **NOT** trust the existing system.
    *   Restore configurations from known-good backups (Git, Pulumi state verified *before* the incident).
    *   Restore application/database data from known-good, verified backups taken *before* the incident. Scan restored data for malware if possible.

4.  **Recovery:**
    *   Carefully bring rebuilt systems back online, monitoring closely.
    *   Re-apply security configurations and patches.
    *   Rotate all credentials again.

5.  **Post-Incident Analysis:**
    *   Document the incident, actions taken, and lessons learned.
    *   Improve security posture based on the attack vector (patch systems, improve firewall rules, enhance monitoring, implement MFA).

### Verification ✅

*   Affected systems are rebuilt from trusted sources.
*   Malicious activity is no longer detected.
*   Systems function correctly with restored data/configuration.
*   Security monitoring shows normal behavior.
*   Vulnerability that allowed the incident is patched/mitigated.

---

## Scenario 5: Catastrophic Failure (Full Rebuild) 💥💀

This covers a worst-case scenario where multiple nodes, the control plane, storage, and backups are simultaneously affected or lost (e.g., physical disaster, widespread ransomware without good backups).

### Diagnosis 🤔

*   Multiple nodes down and unrecoverable.
*   Control plane destroyed or inaccessible.
*   Primary storage (e.g., Ceph cluster, NFS server) failed.
*   Local backups destroyed or unavailable.
*   Offsite backups are the only remaining option.

### Prerequisites

*   Access to **offsite backups** (cloud storage, separate physical location).
*   Ability to provision new hardware or virtual infrastructure.
*   Complete infrastructure-as-code definitions (Pulumi, Ansible).
*   Documentation (like this!) available offline or accessible separately.
*   Patience and methodical approach.

### Step-by-Step Recovery 🛠️

1.  **Assess Offsite Backups:**
    *   Verify accessibility and integrity of offsite backups (configuration, application data, databases, etcd snapshots).
    *   Download necessary backups to a secure, temporary location.
    *   Decrypt backups if necessary.

2.  **Provision Core Infrastructure:**
    *   Set up new physical or virtual nodes.
    *   Install and configure the base OS on all nodes.
    *   Set up core networking.

3.  **Restore Kubernetes Control Plane:**
    *   Bootstrap a new control plane node using `kubeadm init`.
    *   **CRITICAL:** Restore etcd from the offsite backup onto this initial control plane node *before* joining other nodes. Follow the official etcd restore procedures carefully.
    *   Start the control plane components.
    *   Join other control plane nodes (if applicable), ensuring they use the restored etcd state.
    *   Join worker nodes.

4.  **Restore Infrastructure Configuration:**
    *   Use Pulumi (pointing to the new cluster, potentially using state from backup if available and relevant) or Ansible to redeploy:
        *   Storage infrastructure (CSI drivers, potentially new Ceph/NFS if needed).
        *   Networking components (Ingress controllers, MetalLB).
        *   Monitoring stack (Prometheus, Grafana).
        *   Other core services.

5.  **Restore Persistent Volumes:**
    *   Create PVCs as defined in your configurations.
    *   Restore data into the volumes from offsite backups. This depends heavily on the backup method:
        *   **Volume Snapshots:** Create volumes from snapshots (if snapshots were offloaded or the snapshot infrastructure is restored).
        *   **File-Level Backups:** Start temporary pods with the PVC mounted and use tools (`tar`, `psql`, `influx restore`, etc.) to restore data from downloaded backups.

6.  **Restore Applications:**
    *   Deploy applications using GitOps (Argo CD, Flux) or manually apply Kubernetes manifests restored from configuration backups.
    *   Ensure applications connect to restored databases/volumes correctly.

### Verification ✅

*   Kubernetes cluster is operational.
*   Storage is functional.
*   Core services (networking, monitoring) are running.
*   Applications are deployed and functional.
*   Data restored from offsite backups is accessible and appears consistent.
*   The homelab is back to a functional state, albeit potentially with data loss up to the last good offsite backup.

---
