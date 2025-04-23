# Runbook: Security Incident Response

This runbook provides a framework for responding to potential security incidents within the homelab environment. Adapt steps based on the specific nature of the incident.

**Phases of Incident Response:**

1.  **Preparation:** (Ongoing) Maintain updated systems, backups, monitoring, and this plan.
2.  **Identification:** Detect a potential security event.
3.  **Containment:** Limit the scope and magnitude of the incident.
4.  **Eradication:** Remove the threat actor/malware/vulnerability.
5.  **Recovery:** Restore affected systems to normal operation.
6.  **Post-Incident Activity (Lessons Learned):** Analyze the incident and improve defenses.

---

## 1. Identification: Detecting an Incident

*Sources of identification:*

*   **Alerts:** Security-specific alerts from Prometheus/Alertmanager (e.g., Falco alerts, failed logins, policy violations).
*   **Monitoring:** Unusual spikes in network traffic, resource usage, unexpected processes.
*   **Logs:** Suspicious entries in system logs, application logs, audit logs (Kubernetes API audit, SSH logs).
*   **Scanning Tools:** Findings from vulnerability scanners or malware scanners.
*   **External Notification:** Notification from an external party.
*   **Manual Discovery:** Observing unexpected system behavior.

**Initial Steps:**

-   [ ] **Verify:** Is this a genuine incident or a false positive? Check corroborating evidence.
-   [ ] **Document:** Start an incident log immediately. Record timestamps, observations, actions taken, and findings. Use a secure, potentially offline method if core systems might be compromised.
-   [ ] **Assess Scope (Initial):** Which systems, services, or data appear to be affected? What is the potential impact?
-   [ ] **Notify (Internal):** Inform relevant parties within the homelab management structure (if applicable).

## 2. Containment: Limiting the Damage

*Goal: Prevent the incident from spreading further.*

-   [ ] **Isolate Affected Systems:**
    *   **Network Isolation:** Apply stricter network policies (`kubectl apply -f strict-policy.yaml`), modify firewall rules (iptables, nftables, pf), or physically disconnect network cables for critical physical nodes if necessary and feasible.
    *   **Isolate Pods:** Scale down affected deployments (`kubectl scale deployment <name> --replicas=0`), delete compromised pods (note: they might restart; consider temporary taints or node isolation).
-   [ ] **Change Credentials:**
    *   Rotate potentially compromised user passwords.
    *   Rotate SSH keys.
    *   Rotate Kubernetes service account tokens.
    *   Rotate API keys and secrets (application, cloud provider).
-   [ ] **Block Malicious IPs:** Use firewall rules or network policies to block attacker IP addresses identified from logs.
-   [ ] **Preserve Evidence:**
    *   Take snapshots of affected volumes *before* making significant changes.
    *   Copy relevant logs to a secure, separate location.
    *   Consider memory dumps of affected processes/nodes if forensic analysis is intended (advanced).

## 3. Eradication: Removing the Threat

*Goal: Eliminate the root cause of the incident.*

-   [ ] **Identify Root Cause:** Analyze logs, system state, and configurations to understand how the compromise occurred (e.g., exploited vulnerability, weak credentials, misconfiguration).
-   [ ] **Remove Malicious Code/Actors:**
    *   Delete malware executables.
    *   Remove unauthorized user accounts or SSH keys.
    *   Terminate unauthorized processes.
    *   Revert unauthorized configuration changes.
-   [ ] **Patch Vulnerabilities:** Apply necessary security patches to the OS, applications, and Kubernetes components that were exploited.
-   [ ] **Rebuild Systems (if necessary):** If systems are deeply compromised or malware is difficult to remove, rebuild them from a known-good state (clean OS install, redeploy applications from source/image). **Do not restore from a potentially compromised backup without careful vetting.**

## 4. Recovery: Restoring Services

*Goal: Bring affected systems back online safely.*

-   [ ] **Restore from Known-Good Backups:**
    *   Restore data from backups taken *before* the incident occurred.
    *   Restore configurations from version control or backups.
-   [ ] **Re-deploy Applications:** Deploy clean versions of applications using CI/CD or manifests.
-   [ ] **Verify System Integrity:**
    *   Scan rebuilt/restored systems for vulnerabilities or malware remnants.
    *   Perform functional testing of restored services.
-   [ ] **Gradually Re-enable Connectivity:** Remove containment measures (network isolation, strict policies) carefully while monitoring closely.
-   [ ] **Monitor Closely:** Increase monitoring scrutiny on recovered systems for any signs of reinfection or residual issues.

## 5. Post-Incident Activity (Lessons Learned)

*Goal: Improve security posture and incident response capabilities.*

-   [ ] **Conduct Post-Mortem:** Analyze the incident timeline, root cause, effectiveness of the response, and impact.
-   [ ] **Identify Improvements:**
    *   What monitoring or alerting could have detected this sooner?
    *   What security controls could have prevented it? (e.g., stronger passwords, MFA, network segmentation, patching).
    *   How could the response process be faster or more effective?
-   [ ] **Update Documentation:** Revise security policies, procedures, and this runbook based on findings.
-   [ ] **Implement Changes:** Create and track tasks to implement identified improvements (e.g., deploy new security tools, update configurations, conduct training).
-   [ ] **Communicate Findings:** Share lessons learned with relevant parties.
