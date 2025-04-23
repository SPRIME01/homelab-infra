import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx"; // Using kubernetesx for simplified NetworkPolicy

// Define arguments for the TritonNetworking component
interface TritonNetworkingArgs {
    namespace: pulumi.Input<string>;
    /** Labels applied to Triton pods for selection by Service and NetworkPolicy. */
    tritonPodLabels: pulumi.Input<{ [key: string]: string }>;
    /** External hostname for Ingress. */
    externalHostname: pulumi.Input<string>;
    /** Optional: Specify pod/namespace selectors for allowed ingress sources (e.g., other A2A agents). */
    allowedIngressPeers?: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Specify pod/namespace selectors for allowed egress destinations (e.g., MCP data sources, A2A agents). */
    allowedEgressPeers?: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Namespace where the ingress controller runs (for NetworkPolicy). Defaults to 'ingress-nginx'. */
    ingressControllerNamespace?: pulumi.Input<string>;
    /** Optional: Namespace where Prometheus runs (for NetworkPolicy). Defaults to 'monitoring'. */
    monitoringNamespace?: pulumi.Input<string>;
    /** Optional: Name of the TLS secret for Ingress. Assumes it exists in the same namespace. */
    tlsSecretName?: pulumi.Input<string>;
}

export class TritonNetworking extends pulumi.ComponentResource {
    public readonly service: k8s.core.v1.Service;
    public readonly ingress?: k8s.networking.v1.Ingress;
    public readonly networkPolicy: kx.NetworkPolicy;
    public readonly serviceMonitor?: k8s.apiextensions.CustomResource; // Assuming Prometheus Operator

    constructor(name: string, args: TritonNetworkingArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:TritonNetworking", name, args, opts);

        const resourceOpts = { parent: this, provider: opts?.provider }; // Ensure resources are children of the component
        const monitoringNamespace = args.monitoringNamespace ?? "monitoring";
        const ingressControllerNamespace = args.ingressControllerNamespace ?? "ingress-nginx"; // Adjust if using a different controller/namespace

        // Internal Kubernetes Service for Triton
        // Exposes HTTP, gRPC, and Metrics ports within the cluster.
        // Provides basic load balancing across Triton pods selected by labels.
        this.service = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: {
                name: `${name}-triton`,
                namespace: args.namespace,
                labels: args.tritonPodLabels, // Apply same labels for potential selection
            },
            spec: {
                selector: args.tritonPodLabels,
                ports: [
                    { name: "http", port: 8000, targetPort: 8000 },
                    { name: "grpc", port: 8001, targetPort: 8001 },
                    { name: "metrics", port: 8002, targetPort: 8002 },
                ],
                type: "ClusterIP", // Internal service only
            },
        }, resourceOpts);

        // Network Policies for secure access
        // Restricts ingress and egress traffic to only allowed sources/destinations.
        this.networkPolicy = new kx.NetworkPolicy(`${name}-netpol`, {
            metadata: {
                name: `${name}-triton-netpol`,
                namespace: args.namespace,
            },
            spec: {
                podSelector: { matchLabels: args.tritonPodLabels },
                policyTypes: ["Ingress", "Egress"],
                // Ingress Rules: Allow traffic from specific sources
                ingress: [
                    { // Allow from Ingress Controller (for external access)
                        from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": ingressControllerNamespace } } }],
                        ports: [{ protocol: "TCP", port: 8000 }], // Allow HTTP port
                    },
                    { // Allow from Monitoring (Prometheus)
                        from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": monitoringNamespace } } }],
                        ports: [{ protocol: "TCP", port: 8002 }], // Allow Metrics port
                    },
                    // Add rules for allowed A2A ingress peers if specified
                    ...(args.allowedIngressPeers ? [{
                        from: args.allowedIngressPeers,
                        ports: [ // Define ports needed for A2A communication (e.g., gRPC)
                            { protocol: "TCP", port: 8001 },
                            // Add other ports if needed for A2A
                        ],
                    }] : []),
                ],
                // Egress Rules: Allow traffic to specific destinations
                egress: [
                    { // Allow DNS resolution
                        ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
                    },
                    // Add rules for allowed MCP/A2A egress peers if specified
                    ...(args.allowedEgressPeers ? [{
                        to: args.allowedEgressPeers,
                        // Define ports needed for MCP/A2A communication
                        // This might be TCP 443 for external HTTPS data sources (MCP)
                        // or specific ports for other internal A2A agents.
                        // Example: ports: [{ protocol: "TCP", port: 443 }]
                    }] : []),
                    // Add specific egress rules for known internal cluster services if needed
                    // e.g., { to: [{ podSelector: { matchLabels: { app: "some-internal-db" } } }], ports: [...] }
                ],
            },
        }, resourceOpts);

        // External Access via Ingress
        // Exposes the Triton HTTP port externally via the specified hostname.
        // Assumes an Ingress controller (like Nginx) is running.
        // Security: TLS is enabled if tlsSecretName is provided.
        if (args.externalHostname) {
            this.ingress = new k8s.networking.v1.Ingress(`${name}-ing`, {
                metadata: {
                    name: `${name}-triton-ingress`,
                    namespace: args.namespace,
                    annotations: {
                        // Add ingress controller specific annotations if needed
                        // e.g., "kubernetes.io/ingress.class": "nginx"
                        // e.g., "cert-manager.io/cluster-issuer": "letsencrypt-prod" // If using cert-manager
                    },
                },
                spec: {
                    ...(args.tlsSecretName ? { // Add TLS configuration if secret name is provided
                        tls: [{
                            hosts: [args.externalHostname],
                            secretName: args.tlsSecretName,
                        }],
                    } : {}),
                    rules: [{
                        host: args.externalHostname,
                        http: {
                            paths: [{
                                path: "/", // Or specific path like /v2
                                pathType: "Prefix",
                                backend: {
                                    service: {
                                        name: this.service.metadata.name,
                                        port: { name: "http" }, // Route to HTTP port
                                    },
                                },
                            }],
                        },
                    }],
                },
            }, resourceOpts);
        }

        // Monitoring Configuration (assuming Prometheus Operator)
        // Creates a ServiceMonitor to scrape metrics from the Triton /metrics endpoint.
        // Note: Specific MCP/A2A interaction metrics need to be instrumented within
        // Triton or the interacting services themselves. This configures scraping
        // of standard Triton metrics.
        // Security: NetworkPolicy above allows Prometheus in monitoringNamespace to scrape.
        this.serviceMonitor = new k8s.apiextensions.CustomResource(`${name}-sm`, {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: `${name}-triton-sm`,
                namespace: args.namespace, // Deploy ServiceMonitor in the same namespace as the service
                labels: {
                    // Add labels for Prometheus Operator to discover this ServiceMonitor
                    "release": "prometheus", // Example label, adjust based on your Prometheus Operator setup
                    ...args.tritonPodLabels,
                },
            },
            spec: {
                selector: {
                    matchLabels: pulumi.output(this.service.metadata).apply(md => md.labels || {}), // Select the service based on its labels
                },
                namespaceSelector: {
                    matchNames: [args.namespace],
                },
                endpoints: [{
                    port: "metrics", // Matches the service port name
                    path: "/metrics", // Triton's default metrics path
                    interval: "30s", // Scrape interval
                }],
            },
        }, resourceOpts);

        // Register outputs if needed
        this.registerOutputs({
            serviceName: this.service.metadata.name,
            ingressHostname: this.ingress?.spec.rules[0].host,
        });
    }
}

// Example Usage (within your main Pulumi program)
/*
const tritonNet = new TritonNetworking("my-triton", {
    namespace: "ai-workloads",
    tritonPodLabels: { app: "triton-inference-server" },
    externalHostname: "triton.mylab.example.com",
    tlsSecretName: "triton-tls-secret", // Assumes this secret exists
    // Example: Allow ingress from pods labeled 'app=my-a2a-agent' in the same namespace
    allowedIngressPeers: [{
        podSelector: { matchLabels: { app: "my-a2a-agent" } },
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ai-workloads" } }
    }],
    // Example: Allow egress to any pod in namespace 'data-sources' (for MCP)
    // and specifically to 'other-agent.ai-workloads.svc.cluster.local' (for A2A)
    allowedEgressPeers: [
        { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "data-sources" } } },
        { podSelector: { matchLabels: { app: "other-a2a-agent" } },
          namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ai-workloads" } }
        }
    ],
});

export const tritonServiceName = tritonNet.serviceName;
export const tritonIngressHostname = tritonNet.ingressHostname;
*/
