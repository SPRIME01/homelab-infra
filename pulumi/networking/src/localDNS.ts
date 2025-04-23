import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Arguments for the LocalDns component.
 */
interface LocalDnsArgs {
    /** The Kubernetes provider instance. */
    provider: k8s.Provider;
    /** The namespace to deploy CoreDNS into. */
    namespace: pulumi.Input<string>;
    /** The internal domain name for the homelab (e.g., "homelab.local"). */
    internalDomain: pulumi.Input<string>;
    /** List of upstream DNS servers to forward external queries to. */
    upstreamDnsServers: pulumi.Input<string[]>;
    /** Number of CoreDNS replicas for high availability. Defaults to 2. */
    replicas?: pulumi.Input<number>;
    /** Optional: Node selector for scheduling CoreDNS pods. */
    nodeSelector?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
    /** Optional: Tolerations for scheduling CoreDNS pods. */
    tolerations?: pulumi.Input<k8s.types.input.core.v1.Toleration[]>;
    /** Optional: Resource requests and limits for CoreDNS pods. */
    resources?: pulumi.Input<k8s.types.input.core.v1.ResourceRequirements>;
    /** Optional: Enable Prometheus metrics endpoint. Defaults to true. */
    enableMetrics?: pulumi.Input<boolean>;
}

/**
 * Pulumi component for deploying CoreDNS for local DNS resolution in Kubernetes.
 *
 * Deploys CoreDNS configured to:
 * 1. Resolve Kubernetes internal services (`*.svc.cluster.local`).
 * 2. Resolve custom internal hostnames (requires separate record management, e.g., via another ConfigMap or external-dns).
 * 3. Forward external queries to specified upstream servers.
 * 4. Provide basic high availability via multiple replicas.
 * 5. Expose metrics for Prometheus scraping (optional).
 */
export class LocalDns extends pulumi.ComponentResource {
    public readonly serviceName: pulumi.Output<string>;
    public readonly serviceClusterIp: pulumi.Output<string>;
    public readonly configMapName: pulumi.Output<string>;
    public readonly deploymentName: pulumi.Output<string>;

    constructor(name: string, args: LocalDnsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:LocalDns", name, args, opts);

        const {
            provider,
            namespace,
            internalDomain,
            upstreamDnsServers,
            replicas = 2,
            nodeSelector,
            tolerations,
            resources,
            enableMetrics = true,
        } = args;

        const appName = `${name}-coredns`;
        const labels = { app: appName };

        // 1. CoreDNS ConfigMap (Corefile)
        const corefileContent = pulumi.all([internalDomain, upstreamDnsServers, enableMetrics])
            .apply(([domain, upstreams, metricsEnabled]) => `
.:53 {
    errors
    health {
       lameduck 5s
    }
    ready
    log . {
        class error
    }
    ${metricsEnabled ? 'prometheus :9153' : ''}
    forward . ${upstreams.join(' ')} {
       max_concurrent 1000
    }
    cache 30
    loop
    reload 5s
}
# Optional: Define custom internal zone if managing records manually
# ${domain}:53 {
#     file /etc/coredns/db.${domain}
#     log
#     errors
# }
# Resolve Kubernetes services
cluster.local:53 {
    errors
    cache 30
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       upstream
       fallthrough in-addr.arpa ip6.arpa
    }
}
`);

        const configMap = new k8s.core.v1.ConfigMap(appName, {
            metadata: {
                name: appName,
                namespace: namespace,
                labels: labels,
            },
            data: {
                "Corefile": corefileContent,
                // Optional: Add zone file content if using 'file' plugin
                // [`db.${internalDomain}`]: `... your zone file content ...`
            },
        }, { parent: this, provider: provider });

        this.configMapName = configMap.metadata.name;

        // 2. CoreDNS Deployment
        const deployment = new k8s.apps.v1.Deployment(appName, {
            metadata: {
                name: appName,
                namespace: namespace,
                labels: labels,
            },
            spec: {
                replicas: replicas,
                selector: { matchLabels: labels },
                template: {
                    metadata: { labels: labels },
                    spec: {
                        serviceAccountName: "default", // Consider creating a dedicated SA
                        priorityClassName: "system-cluster-critical", // Ensure CoreDNS gets scheduled
                        nodeSelector: nodeSelector,
                        tolerations: tolerations,
                        affinity: { // Basic HA: try not to schedule pods on the same node
                            podAntiAffinity: {
                                preferredDuringSchedulingIgnoredDuringExecution: [{
                                    weight: 100,
                                    podAffinityTerm: {
                                        labelSelector: { matchLabels: labels },
                                        topologyKey: "kubernetes.io/hostname",
                                    },
                                }],
                            },
                        },
                        containers: [{
                            name: "coredns",
                            image: "coredns/coredns:1.11.1", // Use a specific, tested version
                            imagePullPolicy: "IfNotPresent",
                            resources: resources ?? { // Default resources
                                limits: { memory: "170Mi" },
                                requests: { cpu: "100m", memory: "70Mi" },
                            },
                            args: ["-conf", "/etc/coredns/Corefile"],
                            volumeMounts: [{
                                name: "config-volume",
                                mountPath: "/etc/coredns",
                                readOnly: true,
                            }],
                            ports: [
                                { containerPort: 53, name: "dns-udp", protocol: "UDP" },
                                { containerPort: 53, name: "dns-tcp", protocol: "TCP" },
                                ...(enableMetrics ? [{ containerPort: 9153, name: "metrics", protocol: "TCP" }] : []),
                            ],
                            livenessProbe: {
                                httpGet: { path: "/health", port: 8080 }, // CoreDNS health plugin endpoint
                                initialDelaySeconds: 60,
                                timeoutSeconds: 5,
                                successThreshold: 1,
                                failureThreshold: 5,
                            },
                            readinessProbe: {
                                httpGet: { path: "/ready", port: 8181 }, // CoreDNS ready plugin endpoint
                                initialDelaySeconds: 30,
                                timeoutSeconds: 5,
                                successThreshold: 1,
                                failureThreshold: 5,
                            },
                            securityContext: {
                                allowPrivilegeEscalation: false,
                                capabilities: {
                                    add: ["NET_BIND_SERVICE"],
                                    drop: ["all"],
                                },
                                readOnlyRootFilesystem: true,
                            },
                        }],
                        dnsPolicy: "Default", // Use node's DNS during startup
                        volumes: [{
                            name: "config-volume",
                            configMap: {
                                name: configMap.metadata.name,
                                items: [{ key: "Corefile", path: "Corefile" }],
                            },
                        }],
                    },
                },
            },
        }, { parent: this, provider: provider, dependsOn: [configMap] });

        this.deploymentName = deployment.metadata.name;

        // 3. CoreDNS Service
        const service = new k8s.core.v1.Service(appName, {
            metadata: {
                name: appName,
                namespace: namespace,
                labels: labels,
                annotations: (enableMetrics ? { "prometheus.io/scrape": "true", "prometheus.io/port": "9153" } : {}),
            },
            spec: {
                selector: labels,
                type: "ClusterIP", // Use ClusterIP for internal DNS
                ports: [
                    { name: "dns-udp", port: 53, protocol: "UDP", targetPort: "dns-udp" },
                    { name: "dns-tcp", port: 53, protocol: "TCP", targetPort: "dns-tcp" },
                    ...(enableMetrics ? [{ name: "metrics", port: 9153, protocol: "TCP", targetPort: "metrics" }] : []),
                ],
            },
        }, { parent: this, provider: provider, dependsOn: [deployment] });

        this.serviceName = service.metadata.name;
        this.serviceClusterIp = service.spec.clusterIP;

        // 4. Client Configuration Note
        pulumi.log.info(`CoreDNS deployed. Configure clients (nodes, DHCP server, etc.) to use the ClusterIP: ${this.serviceClusterIp} as their DNS server.`, this);

        // 5. Monitoring (ServiceMonitor for Prometheus Operator - Optional)
        if (enableMetrics) {
            // If using Prometheus Operator, create a ServiceMonitor resource here
            // Example:
            // const serviceMonitor = new k8s.apiextensions.CustomResource(...)
            pulumi.log.info("Prometheus metrics enabled. Create a ServiceMonitor resource if using Prometheus Operator.", this);
        }

        this.registerOutputs({
            serviceName: this.serviceName,
            serviceClusterIp: this.serviceClusterIp,
            configMapName: this.configMapName,
            deploymentName: this.deploymentName,
        });
    }
}
