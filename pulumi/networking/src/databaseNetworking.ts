import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx"; // Using kubernetesx for simplified NetworkPolicy

// Define common database ports (can be overridden via args)
const DEFAULT_PORTS = {
    postgresql: 5432,
    redis: 6379,
    influxdb: 8086, // InfluxDB v1/v2 API port
};

// Define arguments for the DatabaseNetworking component
interface DatabaseNetworkingArgs {
    namespace: pulumi.Input<string>;
    /** Type of database ('postgresql', 'redis', 'influxdb'). */
    dbType: "postgresql" | "redis" | "influxdb";
    /** Labels applied to the database pods for selection. */
    podLabels: pulumi.Input<{ [key: string]: string }>;
    /** Port number for the main database connection. Defaults based on dbType. */
    dbPort?: pulumi.Input<number>;
    /** Name for the main database service port. Defaults to 'db'. */
    dbPortName?: pulumi.Input<string>;
    /** Specify pod/namespace selectors for allowed client applications. REQUIRED. */
    allowedClientPeers: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Specify pod/namespace selectors for allowed egress destinations (beyond DNS). */
    allowedEgressPeers?: k8s.types.input.networking.v1.NetworkPolicyPeer[];
    /** Optional: Namespace where Prometheus runs (for NetworkPolicy). Defaults to 'monitoring'. */
    monitoringNamespace?: pulumi.Input<string>;
    /** Optional: Name of the Kubernetes Secret containing TLS certs for the database connection. Assumes the DB server is configured to use it. */
    tlsSecretName?: pulumi.Input<string>;
    /** Optional: Port number for TLS connections (if different from standard convention or if standard port is also used for non-TLS). */
    tlsPort?: pulumi.Input<number>;
    /** Optional: Name for the TLS database service port. Defaults to 'db-tls'. */
    tlsPortName?: pulumi.Input<string>;
    /** Optional: Set to true to expose and monitor a dedicated metrics port. */
    enableMetrics?: boolean;
    /** Optional: Port number for the metrics endpoint. */
    metricsPort?: pulumi.Input<number>;
    /** Optional: Name for the metrics service port. Defaults to 'metrics'. */
    metricsPortName?: pulumi.Input<string>;
    /** Optional: Path for the metrics endpoint. Defaults based on dbType if applicable (e.g., '/metrics'). */
    metricsPath?: pulumi.Input<string>;
    /** Optional: Set to true if the metrics endpoint requires TLS. */
    metricsTls?: boolean;
}

export class DatabaseNetworking extends pulumi.ComponentResource {
    public readonly service: k8s.core.v1.Service;
    public readonly networkPolicy: kx.NetworkPolicy;
    public readonly serviceMonitor?: k8s.apiextensions.CustomResource; // Assuming Prometheus Operator

    constructor(name: string, args: DatabaseNetworkingArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:DatabaseNetworking", name, args, opts);

        const resourceOpts = { parent: this, provider: opts?.provider };
        const monitoringNamespace = args.monitoringNamespace ?? "monitoring";
        const dbPort = args.dbPort ?? DEFAULT_PORTS[args.dbType];
        const dbPortName = args.dbPortName ?? "db";
        const tlsPortName = args.tlsPortName ?? "db-tls";
        const metricsPortName = args.metricsPortName ?? "metrics";
        const defaultMetricsPath = args.dbType === 'influxdb' ? '/metrics' : '/metrics'; // Adjust default path if needed for others

        // --- Input Validation ---
        if (!args.allowedClientPeers || args.allowedClientPeers.length === 0) {
            throw new Error("'allowedClientPeers' must be specified to control database access.");
        }
        if (args.enableMetrics && !args.metricsPort) {
             pulumi.log.warn(`'enableMetrics' is true but 'metricsPort' is not specified for ${name}. Monitoring might not be configured correctly.`);
        }
        if (args.tlsSecretName && !args.tlsPort && args.dbType !== 'postgresql' && args.dbType !== 'redis') {
             // PG and Redis often use the same port number for TLS/non-TLS, relying on protocol negotiation.
             // Other DBs might require a distinct port.
             pulumi.log.warn(`'tlsSecretName' is specified for ${name} (${args.dbType}) but 'tlsPort' is not. Ensure the database uses port ${dbPort} for TLS or specify 'tlsPort'.`);
        }

        // --- Service Definition ---
        const servicePorts: k8s.types.input.core.v1.ServicePort[] = [];
        // Standard DB Port
        servicePorts.push({ name: dbPortName, port: dbPort, targetPort: dbPort });
        // TLS DB Port (if specified or conventionally needed)
        if (args.tlsSecretName && args.tlsPort) {
            servicePorts.push({ name: tlsPortName, port: args.tlsPort, targetPort: args.tlsPort });
        } else if (args.tlsSecretName && (args.dbType === 'postgresql' || args.dbType === 'redis')) {
            // Assume PG/Redis might handle TLS on the standard port if tlsPort isn't explicitly set
             pulumi.log.info(`TLS enabled for ${name} on default port ${dbPort}. Ensure server is configured for TLS negotiation.`);
        }
        // Metrics Port
        if (args.enableMetrics && args.metricsPort) {
            servicePorts.push({ name: metricsPortName, port: args.metricsPort, targetPort: args.metricsPort });
        }

        this.service = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: {
                name: `${name}-${args.dbType}`,
                namespace: args.namespace,
                labels: args.podLabels,
            },
            spec: {
                selector: args.podLabels,
                ports: servicePorts,
                type: "ClusterIP", // Internal service only
            },
        }, resourceOpts);

        // --- Network Policy ---
        // Security: Restrict access to only authorized clients and monitoring tools.
        const ingressRules: k8s.types.input.networking.v1.NetworkPolicyIngressRule[] = [];

        // Allow from specified client peers to DB port(s)
        const clientTargetPorts: k8s.types.input.networking.v1.NetworkPolicyPort[] = [];
        clientTargetPorts.push({ protocol: "TCP", port: dbPort });
        if (args.tlsSecretName && args.tlsPort) {
            clientTargetPorts.push({ protocol: "TCP", port: args.tlsPort });
        } else if (args.tlsSecretName && (args.dbType === 'postgresql' || args.dbType === 'redis')) {
             // If TLS is on the standard port, the first rule already covers it.
        }
        ingressRules.push({
            from: args.allowedClientPeers,
            ports: clientTargetPorts,
        });

        // Allow from Monitoring (Prometheus) to metrics port
        if (args.enableMetrics && args.metricsPort) {
            ingressRules.push({
                from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": monitoringNamespace } } }],
                ports: [{ protocol: "TCP", port: args.metricsPort }],
            });
        }

        this.networkPolicy = new kx.NetworkPolicy(`${name}-netpol`, {
            metadata: {
                name: `${name}-${args.dbType}-netpol`,
                namespace: args.namespace,
            },
            spec: {
                podSelector: { matchLabels: args.podLabels },
                policyTypes: ["Ingress", "Egress"],
                ingress: ingressRules,
                egress: [
                    // Allow DNS resolution
                    { ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] },
                    // Allow egress to specified peers (e.g., for replication, external services)
                    ...(args.allowedEgressPeers ? [{ to: args.allowedEgressPeers }] : []),
                    // Add specific egress rules if needed (e.g., allow traffic between replicas if applicable)
                    // { to: [{ podSelector: { matchLabels: args.podLabels } }] } // Example: Allow egress to self/replicas
                ],
            },
        }, resourceOpts);

        // --- Monitoring Configuration (Optional) ---
        if (args.enableMetrics && args.metricsPort) {
            this.serviceMonitor = new k8s.apiextensions.CustomResource(`${name}-sm`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${name}-${args.dbType}-sm`,
                    namespace: args.namespace, // Deploy ServiceMonitor in the same namespace
                    labels: {
                        "release": "prometheus", // Example label, adjust based on your Prometheus Operator setup
                        ...args.podLabels,
                    },
                },
                spec: {
                    selector: {
                        matchLabels: pulumi.output(this.service.metadata).apply(md => md.labels || {}),
                    },
                    namespaceSelector: {
                        matchNames: [args.namespace],
                    },
                    endpoints: [{
                        port: metricsPortName,
                        path: args.metricsPath ?? defaultMetricsPath,
                        interval: "30s",
                        scheme: args.metricsTls ? "https" : "http",
                        // Add tlsConfig if metrics endpoint uses TLS with internal/self-signed certs
                        // tlsConfig: args.metricsTls ? { insecureSkipVerify: true } : undefined,
                    }],
                },
            }, resourceOpts);
        }

        // --- Security & Configuration Notes ---
        // - TLS: Enabling TLS here requires:
        //   1. Creating a Kubernetes Secret (`tlsSecretName`) with the TLS certificate and key.
        //   2. Configuring the database server itself to use these certificates for the specified port(s).
        // - Connection Pooling: Tools like PgBouncer (PostgreSQL) or Redis proxies are deployed separately.
        //   Configure the pooler deployment/pod and add its selector to `allowedClientPeers` for this database.
        //   Applications should then connect to the pooler's service, not directly to this database service.
        // - Credentials: Secure database access relies on strong, unique credentials managed within the database.
        // - Least Privilege: Grant database users only the permissions they require.
        // - Updates: Keep database images and underlying systems patched.

        this.registerOutputs({
            serviceName: this.service.metadata.name,
            serviceClusterIP: this.service.spec.clusterIP,
        });
    }
}

// Example Usage (within your main Pulumi program)
/*
// PostgreSQL Example
const pgPeers = [{ podSelector: { matchLabels: { app: "my-backend-app" } }, namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "apps" } } }];
const pgNet = new DatabaseNetworking("main-postgres", {
    namespace: "databases",
    dbType: "postgresql",
    podLabels: { app: "postgres", role: "master" },
    allowedClientPeers: pgPeers,
    tlsSecretName: "postgres-server-tls-secret", // Assumes secret exists and PG is configured
    enableMetrics: true,
    metricsPort: 9187, // Standard postgres_exporter port
});

// Redis Example
const redisPeers = [{ podSelector: { matchLabels: { app: "my-caching-layer" } }, namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "apps" } } }];
const redisNet = new DatabaseNetworking("session-cache", {
    namespace: "caches",
    dbType: "redis",
    podLabels: { app: "redis", tier: "cache" },
    allowedClientPeers: redisPeers,
    // tlsSecretName: "redis-server-tls-secret", // Enable if Redis configured for TLS
    enableMetrics: true,
    metricsPort: 9121, // Standard redis_exporter port
});

// InfluxDB Example
const influxPeers = [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "monitoring" } } }]; // Allow Telegraf/Grafana from monitoring ns
const influxNet = new DatabaseNetworking("metrics-db", {
    namespace: "monitoring",
    dbType: "influxdb",
    podLabels: { app: "influxdb" },
    allowedClientPeers: influxPeers,
    // tlsSecretName: "influxdb-server-tls-secret", // Enable if InfluxDB configured for TLS on port 8086
    enableMetrics: true, // InfluxDB exposes /metrics itself
    metricsPort: 8086,
    metricsPath: "/metrics",
    // metricsTls: true, // Set if TLS is enabled for the main port
});

export const postgresServiceName = pgNet.serviceName;
export const redisServiceName = redisNet.serviceName;
export const influxdbServiceName = influxNet.serviceName;
*/
