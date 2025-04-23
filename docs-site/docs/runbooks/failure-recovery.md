# Runbook: Failure Recovery Scenarios

This runbook provides guidance for recovering from common failure scenarios. Refer to specific service documentation and the detailed `docs/recovery-procedures.md` for more complex situations.

**General Principles:**

*   **Identify Scope:** Determine if the issue affects a single pod, service, node, or the entire cluster.
*   **Check Monitoring:** Use Grafana, Prometheus, and logs as primary tools.
*   **Prioritize:** Address critical service failures first.
*   **Automated Recovery:** Leverage Kubernetes self-healing where possible (restart policies, readiness/liveness probes).
*   **Manual Intervention:** Follow these steps when automation fails or isn't applicable.

## Scenario 1: Pod Crash Loop (`CrashLoopBackOff`)

1.  **Identify Pod:** `kubectl get pods -n <namespace> | grep CrashLoopBackOff`
2.  **Check Logs:** `kubectl logs <pod-name> -n <namespace> -p` (use `-p` for previous container logs). Look for immediate errors upon startup.
3.  **Describe Pod:** `kubectl describe pod <pod-name> -n <namespace>`. Check events, container exit codes, resource limits, volume mounts, image pull status.
4.  **Common Causes & Fixes:**
    *   **Configuration Error:** Incorrect environment variables, config file syntax error -> Fix ConfigMap/Secret, restart deployment (`kubectl rollout restart deployment/...`).
    *   **Application Bug:** Error in application code -> Check application logs deeply, potentially requires code fix and image rebuild/redeploy.
    *   **Resource Exhaustion:** OOMKilled (check `describe pod`) -> Increase memory limits. High CPU -> Increase CPU limits/requests.
    *   **Failed Liveness/Readiness Probe:** Application not starting fast enough or probe misconfigured -> Adjust probe settings (timeouts, initial delays) or fix application startup.
    *   **Dependency Not Ready:** Application can't connect to DB, MQ, etc. -> Check dependency status.
    *   **Permissions Issue:** Volume mount permissions, file system errors -> Check volume permissions, PV/PVC status.

## Scenario 2: Service Unreachable

1.  **Verify Pods:** Check if pods backing the service are running: `kubectl get pods -n <namespace> -l <service-selector-labels>`. Are they Ready?
2.  **Check Service Definition:** `kubectl get svc <service-name> -n <namespace> -o yaml`. Verify selector matches pod labels, correct ports are defined.
3.  **Check Endpoints:** `kubectl get endpoints <service-name> -n <namespace>`. Does it list the IPs of the ready pods? If not, the selector might be wrong or pods aren't ready.
4.  **Check Ingress (if applicable):** `kubectl get ingress <ingress-name> -n <namespace> -o yaml`. Verify rules, backend service name/port, TLS settings. Check ingress controller logs.
5.  **Check Network Policies:** `kubectl get networkpolicy -n <namespace>`. Are there policies blocking traffic to the service or from the client?
6.  **Test Connectivity:**
    *   From within the cluster: `kubectl run tmp-shell --rm -i --tty --image=busybox -- /bin/sh`, then `wget -O- http://<service-name>.<namespace>:<port>` or `nc -vz <pod-ip> <port>`.
    *   From outside (if applicable): `curl <external-ip-or-dns>:<port>`.
7.  **Check CNI:** Look for errors in CNI daemonset logs on relevant nodes.

## Scenario 3: Node `NotReady` or Unresponsive

1.  **Identify Node:** `kubectl get nodes`.
2.  **Check Kubelet Status:** SSH into the affected node. Check `kubelet` service status: `sudo systemctl status kubelet` or `sudo journalctl -u kubelet -f`. Look for errors (network issues, PLEG issues, config errors). Restart if necessary: `sudo systemctl restart kubelet`.
3.  **Check Container Runtime:** Check runtime status (e.g., `sudo systemctl status containerd`). Restart if necessary. Check runtime logs.
4.  **Check Resources:** Check CPU, memory, disk usage on the node (`top`, `htop`, `df -h`). Is the node overloaded or out of disk space?
5.  **Check Network:** Verify network connectivity from the node to the control plane API server IP/port. Check DNS resolution.
6.  **Drain and Reboot (if necessary):** If the cause isn't obvious or fixable quickly:
    *   `kubectl drain <node-name> --ignore-daemonsets --delete-local-data` (run from a working node).
    *   SSH into the node and `sudo reboot`.
    *   After reboot, monitor `kubectl get nodes` and uncordon: `kubectl uncordon <node-name>`.
7.  **Node Rebuild (Worst Case):** If the node OS is corrupted or unrecoverable, follow the "Adding New Nodes" runbook to provision a replacement and remove the failed node (`kubectl delete node <failed-node-name>`).

## Scenario 4: Persistent Volume Issues

1.  **Identify PV/PVC:** `kubectl get pvc -n <namespace>`, `kubectl get pv`. Check STATUS (Bound, Pending, Failed).
2.  **Describe PV/PVC:** `kubectl describe pvc <pvc-name> -n <namespace>`, `kubectl describe pv <pv-name>`. Look for events indicating provisioning errors, attach/detach problems, capacity issues.
3.  **Check Storage Provisioner:** Check logs for the CSI driver pods or internal provisioner responsible for the StorageClass used by the PVC.
4.  **Check Underlying Storage:** Investigate the storage system itself (NFS server, Ceph cluster, cloud provider storage) for issues (disk full, network problems, service down).
5.  **Volume Attach/Mount Errors:** Check `kubelet` logs on the node where the pod using the PVC is scheduled (or trying to schedule). Look for mount errors.
6.  **Restore from Snapshot/Backup:** If data corruption is suspected or the volume is unrecoverable, restore from the latest volume snapshot or data backup. Follow specific restore procedures.

## Scenario 5: Control Plane Issues (Advanced)

*Requires deeper Kubernetes knowledge. Proceed with caution.*

1.  **API Server Down:** Check `kube-apiserver` pod logs on control plane nodes. Check dependencies (etcd). Check resource usage on control plane nodes.
2.  **etcd Issues:** Check etcd pod logs. Verify cluster health (`etcdctl endpoint health`). Check disk I/O performance on etcd nodes. Consider etcd backup/restore procedures if corruption occurs.
3.  **Scheduler/Controller Manager Issues:** Check `kube-scheduler` and `kube-controller-manager` pod logs on control plane nodes. Look for errors related to scheduling or resource management.

*Refer to `docs/recovery-procedures.md` for detailed steps on complex scenarios like full rebuilds.*
