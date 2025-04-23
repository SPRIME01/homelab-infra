# Runbook: Adding New Nodes to the Cluster

This runbook describes the process for adding a new physical or virtual machine as a worker node to the Kubernetes cluster.

## 1. Node Preparation

-   [ ] **Provision Hardware/VM:** Set up the physical server or virtual machine.
-   [ ] **Install Operating System:** Install the chosen Linux distribution (matching existing nodes if possible).
-   [ ] **Basic OS Configuration:**
    -   Set hostname.
    -   Configure static IP address or DHCP reservation.
    -   Ensure SSH access is configured and secured.
    -   Update the OS: `sudo apt update && sudo apt upgrade -y` or `sudo dnf update -y`.
    -   Install necessary base packages (e.g., `curl`, `vim`, `git`, container runtime prerequisites).
-   [ ] **Install Container Runtime:** Install containerd, Docker, or CRI-O, matching the runtime used by the existing cluster. Configure it according to Kubernetes requirements.
-   [ ] **Configure Firewall:** Ensure necessary ports are open for Kubernetes components (kubelet, CNI, NodePorts). Refer to Kubernetes and CNI documentation.
-   [ ] **Disable Swap:**
    ```bash
    sudo swapoff -a
    # Persist by commenting out swap entry in /etc/fstab
    sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
    ```
-   [ ] **Kernel Modules & Settings:** Ensure required kernel modules are loaded (e.g., `br_netfilter`, `overlay`) and sysctl settings are applied (e.g., `net.bridge.bridge-nf-call-iptables=1`, `net.ipv4.ip_forward=1`).
    ```bash
    # Example: Create /etc/modules-load.d/k8s.conf
    overlay
    br_netfilter

    # Example: Create /etc/sysctl.d/k8s.conf
    net.bridge.bridge-nf-call-ip6tables = 1
    net.bridge.bridge-nf-call-iptables = 1
    net.ipv4.ip_forward                 = 1

    # Apply settings
    sudo sysctl --system
    ```

## 2. Kubernetes Installation (Agent/Worker)

*This depends heavily on the Kubernetes distribution (k3s, RKE2, kubeadm).*

-   **For k3s:**
    -   [ ] Get the join token from the server node (`sudo cat /var/lib/rancher/k3s/server/node-token`).
    -   [ ] Get the server IP address.
    -   [ ] Run the k3s agent installation script on the new node:
        ```bash
        curl -sfL https://get.k3s.io | K3S_URL=https://<server_ip>:6443 K3S_TOKEN=<node_token> sh -
        ```
-   **For RKE2:**
    -   [ ] Follow RKE2 documentation for adding agent nodes, typically involving creating a config file (`/etc/rancher/rke2/config.yaml`) pointing to the server and providing the token, then enabling/starting the `rke2-agent` service.
-   **For kubeadm:**
    -   [ ] Generate a join command on a control plane node: `kubeadm token create --print-join-command`.
    -   [ ] Run the printed join command on the new worker node using `sudo`.

## 3. Verification

-   [ ] **Check Node Status:** On a control plane node, verify the new node appears and becomes `Ready`:
    ```bash
    kubectl get nodes -o wide
    # Wait for STATUS to change from NotReady to Ready
    ```
-   [ ] **Check Agent Logs:** If the node doesn't become ready, check the agent logs on the new node:
    *   k3s: `sudo journalctl -u k3s-agent -f`
    *   RKE2: `sudo journalctl -u rke2-agent -f`
    *   kubeadm/kubelet: `sudo journalctl -u kubelet -f`
-   [ ] **Network Connectivity:** Verify pods can be scheduled on the new node and communicate with pods on other nodes. Deploy a test pod or check CNI pod logs on the new node.
    ```bash
    # Example test pod
    kubectl run test-pod --image=nginx --node-name=<new-node-name>
    kubectl exec test-pod -- curl <service-ip-on-another-node>
    kubectl delete pod test-pod
    ```

## 4. Post-Join Configuration

-   [ ] **Apply Labels/Taints:** Add any necessary labels (e.g., for node selectors, topology) or taints.
    ```bash
    kubectl label node <new-node-name> key=value
    kubectl taint node <new-node-name> key=value:Effect
    ```
-   [ ] **Monitoring Agent:** Ensure monitoring agents (e.g., Prometheus `node-exporter`, OpenTelemetry Collector DaemonSet) are automatically deployed and running on the new node. Verify targets appear in Prometheus.
-   [ ] **Logging Agent:** Ensure logging agents (e.g., Promtail, Fluentd DaemonSet) are running on the new node and logs are being collected.
-   [ ] **Storage Configuration:** If using node-specific local storage provisioners, configure storage on the new node.
-   [ ] **Update Documentation:** Add the new node to inventory lists and architecture diagrams.
