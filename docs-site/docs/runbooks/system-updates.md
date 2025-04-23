# Runbook: Performing System Updates

This runbook details the process for updating core system components, including OS, Kubernetes, and critical applications, minimizing downtime and risk.

**Note:** Prefer using the automated `system-update.py` script where possible. This runbook covers manual steps or verification for the automated process.

## 1. Preparation

-   [ ] **Schedule Maintenance Window:** Communicate the planned window to users (if applicable).
-   [ ] **Review Release Notes:** Check changelogs for OS updates, Kubernetes versions, and major application updates for breaking changes or specific instructions.
-   [ ] **Check System Health:** Ensure the cluster and key services are stable and healthy before starting. Resolve any existing critical alerts.
-   [ ] **Backup:**
    -   Verify recent successful backups (configuration, application data, volumes).
    -   Consider taking fresh backups immediately before starting.
    -   Snapshot relevant persistent volumes.
-   [ ] **Prepare Rollback Plan:** Understand how to revert the changes (e.g., OS downgrade path, `kubectl rollout undo`, restoring backups).

## 2. OS Updates (Node by Node)

*Perform these steps one node at a time to maintain cluster availability.*

-   [ ] **Select Node:** Choose a worker node to update first.
-   [ ] **Drain Node:**
    ```bash
    kubectl drain <node-name> --ignore-daemonsets --delete-local-data
    ```
-   [ ] **Perform OS Update:**
    -   SSH into the node.
    -   Run package manager update commands (e.g., `sudo apt update && sudo apt upgrade -y` or `sudo dnf update -y`).
    -   Reboot the node if required by the update (`sudo reboot`).
-   [ ] **Verify Node Health:** After reboot, check node status, disk space, and basic connectivity.
-   [ ] **Uncordon Node:**
    ```bash
    kubectl uncordon <node-name>
    ```
-   [ ] **Monitor:** Observe the node and cluster health for a period before proceeding to the next node.
-   [ ] **Repeat:** Repeat for all worker nodes, then control plane nodes (if applicable, ensuring quorum is maintained).

## 3. Kubernetes Updates (Control Plane & Nodes)

*Refer to the official Kubernetes documentation and the specific distribution's (e.g., k3s, RKE2, kubeadm) upgrade guide.*

-   [ ] **Update Control Plane:** Follow the distribution's procedure to upgrade control plane components (`kube-apiserver`, `etcd`, `kube-scheduler`, `kube-controller-manager`). Usually involves updating the binary/package and restarting services, often one control plane node at a time.
-   [ ] **Update Kubelet/Kube-proxy on Nodes:**
    -   Drain the node (as in OS updates).
    -   Update the `kubelet` and `kube-proxy` packages/binaries on the node.
    -   Restart the `kubelet` service.
    -   Uncordon the node.
    -   Repeat for all nodes.
-   [ ] **Update CoreDNS, CNI, other Addons:** Update manifests or Helm charts for essential cluster addons as needed.

## 4. Application/Service Updates

-   [ ] **Identify Updates:** Check for new versions of deployed applications (Helm charts, container images).
-   [ ] **Update Strategy:** Choose update method (e.g., `helm upgrade`, `kubectl apply`, `kubectl rollout restart`, CI/CD pipeline).
-   [ ] **Perform Update:** Apply the update, respecting application-specific procedures (e.g., database schema migrations).
-   [ ] **Verify:** Check application logs, functionality, and relevant metrics post-update.
-   [ ] **Rollback (if necessary):** Use the chosen rollback mechanism if issues arise.

## 5. Post-Update Verification

-   [ ] **Cluster Health Check:**
    ```bash
    kubectl get nodes
    kubectl get pods --all-namespaces
    kubectl cluster-info
    ```
-   [ ] **Application Health Checks:** Test critical application functionality.
-   [ ] **Monitoring Review:** Check Grafana dashboards and Alertmanager for any new issues.
-   [ ] **Backup Verification:** Ensure backups are still running correctly after updates.
-   [ ] **Close Maintenance Window:** Communicate completion.
