import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx"; // Using kubernetesx for simplified NetworkPolicy

// Define standard Ray ports
const RAY_PORTS = {
    dashboard: 8265,
    client: 10001,
    gcsServer: 6379,
    redisPrimary: 6380, // Example, confirm actual ports used by your Ray version/config
    // Add other Ray internal ports as needed (e.g., object manager, node manager)
    // These often use dynamic ranges but might have configurable start points.
    // NetworkPolicies might need to allow broad ranges between Ray pods if defaults are used.
};

// Define arguments for the RayNetworking component
interface RayNetworkingArgs {
    namespace: pulumi.Input<string>;
    /** Labels applied ONLY to the Ray head pod. */
    headPodLabels: pulumi.Input<{ [key: string]: string }>;
    /** Labels applied ONLY to Ray worker pods. */
    workerPodLabels: pulumi.Input<{ [key: string]: string }>;
    /** Labels applied to ALL Ray pods (head and workers) for service discovery and broad policies. */
    allPodsLabels: pulumi.Input<{ [key: string]: string }>;
    /** Optional: External hostname for Ray Dashboard Ingress. */
    externalDashboardHostname?: pulumi.Input<string>;
    /** Optional: Specify pod/namespace selectors for other allowed ingress sources (e.g., client applications). */
    allowedIngressPeers?: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Specify pod/namespace selectors for allowed egress destinations (e.g., external data sources). */
    allowedEgressPeers?: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Namespace where the ingress controller runs (for NetworkPolicy). Defaults to 'ingress-nginx'. */
    ingressControllerNamespace?: pulumi.Input<string>;
    /** Optional: Namespace where Prometheus runs (for NetworkPolicy). Defaults to 'monitoring'. */
    monitoringNamespace?: pulumi.Input<string>;
    /** Optional: Name of the TLS secret for Dashboard Ingress. Assumes it exists in the same namespace. */
    tlsSecretName?: pulumi.Input<string>;
}

export class RayNetworking extends pulumi.ComponentResource {
    public readonly headService: k8s.core.v1.Service;
    public readonly discoveryService: k8s.core.v1.Service;
    public readonly networkPolicy?: kx.NetworkPolicy; // Combined policy for simplicity
    public readonly dashboardIngress?: k8s.networking.v1.Ingress;
    public readonly serviceMonitor?: k8s.apiextensions.CustomResource; // Assuming Prometheus Operator

    constructor(name: string, args: RayNetworkingArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:RayNetworking", name, args, opts);

        const resourceOpts = { parent: this, provider: opts?.provider };
        const monitoringNamespace = args.monitoringNamespace ?? "monitoring";
        const ingressControllerNamespace = args.ingressControllerNamespace ?? "ingress-nginx";

        // Service for the Ray Head Node (ClusterIP)
        // Exposes key ports for internal cluster access (e.g., workers connecting to GCS)
        // and potentially external access (Dashboard, Client).
        this.headService = new k8s.core.v1.Service(`${name}-head-svc`, {
            metadata: {
                name: `${name}-ray-head`,
                namespace: args.namespace,
                labels: args.headPodLabels,
            },
            spec: {
                selector: args.headPodLabels,
                ports: [
                    { name: "dashboard", port: RAY_PORTS.dashboard, targetPort: RAY_PORTS.dashboard },
                    { name: "client", port: RAY_PORTS.client, targetPort: RAY_PORTS.client },
                    { name: "gcs", port: RAY_PORTS.gcsServer, targetPort: RAY_PORTS.gcsServer },
                    // Add other ports exposed by the head node if needed
                ],
                type: "ClusterIP",
            },
        }, resourceOpts);

        // Headless Service for Service Discovery
        // Allows pods (workers and head) to discover each other via DNS lookup
        // (e.g., `<pod-name>.<service-name>.<namespace>.svc.cluster.local`). Crucial for Ray cluster formation.
        this.discoveryService = new k8s.core.v1.Service(`${name}-discovery-svc`, {
            metadata: {
                name: `${name}-ray-discovery`,
                namespace: args.namespace,
            },
            spec: {
                selector: args.allPodsLabels, // Selects ALL pods (head and workers)
                ports: [
                    // A dummy port is required by Kubernetes for Headless services
                    { name: "dummy", port: 12345, targetPort: 12345 }
                ],
                clusterIP: "None", // Makes it a headless service
                publishNotReadyAddresses: true, // Important for stateful components like Ray GCS during startup/failover
            },
        }, resourceOpts);


        // Network Policies for secure access
        // Security: Restrict traffic flow between head, workers, and external services.
        // Note: Ray uses a range of ports for internal communication. A simple approach
        // is to allow all traffic between pods with the `allPodsLabels`. For stricter
        // policies, you'd need to identify and allow specific port ranges used by Ray components.
        this.networkPolicy = new kx.NetworkPolicy(`${name}-netpol`, {
            metadata: {
                name: `${name}-ray-netpol`,
                namespace: args.namespace,
            },
            spec: {
                // Apply policy to all Ray pods (head and workers)
                podSelector: { matchLabels: args.allPodsLabels },
                policyTypes: ["Ingress", "Egress"],
                ingress: [
                    // Allow traffic FROM other Ray pods (head <-> worker, worker <-> worker)
                    {
                        from: [{ podSelector: { matchLabels: args.allPodsLabels } }],
                        // No specific ports needed here if allowing all internal Ray traffic
                    },
                    // Allow traffic FROM Monitoring (Prometheus) to Head Node Dashboard/Metrics port
                    {
                        from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": monitoringNamespace } } }],
                        ports: [{ protocol: "TCP", port: RAY_PORTS.dashboard }],
                        // Apply this rule only to the head pod
                        podSelector: { matchLabels: args.headPodLabels },
                    },
                    // Allow traffic FROM Ingress Controller (for Dashboard/Client access) to Head Node
                    ...(args.externalDashboardHostname ? [{
                        from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": ingressControllerNamespace } } }],
                        ports: [
                            { protocol: "TCP", port: RAY_PORTS.dashboard },
                            // Add client port if exposing externally: { protocol: "TCP", port: RAY_PORTS.client }
                        ],
                        // Apply this rule only to the head pod
                        podSelector: { matchLabels: args.headPodLabels },
                    }] : []),
                    // Allow traffic FROM specified external peers (e.g., client apps)
                    ...(args.allowedIngressPeers ? [{
                        from: args.allowedIngressPeers,
                        ports: [ // Define ports needed for interaction (e.g., Client port)
                            { protocol: "TCP", port: RAY_PORTS.client },
                            // Add other ports if needed
                        ],
                         // Potentially apply only to head pod depending on interaction pattern
                         podSelector: { matchLabels: args.headPodLabels },
                    }] : []),
                ],
                egress: [
                    // Allow DNS resolution
                    { ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] },
                    // Allow traffic TO other Ray pods (head <-> worker, worker <-> worker)
                    {
                        to: [{ podSelector: { matchLabels: args.allPodsLabels } }],
                        // No specific ports needed here if allowing all internal Ray traffic
                    },
                    // Allow traffic TO specified external peers (e.g., data sources)
                    ...(args.allowedEgressPeers ? [{
                        to: args.allowedEgressPeers,
                        // Define ports needed (e.g., 443 for HTTPS)
                        // ports: [{ protocol: "TCP", port: 443 }]
                    }] : []),
                    // Allow egress to Kubernetes API server (often needed by operators/controllers)
                    // { to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [{ protocol: "TCP", port: 443 }] } // Example, refine based on actual API server access needs
                ],
            },
        }, resourceOpts);


        // External Access for Ray Dashboard via Ingress
        // Security: TLS is enabled if tlsSecretName is provided. Access control should be
        // handled by Ray's dashboard itself or an additional auth layer (e.g., OAuth2-proxy).
        if (args.externalDashboardHostname) {
            this.dashboardIngress = new k8s.networking.v1.Ingress(`${name}-dashboard-ing`, {
                metadata: {
                    name: `${name}-ray-dashboard-ingress`,
                    namespace: args.namespace,
                    annotations: {
                        // Add ingress controller specific annotations if needed
                        // "kubernetes.io/ingress.class": "nginx",
                        // "cert-manager.io/cluster-issuer": "letsencrypt-prod", // If using cert-manager
                    },
                },
                spec: {
                    ...(args.tlsSecretName ? {
                        tls: [{
                            hosts: [args.externalDashboardHostname],
                            secretName: args.tlsSecretName,
                        }],
                    } : {}),
                    rules: [{
                        host: args.externalDashboardHostname,
                        http: {
                            paths: [{
                                path: "/",
                                pathType: "Prefix",
                                backend: {
                                    service: {
                                        name: this.headService.metadata.name,
                                        port: { name: "dashboard" },
                                    },
                                },
                            }],
                        },
                    }],
                },
            }, resourceOpts);
        }

        // Monitoring Configuration (assuming Prometheus Operator)
        // Scrapes metrics from the Ray head node's dashboard endpoint.
        // Security: NetworkPolicy above allows Prometheus in monitoringNamespace to scrape.
        this.serviceMonitor = new k8s.apiextensions.CustomResource(`${name}-sm`, {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: `${name}-ray-sm`,
                namespace: args.namespace, // Deploy ServiceMonitor in the same namespace
                labels: {
                    "release": "prometheus", // Example label, adjust based on your Prometheus Operator setup
                    ...args.headPodLabels,
                },
            },
            spec: {
                selector: {
                    matchLabels: pulumi.output(this.headService.metadata).apply(md => md.labels || {}),
                },
                namespaceSelector: {
                    matchNames: [args.namespace],
                },
                endpoints: [{
                    port: "dashboard", // Scrape the dashboard port
                    path: "/metrics", // Standard path for Ray metrics endpoint
                    interval: "30s",
                }],
            },
        }, resourceOpts);

        // High Availability Notes:
        // - Ray's core state (GCS) traditionally runs on the head node. True HA often requires external Redis/etcd.
        // - The headless service aids discovery if multiple head replicas *were* supported easily.
        // - Load balancing for the *client* endpoint might involve a separate LB service if needed.
        // - Worker fault tolerance is inherent in Ray; networking ensures they can rejoin/communicate.

        this.registerOutputs({
            headServiceName: this.headService.metadata.name,
            discoveryServiceName: this.discoveryService.metadata.name,
            dashboardIngressHostname: this.dashboardIngress?.spec.rules[0].host,
        });
    }
}

// Example Usage (within your main Pulumi program)
/*
const rayNet = new RayNetworking("my-ray-cluster", {
    namespace: "ray-systems",
    headPodLabels: { "ray.io/node-type": "head", "app": "my-ray" },
    workerPodLabels: { "ray.io/node-type": "worker", "app": "my-ray" },
    allPodsLabels: { "app": "my-ray" }, // Common label for all pods
    externalDashboardHostname: "ray.mylab.example.com",
    tlsSecretName: "ray-dashboard-tls-secret", // Assumes this secret exists
    // Example: Allow ingress from client pods in 'app-ns' namespace to the Ray Client port
    allowedIngressPeers: [{
        podSelector: { matchLabels: { role: "ray-client-app" } },
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "app-ns" } }
    }],
    // Example: Allow egress to an S3 bucket endpoint (replace with actual IP/DNS if needed)
    // allowedEgressPeers: [{ to: [{ ipBlock: { cidr: "52.92.17.0/24" } }] }] // Example AWS S3 IP range
});

export const rayHeadServiceName = rayNet.headServiceName;
export const rayDiscoveryServiceName = rayNet.discoveryServiceName;
export const rayDashboardHostname = rayNet.dashboardIngressHostname;
*/
