# 🔒 Homelab Security Maintenance Guide 🔒

**Keeping your homelab secure isn't a one-time task, it's an ongoing commitment!** 💪 This guide outlines procedures and schedules to help maintain a strong security posture for your homelab environment. Regular maintenance helps protect against vulnerabilities, misconfigurations, and unauthorized access.

## 🌟 Core Security Pillars 🌟

Our maintenance strategy revolves around these key areas:

1.  **Vulnerability Scanning & Patching** 🛡️: Finding and fixing known weaknesses.
2.  **Configuration Reviews** ⚙️: Ensuring settings are secure and optimal.
3.  **Credential & Access Management** 🔑: Controlling who and what can access resources.
4.  **Security Monitoring & Logging** 🕵️: Detecting and responding to suspicious activity.
5.  **Staying Informed** 📰: Keeping up-to-date with threats and advisories.

---

## 1. Vulnerability Scanning & Patching 🛡️

**Why?** Software vulnerabilities are constantly discovered. Scanning helps identify them in your OS, containers, and applications, while patching fixes them before they can be exploited.

### 🔍 Scanning Procedures

*   **Container Images:** Use tools like **Trivy** or **Clair** to scan container images for known CVEs (Common Vulnerabilities and Exposures). Integrate this into CI/CD pipelines if possible.
    *   **Schedule:** Weekly (automated) or before deploying new/updated images.
    *   **Automation Example (Trivy):**
        ```bash
        # Scan a specific image
        trivy image --severity HIGH,CRITICAL my-registry/my-app:latest

        # Scan all running images in the cluster (requires Trivy operator or similar setup)
        # Or script iterating through `kubectl get pods -A -o jsonpath='{.items[*].spec.containers[*].image}'`
        ```
*   **Operating System:** Regularly check for available OS package updates.
    *   **Schedule:** Weekly (automated check).
    *   **Automation Example (Debian/Ubuntu):**
        ```bash
        # Run on each node via SSH or Ansible
        sudo apt update
        sudo apt list --upgradable
        # Consider tools like `apticron` for notifications
        ```
*   **Kubernetes Components:** Check for vulnerabilities in Kubernetes components themselves (API Server, etcd, kubelet, etc.). Often tied to Kubernetes version updates.
*   **Application Dependencies:** Use language-specific tools (`npm audit`, `pip check`, `mvn dependency-check`) to scan application code dependencies. Integrate into development/CI pipelines.

### 🩹 Patching Procedures

*   **Prioritization:** Focus on critical and high-severity vulnerabilities first, especially those with known exploits.
*   **Testing:** **ALWAYS** test patches in a staging/development environment if possible before applying to your main homelab services, especially for critical components like Kubernetes or databases.
*   **OS Patching:**
    *   Use the `system-update.py` script (or Ansible) for coordinated OS package updates across nodes.
    *   **Schedule:** Apply security patches weekly/bi-weekly after review. Apply critical patches ASAP.
*   **Kubernetes Patching:**
    *   Follow the official Kubernetes upgrade procedures (`kubeadm upgrade`). Use the `system-update.py` script for orchestration.
    *   **Schedule:** Apply patch releases (e.g., 1.28.x -> 1.28.y) monthly/quarterly after testing. Plan minor version upgrades (e.g., 1.28 -> 1.29) carefully.
*   **Container Image Patching:**
    *   Rebuild application images using updated base images containing OS patches.
    *   Update application dependencies and rebuild images.
    *   Use the `system-update.py` script (or GitOps tools like Argo CD Image Updater / Flux) to roll out updated images.
    *   **Schedule:** Weekly/Bi-weekly for base images, driven by vulnerability scans for dependencies.
*   **Patching Workflow:**

    ```mermaid
    graph TD
        A[Scan for Vulnerabilities] --> B{Prioritize Patches};
        B -- Critical/High --> C{Test Patch (Staging)};
        B -- Medium/Low --> D[Schedule Patch];
        C -- Test OK --> E[Apply Patch (Production)];
        C -- Test Failed --> F[Investigate/Fix/Defer];
        D --> C;
        E --> G[Verify Fix];
        F --> A;
        G --> A;
    ```

---

## 2. Security Configuration Reviews ⚙️

**Why?** Default configurations aren't always secure. Regularly reviewing settings ensures they align with security best practices and haven't drifted over time.

### 📋 Review Areas & Tools

*   **Kubernetes Cluster:**
    *   **RBAC:** Review Roles, ClusterRoles, RoleBindings, ClusterRoleBindings. Ensure least privilege. (`kubectl get rolebindings,clusterrolebindings -A -o wide`)
    *   **Network Policies:** Verify policies correctly restrict traffic between pods/namespaces. (`kubectl get networkpolicies -A`)
    *   **Pod Security Admission/Policies:** Ensure appropriate security contexts and restrictions are applied.
    *   **Secrets Management:** Check how secrets are stored and accessed (e.g., using Sealed Secrets, Vault, native Secrets).
    *   **Tools:** Use **kube-bench** to check against CIS Benchmarks, **kubescape** for broader security posture scanning.
    *   **Schedule:** Quarterly or after significant cluster changes.
*   **Operating System (Nodes):**
    *   **Firewall Rules:** Check `iptables`, `nftables`, or `ufw` rules. Ensure only necessary ports are open.
    *   **SSH Configuration:** Review `/etc/ssh/sshd_config`. Disable root login, enforce key-based auth, use strong ciphers/MACs.
    *   **User Accounts:** Audit local user accounts and sudo privileges.
    *   **Schedule:** Bi-Annually or after node provisioning/changes.
*   **Applications:**
    *   Review application-specific security settings (authentication methods, API rate limiting, input validation).
    *   Check how applications handle secrets.
    *   **Schedule:** Annually or during application updates.

---

## 3. Credential & Access Management 🔑

**Why?** Compromised credentials are a primary attack vector. Regular rotation and access audits limit the window of opportunity for attackers and enforce the principle of least privilege.

### 🔄 Credential Rotation

*   **Passwords:** Rotate passwords for user accounts (OS, Grafana, etc.) and service accounts where applicable. Use strong, unique passwords (consider a password manager).
    *   **Schedule:** Every 90-180 days.
*   **API Keys/Tokens:** Rotate API keys for services (cloud providers, external APIs, internal service tokens like InfluxDB tokens).
    *   **Schedule:** Every 60-90 days or based on provider recommendations.
*   **SSH Keys:** Consider rotating SSH keys periodically, especially if exposure is suspected. Ensure old keys are removed from `authorized_keys` files.
    *   **Schedule:** Annually or as needed.
*   **Certificates:** Monitor expiration dates for TLS certificates (Ingress, internal CAs, etcd, Kubernetes components).
    *   **Kubernetes:** Use `sudo kubeadm certs check-expiration` on control plane nodes. Renew using `kubeadm certs renew`.
    *   **Ingress:** Use `cert-manager` for automated renewal from Let's Encrypt or other CAs.
    *   **Schedule:** Monitor monthly, renew well before expiration (e.g., 30 days prior).

### 🧐 Access Control Audits

*   **User Accounts:** Review all active user accounts across systems (OS nodes, Kubernetes RBAC, Grafana, databases, etc.). Disable or remove unused accounts.
*   **Group Memberships:** Check memberships in privileged groups (e.g., `sudo`, `docker`, K8s `cluster-admin`).
*   **Kubernetes RBAC:** Audit RoleBindings and ClusterRoleBindings. Verify permissions granted are necessary for the associated user/service account.
    *   `kubectl get rolebindings,clusterrolebindings -A -o wide`
    *   Tools like `rakkess` or `kubectl-who-can` can help visualize permissions.
*   **SSH Access:** Review `~/.ssh/authorized_keys` files on all nodes. Remove keys for users/systems that no longer require access.
*   **API Token Usage:** If possible, audit the usage logs of API tokens to ensure they are only used by expected clients/services.
*   **Schedule:** Quarterly.

*   **Audit Workflow:**

    ```mermaid
    graph TD
        A[List Accounts/Roles/Keys] --> B{Review Necessity};
        B -- Needed --> C{Verify Permissions};
        B -- Not Needed --> D[Disable/Remove Account/Key];
        C -- Permissions OK --> E[Document Review];
        C -- Over-Privileged --> F[Reduce Permissions (Least Privilege)];
        F --> E;
        D --> E;
        E --> A; # Continuous cycle
    ```

---

## 4. Security Monitoring & Logging 🕵️

**Why?** You can't protect against what you can't see. Monitoring and logging help detect suspicious activities, failed logins, policy violations, and active attacks in near real-time.

### 📊 Monitoring & Alerting

*   **Prometheus Alerts:** Review and tune alert rules defined in `homelab-observability/prometheus/rules/alerting-rules.yml`. Ensure alerts cover:
    *   Node resource exhaustion (CPU, Mem, Disk).
    *   Node down/unresponsive.
    *   Kubernetes component health (API server, etcd).
    *   Pod crashes/restarts, pending pods.
    *   Certificate expiration (`cert-manager` metrics).
    *   Security-specific metrics (e.g., failed logins if exposed via an exporter).
*   **Runtime Security:** Consider tools like **Falco** to detect suspicious behavior *inside* containers and on nodes based on system calls. Define and tune Falco rules.
*   **Schedule:** Review alert configuration quarterly. Respond to triggered alerts promptly!

### 📜 Logging

*   **Centralized Logging:** Ensure logs from nodes (syslog, journald), Kubernetes components (via cluster logging agent like Fluentd/Loki), and applications are collected centrally (e.g., Loki, Elasticsearch).
*   **Kubernetes Audit Logs:** Enable and collect Kubernetes audit logs. These provide a detailed record of requests to the API server (who did what, when). Configure an appropriate audit policy.
*   **Log Review:** Regularly review key logs for anomalies:
    *   Authentication logs (`/var/log/auth.log`, application login events).
    *   Firewall logs (denied connections).
    *   Kubernetes audit logs (unauthorized requests, excessive permissions usage).
    *   Ingress controller logs (suspicious request patterns, 4xx/5xx errors).
*   **Schedule:** Review key security logs weekly. Perform deeper dives monthly or during incident investigation.

---

## 5. Staying Informed 📰

**Why?** The threat landscape is constantly evolving. Staying informed about new vulnerabilities, attack techniques, and security best practices is crucial.

### 📚 Information Sources

*   **CVE Databases:**
    *   [MITRE CVE List](https://cve.mitre.org/)
    *   [NVD (National Vulnerability Database)](https://nvd.nist.gov/)
*   **Vendor Security Advisories:**
    *   Kubernetes: [Security Announcements Google Group](https://groups.google.com/g/kubernetes-security-announce), [Security Advisories on GitHub](https://github.com/kubernetes/kubernetes/issues?q=is%3Aissue+label%3Asecurity)
    *   OS Distribution (e.g., Ubuntu Security Notices, Debian Security Advisories).
    *   Key Software Vendors (e.g., Nginx, PostgreSQL, Redis, application frameworks).
*   **Security News & Blogs:** Follow reputable security news sites (e.g., The Hacker News, Bleeping Computer) and blogs from security researchers or companies.
*   **Homelab Communities:** Forums and communities often discuss security issues relevant to homelab setups.

### ⚡ Taking Action

*   When a relevant vulnerability or advisory is published:
    1.  **Assess Applicability:** Does it affect software versions you are running?
    2.  **Assess Risk:** How severe is it? Is there a known exploit? What is the potential impact on your homelab?
    3.  **Plan Mitigation/Patching:** Prioritize based on risk. Apply patches following the procedures above. Implement workarounds if patches aren't available yet.
*   **Schedule:** Dedicate time weekly (e.g., 30 minutes) to review key sources.

---

## 🗓️ Sample Maintenance Schedule 🗓️

This is a template; adjust based on your risk tolerance and time availability.

| Frequency      | Tasks                                                                                                                               | Notes / Tools                                       |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| **Daily**      | Review Critical Alerts                                                                                                              | Grafana, Alertmanager, Notification Channels        |
| **Weekly**     | Review Security Logs (Auth, Firewall, Ingress)                                                                                      | Loki/EFK, `journalctl`, `kubectl logs`              |
|                | Check for OS Security Updates                                                                                                       | `apt list --upgradable`, `apticron`                 |
|                | Run Container Image Scans (Automated)                                                                                               | Trivy, Clair                                        |
|                | Review Security News/Advisories                                                                                                     | RSS Feeds, Mailing Lists                            |
|                | Apply OS Security Patches (after review)                                                                                            | `system-update.py`, Ansible                         |
| **Monthly**    | Review Non-Critical Alerts & Monitoring Dashboards                                                                                  | Grafana, Prometheus                                 |
|                | Check Kubernetes Patch Releases                                                                                                     | Kubernetes Announcements                            |
|                | Monitor Certificate Expiration                                                                                                      | `kubeadm certs check-expiration`, `cert-manager`    |
| **Quarterly**  | Perform Access Control Audit (Users, Groups, RBAC, SSH Keys)                                                                        | `kubectl`, `rakkess`, Manual Review                 |
|                | Review Kubernetes Security Configuration                                                                                            | `kube-bench`, `kubescape`, Manual Review            |
|                | Rotate API Keys/Tokens                                                                                                              | Service-specific procedures                         |
|                | Review Alerting Rules & Monitoring Config                                                                                           | Prometheus config, Alertmanager config              |
|                | Apply Kubernetes Patch Releases (after testing)                                                                                     | `system-update.py`, `kubeadm upgrade`               |
| **Bi-Annually**| Review OS Node Security Configuration (Firewall, SSH)                                                                               | Manual Review, Config files                         |
| **Annually**   | Review Application Security Configurations                                                                                          | Manual Review                                       |
|                | Rotate SSH Keys (Optional)                                                                                                          | `ssh-keygen`                                        |
|                | Review this Security Maintenance Guide & Update Procedures                                                                          | This document!                                      |
| **As Needed**  | Apply Critical Patches (OS, K8s, Apps)                                                                                              | ASAP after vulnerability disclosure & testing       |
|                | Respond to Security Incidents                                                                                                       | Follow Incident Response Plan / Recovery Procedures |
|                | Update Components after Security Advisories                                                                                         | Based on assessment                                 |

---

## ✨ Conclusion ✨

Security is a journey, not a destination. By implementing and consistently following these maintenance procedures, you significantly reduce the risk profile of your homelab. Stay vigilant, stay informed, and adapt your practices as your homelab and the threat landscape evolve! 🚀
