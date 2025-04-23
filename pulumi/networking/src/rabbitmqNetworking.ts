import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx"; // Using kubernetesx for simplified NetworkPolicy

// Define standard RabbitMQ ports
const RABBITMQ_PORTS = {
    amqp: 5672,
    amqps: 5671, // AMQP over TLS
    epmd: 4369,  // Erlang Port Mapper Daemon (for clustering)
    dist: 25672, // Erlang Distribution port (for clustering) - often configured as a range
    managementHttp: 15672,
    managementHttps: 15671, // Management UI/API over TLS
    prometheusMetrics: 15692, // Dedicated Prometheus metrics port (alternative to scraping management API)
};

// Define arguments for the RabbitMQNetworking component
interface RabbitMQNetworkingArgs {
    namespace: pulumi.Input<string>;
    /** Labels applied to ALL RabbitMQ pods for selection. */
    podLabels: pulumi.Input<{ [key: string]: string }>;
    /** Type of service for client connections ('ClusterIP' or 'LoadBalancer'). Defaults to 'ClusterIP'. */
    clientServiceType?: pulumi.Input<"ClusterIP" | "LoadBalancer">;
    /** Optional: Specify pod/namespace selectors for allowed client applications (AMQP/Management). */
    allowedClientPeers?: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Specify pod/namespace selectors for allowed egress destinations. */
    allowedEgressPeers?: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Namespace where Prometheus runs (for NetworkPolicy). Defaults to 'monitoring'. */
    monitoringNamespace?: pulumi.Input<string>;
    /** Optional: Name of the Kubernetes Secret containing TLS certs for AMQPS (port 5671). Assumes RabbitMQ is configured to use it. */
    amqpsTlsSecretName?: pulumi.Input<string>;
    /** Optional: Name of the Kubernetes Secret containing TLS certs for HTTPS Management (port 15671). Assumes RabbitMQ is configured to use it. */
    managementTlsSecretName?: pulumi.Input<string>;
    /** Optional: Set to true to enable scraping the dedicated Prometheus metrics port (15692). Defaults to scraping the management API. */
    enablePrometheusMetricsPort?: boolean;
}

export class RabbitMQNetworking extends pulumi.ComponentResource {
    public readonly clientService: k8s.core.v1.Service;
    public readonly discoveryService: k8s.core.v1.Service;
    public readonly networkPolicy: kx.NetworkPolicy;
    public readonly serviceMonitor?: k8s.apiextensions.CustomResource; // Assuming Prometheus Operator

    constructor(name: string, args: RabbitMQNetworkingArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:RabbitMQNetworking", name, args, opts);

        const resourceOpts = { parent: this, provider: opts?.provider };
        const monitoringNamespace = args.monitoringNamespace ?? "monitoring";
        const clientServiceType = args.clientServiceType ?? "ClusterIP";

        // Service for Client Connections (AMQP, Management)
        // Exposes ports for clients and management UI/API. Can be ClusterIP or LoadBalancer.
        // Security: Exposes TLS ports (5671, 15671) assuming RabbitMQ is configured with corresponding certs.
        this.clientService = new k8s.core.v1.Service(`${name}-client-svc`, {
            metadata: {
                name: `${name}-rabbitmq`, // Common name for client access
                namespace: args.namespace,
                labels: args.podLabels,
            },
            spec: {
                selector: args.podLabels,
                ports: [
                    { name: "amqp", port: RABBITMQ_PORTS.amqp, targetPort: RABBITMQ_PORTS.amqp },
                    ...(args.amqpsTlsSecretName ? [{ name: "amqps", port: RABBITMQ_PORTS.amqps, targetPort: RABBITMQ_PORTS.amqps }] : []),
                    { name: "http-mgmt", port: RABBITMQ_PORTS.managementHttp, targetPort: RABBITMQ_PORTS.managementHttp },
                    ...(args.managementTlsSecretName ? [{ name: "https-mgmt", port: RABBITMQ_PORTS.managementHttps, targetPort: RABBITMQ_PORTS.managementHttps }] : []),
                    ...(args.enablePrometheusMetricsPort ? [{ name: "metrics", port: RABBITMQ_PORTS.prometheusMetrics, targetPort: RABBITMQ_PORTS.prometheusMetrics }] : []),
                ],
                type: clientServiceType,
            },
        }, resourceOpts);

        // Headless Service for Clustering and Discovery
        // Allows pods to discover each other via DNS for clustering purposes (EPMD, Erlang distribution).
        this.discoveryService = new k8s.core.v1.Service(`${name}-discovery-svc`, {
            metadata: {
                name: `${name}-rabbitmq-nodes`, // Specific name for internal node communication
                namespace: args.namespace,
                labels: args.podLabels,
            },
            spec: {
                selector: args.podLabels,
                ports: [
                    // Define ports primarily for identification/clarity; headless service doesn't use ports for routing.
                    { name: "epmd", port: RABBITMQ_PORTS.epmd, targetPort: RABBITMQ_PORTS.epmd },
                    { name: "dist", port: RABBITMQ_PORTS.dist, targetPort: RABBITMQ_PORTS.dist }, // Note: Actual dist port might be dynamic/range
                ],
                clusterIP: "None", // Headless service
                publishNotReadyAddresses: true, // Important for clustering stability during startup/updates
            },
        }, resourceOpts);

        // Network Policies for secure access
        // Security: Restrict traffic flow between RabbitMQ nodes, clients, and monitoring.
        this.networkPolicy = new kx.NetworkPolicy(`${name}-netpol`, {
            metadata: {
                name: `${name}-rabbitmq-netpol`,
                namespace: args.namespace,
            },
            spec: {
                podSelector: { matchLabels: args.podLabels },
                policyTypes: ["Ingress", "Egress"],
                ingress: [
                    // Allow traffic FROM other RabbitMQ pods for clustering
                    {
                        from: [{ podSelector: { matchLabels: args.podLabels } }],
                        ports: [
                            { protocol: "TCP", port: RABBITMQ_PORTS.epmd },
                            { protocol: "TCP", port: RABBITMQ_PORTS.dist },
                            // Add range if Erlang distribution uses a range: e.g., { protocol: "TCP", port: 25672, endPort: 25772 }
                        ],
                    },
                    // Allow traffic FROM Monitoring (Prometheus)
                    {
                        from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": monitoringNamespace } } }],
                        ports: [
                            // Allow scraping management API (HTTPS if TLS enabled, else HTTP)
                            ...(args.managementTlsSecretName ?
                                [{ protocol: "TCP", port: RABBITMQ_PORTS.managementHttps }] :
                                [{ protocol: "TCP", port: RABBITMQ_PORTS.managementHttp }]),
                            // Allow scraping dedicated metrics port if enabled
                            ...(args.enablePrometheusMetricsPort ? [{ protocol: "TCP", port: RABBITMQ_PORTS.prometheusMetrics }] : []),
                        ],
                    },
                    // Allow traffic FROM specified client peers (AMQP/S, Management HTTP/S)
                    ...(args.allowedClientPeers ? [{
                        from: args.allowedClientPeers,
                        ports: [
                            { protocol: "TCP", port: RABBITMQ_PORTS.amqp },
                            ...(args.amqpsTlsSecretName ? [{ protocol: "TCP", port: RABBITMQ_PORTS.amqps }] : []),
                            { protocol: "TCP", port: RABBITMQ_PORTS.managementHttp },
                            ...(args.managementTlsSecretName ? [{ protocol: "TCP", port: RABBITMQ_PORTS.managementHttps }] : []),
                        ],
                    }] : []),
                ],
                egress: [
                    // Allow DNS resolution
                    { ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] },
                    // Allow traffic TO other RabbitMQ pods for clustering
                    {
                        to: [{ podSelector: { matchLabels: args.podLabels } }],
                        ports: [
                            { protocol: "TCP", port: RABBITMQ_PORTS.epmd },
                            { protocol: "TCP", port: RABBITMQ_PORTS.dist },
                             // Add range if Erlang distribution uses a range
                        ],
                    },
                    // Allow traffic TO specified external peers if needed (e.g., federation, shovels)
                    ...(args.allowedEgressPeers ? [{
                        to: args.allowedEgressPeers,
                        // Define ports needed (e.g., 5671 for AMQPS federation)
                        // ports: [{ protocol: "TCP", port: 5671 }]
                    }] : []),
                ],
            },
        }, resourceOpts);

        // Monitoring Configuration (assuming Prometheus Operator)
        // Security: NetworkPolicy above allows Prometheus in monitoringNamespace to scrape.
        // Chooses between scraping the management API or the dedicated metrics port.
        const scrapePortName = args.enablePrometheusMetricsPort ? "metrics" :
                              args.managementTlsSecretName ? "https-mgmt" : "http-mgmt";
        const scrapePath = args.enablePrometheusMetricsPort ? "/metrics" : "/api/metrics"; // Management API path for metrics

        this.serviceMonitor = new k8s.apiextensions.CustomResource(`${name}-sm`, {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: `${name}-rabbitmq-sm`,
                namespace: args.namespace, // Deploy ServiceMonitor in the same namespace
                labels: {
                    "release": "prometheus", // Example label, adjust based on your Prometheus Operator setup
                    ...args.podLabels,
                },
            },
            spec: {
                selector: {
                    matchLabels: pulumi.output(this.clientService.metadata).apply(md => md.labels || {}),
                },
                namespaceSelector: {
                    matchNames: [args.namespace],
                },
                endpoints: [{
                    port: scrapePortName,
                    path: scrapePath,
                    interval: "30s",
                    // If scraping management API over HTTPS with self-signed/internal CA, might need:
                    // scheme: args.managementTlsSecretName ? "https" : "http",
                    // tlsConfig: args.managementTlsSecretName ? { insecureSkipVerify: true } : undefined, // Adjust for production CAs
                    // Basic Auth might be needed if scraping management API:
                    // basicAuth: { username: { name: "rabbitmq-secret", key: "username" }, password: { name: "rabbitmq-secret", key: "password" } }
                }],
            },
        }, resourceOpts);

        // Security Notes:
        // - This component configures network access. Ensure RabbitMQ itself is configured securely:
        //   - Strong user credentials.
        //   - TLS enabled for client and management connections (requires creating secrets specified in args).
        //   - Minimal necessary permissions for users.
        // - NetworkPolicies significantly limit attack surface.
        // - Regularly update RabbitMQ images.

        // Client Access Configuration Notes:
        // - Clients connect to the `clientService` name (e.g., `amqp://<user>:<pass>@my-rabbitmq.my-namespace.svc.cluster.local:5672`).
        // - Use port 5671 for AMQPS if TLS is enabled.
        // - Management UI access via `clientService` name/IP on port 15672 (HTTP) or 15671 (HTTPS).

        this.registerOutputs({
            clientServiceName: this.clientService.metadata.name,
            discoveryServiceName: this.discoveryService.metadata.name,
            clientServiceClusterIP: this.clientService.spec.clusterIP,
            // Add LoadBalancer IP/hostname if applicable
            clientServiceLoadBalancerIngress: clientServiceType === "LoadBalancer" ? this.clientService.status.loadBalancer.ingress : undefined,
        });
    }
}

// Example Usage (within your main Pulumi program)
/*
const rabbitNet = new RabbitMQNetworking("ha-rabbitmq", {
    namespace: "messaging",
    podLabels: { app: "rabbitmq", cluster: "ha-cluster" },
    clientServiceType: "ClusterIP",
    amqpsTlsSecretName: "rabbitmq-client-tls-secret", // Assumes secret exists
    managementTlsSecretName: "rabbitmq-mgmt-tls-secret", // Assumes secret exists
    // Allow AMQP connections from pods labeled 'app=my-worker' in the 'apps' namespace
    allowedClientPeers: [{
        podSelector: { matchLabels: { app: "my-worker" } },
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "apps" } }
    }],
    // enablePrometheusMetricsPort: true, // Optionally use dedicated metrics port
});

export const rabbitmqClientServiceName = rabbitNet.clientServiceName;
export const rabbitmqDiscoveryServiceName = rabbitNet.discoveryServiceName;
export const rabbitmqClusterIP = rabbitNet.clientServiceClusterIP;
*/
