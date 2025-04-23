import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx"; // Using kubernetesx for simplified NetworkPolicy

// Define arguments for the NetworkMonitoring component
interface NetworkMonitoringArgs {
    namespace: pulumi.Input<string>;
    /** Namespace where Prometheus Operator resources (Prometheus, Alertmanager) are running. Defaults to 'monitoring'. */
    prometheusNamespace?: pulumi.Input<string>;
    /** Labels for Prometheus Operator to discover ServiceMonitors/Probes/PrometheusRules. Adjust if needed. */
    prometheusOperatorLabels?: pulumi.Input<{ [key: string]: string }>;
    /** Internal targets to probe with Blackbox Exporter (e.g., 'http://service.namespace.svc:port', 'tcp://db.namespace.svc:5432'). */
    internalProbeTargets?: { name: string, url: string, module: "http_2xx" | "tcp_connect" | "icmp" }[];
    /** External targets to probe with Blackbox Exporter (e.g., 'https://google.com', 'tcp://1.1.1.1:53'). */
    externalProbeTargets?: { name: string, url: string, module: "http_2xx" | "tcp_connect" | "icmp" }[];
    /** Optional: Enable periodic iperf3 bandwidth tests using a CronJob. Requires Prometheus Pushgateway. */
    enableBandwidthTests?: boolean;
    /** Optional: Schedule for the bandwidth test CronJob. Defaults to every hour. */
    bandwidthTestSchedule?: pulumi.Input<string>;
    /** Optional: Prometheus Pushgateway service URL (e.g., 'http://prometheus-pushgateway.monitoring.svc:9091'). Required if enableBandwidthTests is true. */
    pushgatewayUrl?: pulumi.Input<string>;
    /** Optional: Target for iperf3 tests (e.g., an internal service name or IP). Needs careful setup. */
    iperfTargetHost?: pulumi.Input<string>;
}

export class NetworkMonitoring extends pulumi.ComponentResource {
    public readonly blackboxExporterService: k8s.core.v1.Service;
    public readonly blackboxConfigMap: k8s.core.v1.ConfigMap;
    public readonly probes?: k8s.apiextensions.CustomResource[]; // Array of Probe resources
    public readonly alertRules?: k8s.apiextensions.CustomResource; // PrometheusRule resource
    public readonly bandwidthTestCronJob?: k8s.batch.v1.CronJob;

    constructor(name: string, args: NetworkMonitoringArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:NetworkMonitoring", name, args, opts);

        const resourceOpts = { parent: this, provider: opts?.provider };
        const promNamespace = args.prometheusNamespace ?? "monitoring";
        const promOperatorLabels = args.prometheusOperatorLabels ?? { release: "prometheus" }; // Adjust as needed

        // --- Blackbox Exporter Deployment ---
        const blackboxLabels = { app: "blackbox-exporter", component: name };

        // ConfigMap for Blackbox Exporter configuration
        this.blackboxConfigMap = new k8s.core.v1.ConfigMap(`${name}-bb-cm`, {
            metadata: {
                name: `${name}-blackbox-exporter`,
                namespace: args.namespace,
                labels: blackboxLabels,
            },
            data: {
                "config.yml": `
modules:
  http_2xx:
    prober: http
    timeout: 10s
    http:
      valid_status_codes: [] # Defaults to 2xx
      method: GET
      preferred_ip_protocol: "ip4" # Change to ip6 if needed
      # tls_config: # Optional: Add if probing internal services with self-signed certs
      #   insecure_skip_verify: true
  tcp_connect:
    prober: tcp
    timeout: 10s
    tcp:
      preferred_ip_protocol: "ip4"
      # query_response: # Optional: Add simple send/expect checks
      # - expect: "OK"
      #   send: "PING"
  icmp:
    prober: icmp
    timeout: 10s
    icmp:
      preferred_ip_protocol: "ip4"
`,
            },
        }, resourceOpts);

        // Blackbox Exporter Service
        this.blackboxExporterService = new k8s.core.v1.Service(`${name}-bb-svc`, {
            metadata: {
                name: `${name}-blackbox-exporter`,
                namespace: args.namespace,
                labels: blackboxLabels,
            },
            spec: {
                selector: blackboxLabels,
                ports: [{ name: "http", port: 9115, targetPort: 9115 }],
            },
        }, resourceOpts);

        // Blackbox Exporter Deployment
        const blackboxDeployment = new k8s.apps.v1.Deployment(`${name}-bb-dep`, {
            metadata: {
                name: `${name}-blackbox-exporter`,
                namespace: args.namespace,
                labels: blackboxLabels,
            },
            spec: {
                replicas: 1,
                selector: { matchLabels: blackboxLabels },
                template: {
                    metadata: { labels: blackboxLabels },
                    spec: {
                        containers: [{
                            name: "blackbox-exporter",
                            // Use official image or a trusted source
                            image: "prom/blackbox-exporter:v0.24.0", // Pin to a specific version
                            args: ["--config.file=/config/config.yml"],
                            ports: [{ containerPort: 9115, name: "http" }],
                            volumeMounts: [{
                                name: "config-volume",
                                mountPath: "/config",
                            }],
                            resources: { // Add resource limits/requests
                                requests: { cpu: "50m", memory: "64Mi" },
                                limits: { cpu: "200m", memory: "128Mi" },
                            },
                            securityContext: { // Security best practice
                                readOnlyRootFilesystem: true,
                                runAsNonRoot: true,
                                runAsUser: 65534, // nobody
                                capabilities: { drop: ["ALL"] }
                            }
                        }],
                        volumes: [{
                            name: "config-volume",
                            configMap: { name: this.blackboxConfigMap.metadata.name },
                        }],
                        securityContext: { // Pod level security context
                            runAsNonRoot: true,
                            seccompProfile: { type: 'RuntimeDefault' }
                        }
                    },
                },
            },
        }, resourceOpts);

        // --- Prometheus Integration ---

        // ServiceMonitor for Blackbox Exporter itself
        const blackboxSm = new k8s.apiextensions.CustomResource(`${name}-bb-sm`, {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: `${name}-blackbox-exporter-sm`,
                namespace: args.namespace,
                labels: { ...blackboxLabels, ...promOperatorLabels },
            },
            spec: {
                selector: { matchLabels: blackboxLabels },
                namespaceSelector: { matchNames: [args.namespace] },
                endpoints: [{ port: "http", path: "/metrics" }], // Scrape Blackbox's own metrics
            },
        }, resourceOpts);

        // Probes for internal/external targets
        this.probes = [];
        const allTargets = [
            ...(args.internalProbeTargets?.map(t => ({ ...t, type: "internal" })) ?? []),
            ...(args.externalProbeTargets?.map(t => ({ ...t, type: "external" })) ?? []),
        ];

        for (const target of allTargets) {
            const safeName = target.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
            const probe = new k8s.apiextensions.CustomResource(`${name}-probe-${safeName}`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "Probe",
                metadata: {
                    name: `${name}-${safeName}-probe`,
                    namespace: args.namespace, // Probes usually reside where Blackbox Exporter is
                    labels: { ...promOperatorLabels, probe_target_type: target.type },
                },
                spec: {
                    jobName: `${name}-${target.type}-probes`,
                    module: target.module,
                    prober: {
                        url: pulumi.interpolate`${this.blackboxExporterService.metadata.name}.${args.namespace}.svc:9115`,
                        scheme: "http",
                        path: "/probe",
                    },
                    targets: {
                        staticConfig: {
                            static: [target.url],
                            labels: { // Add labels to identify the specific target
                                probe_target: target.name,
                                probe_url: target.url,
                            }
                        }
                    },
                    // interval: "60s", // Optional: Override Prometheus default scrape interval
                    // timeout: "30s", // Optional: Override Prometheus default scrape timeout
                },
            }, resourceOpts);
            this.probes.push(probe);
        }

        // Alerting Rules
        this.alertRules = new k8s.apiextensions.CustomResource(`${name}-alerts`, {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "PrometheusRule",
            metadata: {
                name: `${name}-network-alerts`,
                namespace: promNamespace, // Rules typically go in Prometheus namespace
                labels: { ...promOperatorLabels },
            },
            spec: {
                groups: [{
                    name: `${name}-network.rules`,
                    rules: [
                        // Blackbox Probe Failure Alert
                        {
                            alert: "BlackboxProbeFailed",
                            expr: `probe_success == 0`,
                            for: "5m", // Alert if probe fails for 5 minutes
                            labels: { severity: "critical", component: name },
                            annotations: {
                                summary: "Blackbox probe failed (Instance: {{ $labels.instance }})",
                                description: "Probe target {{ $labels.probe_target }} ({{ $labels.probe_url }}) is down.\n Module: {{ $labels.module }}",
                            },
                        },
                        // Blackbox Probe High Latency Alert
                        {
                            alert: "BlackboxProbeSlow",
                            // Adjust threshold as needed (e.g., 1 second)
                            expr: `probe_duration_seconds > 1`,
                            for: "5m",
                            labels: { severity: "warning", component: name },
                            annotations: {
                                summary: "Blackbox probe slow (Instance: {{ $labels.instance }})",
                                description: "Probe target {{ $labels.probe_target }} ({{ $labels.probe_url }}) is responding slowly (>1s).\n Module: {{ $labels.module }}\n Duration: {{ $value }}s",
                            },
                        },
                        // Basic Node Network Alerts (Requires Node Exporter)
                        {
                            alert: "NodeNetworkReceiveErrors",
                            // Check node_network_receive_errs_total rate
                            expr: `rate(node_network_receive_errs_total[2m]) > 0`,
                            for: "5m",
                            labels: { severity: "warning", component: "node-exporter" },
                            annotations: {
                                summary: "High network receive errors detected on {{ $labels.instance }}",
                                description: "Node {{ $labels.instance }} interface {{ $labels.device }} has a high rate of network receive errors.",
                            },
                        },
                         {
                            alert: "NodeNetworkTransmitErrors",
                            expr: `rate(node_network_transmit_errs_total[2m]) > 0`,
                            for: "5m",
                            labels: { severity: "warning", component: "node-exporter" },
                            annotations: {
                                summary: "High network transmit errors detected on {{ $labels.instance }}",
                                description: "Node {{ $labels.instance }} interface {{ $labels.device }} has a high rate of network transmit errors.",
                            },
                        },
                    ],
                }],
            },
        }, resourceOpts);


        // --- Periodic Bandwidth Test (Optional CronJob) ---
        if (args.enableBandwidthTests) {
            if (!args.pushgatewayUrl) {
                throw new Error("'pushgatewayUrl' must be provided when 'enableBandwidthTests' is true.");
            }
            if (!args.iperfTargetHost) {
                 pulumi.log.warn(`'enableBandwidthTests' is true but 'iperfTargetHost' is not specified for ${name}. Test may not function correctly.`);
            }

            const cronJobName = `${name}-iperf-test`;
            const cronJobLabels = { app: "iperf-tester", component: name };

            // Simple script to run iperf3 and push metrics
            const iperfScript = pulumi.all([args.pushgatewayUrl, args.iperfTargetHost]).apply(([pushgateway, targetHost]) => `
#!/bin/sh
set -e

TARGET_HOST="${targetHost}"
PUSHGATEWAY_URL="${pushgateway}"
JOB_NAME="iperf3_bandwidth_test"
INSTANCE_NAME=\`hostname\` # Use pod hostname as instance

echo "Starting iperf3 test to ${TARGET_HOST}..."
# Run iperf3 client, parse output for bandwidth
# Adjust iperf3 flags as needed (-t duration, -P parallelism, -R reverse)
RESULT=\`iperf3 -c ${TARGET_HOST} -t 5 -f m -J | jq '.end.sum_received.bits_per_second / 1000000'\` # Mbps received

if [ -z "$RESULT" ]; then
  echo "iperf3 test failed or produced no result."
  RESULT=0 # Report 0 on failure
fi

echo "iPerf3 Result (Mbps): $RESULT"

# Push metric to Pushgateway
METRIC_NAME="iperf3_bandwidth_mbps"
cat <<EOF | curl --data-binary @- ${PUSHGATEWAY_URL}/metrics/job/\${JOB_NAME}/instance/\${INSTANCE_NAME}
# TYPE \${METRIC_NAME} gauge
\${METRIC_NAME}{target="\${TARGET_HOST}"} \${RESULT}
EOF

echo "Pushed metrics to Pushgateway."
`);

            this.bandwidthTestCronJob = new k8s.batch.v1.CronJob(`${name}-iperf-cj`, {
                metadata: {
                    name: cronJobName,
                    namespace: args.namespace,
                    labels: cronJobLabels,
                },
                spec: {
                    schedule: args.bandwidthTestSchedule ?? "0 * * * *", // Every hour
                    jobTemplate: {
                        spec: {
                            template: {
                                metadata: { labels: cronJobLabels },
                                spec: {
                                    containers: [{
                                        name: "iperf-tester",
                                        // Image needs iperf3, jq, curl, and potentially network tools
                                        image: "alpine/iperf3", // Very basic, might need a custom image with jq/curl
                                        // Or use a more complete image: e.g., appropriate network-utils image
                                        command: ["/bin/sh", "-c", iperfScript],
                                        // Add resource limits/requests
                                    }],
                                    restartPolicy: "OnFailure",
                                    // serviceAccountName: // Add if specific permissions needed
                                    // hostNetwork: true, // Consider if testing node-to-node directly is needed
                                },
                            },
                        },
                    },
                    concurrencyPolicy: "Forbid", // Prevent multiple test runs overlapping
                    successfulJobsHistoryLimit: 1,
                    failedJobsHistoryLimit: 3,
                },
            }, resourceOpts);
        }

        // --- Network Policies ---
        // Allow Prometheus to scrape Blackbox Exporter
        const allowPrometheusNetPol = new kx.NetworkPolicy(`${name}-allow-prom-bb`, {
            metadata: { namespace: args.namespace, name: `${name}-allow-prom-bb` },
            spec: {
                podSelector: { matchLabels: blackboxLabels },
                policyTypes: ["Ingress"],
                ingress: [{
                    from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": promNamespace } } }],
                    ports: [{ protocol: "TCP", port: 9115 }],
                }],
            }
        }, resourceOpts);

        // Allow Blackbox Exporter egress for probing
        const allowBlackboxEgressNetPol = new kx.NetworkPolicy(`${name}-allow-bb-egress`, {
             metadata: { namespace: args.namespace, name: `${name}-allow-bb-egress` },
             spec: {
                 podSelector: { matchLabels: blackboxLabels },
                 policyTypes: ["Egress"],
                 egress: [
                     { // Allow DNS
                         ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
                     },
                     { // Allow egress to any IP/Port for probing - adjust if possible
                       // Ideally, restrict to known internal/external IP ranges or specific services
                       // to: [{ ipBlock: { cidr: "0.0.0.0/0" }}] // Example: Allow all egress
                     }
                 ],
             }
        }, resourceOpts);

        // Allow iperf CronJob egress (to target and Pushgateway)
        if (args.enableBandwidthTests && this.bandwidthTestCronJob) {
             const allowIperfEgressNetPol = new kx.NetworkPolicy(`${name}-allow-iperf-egress`, {
                 metadata: { namespace: args.namespace, name: `${name}-allow-iperf-egress` },
                 spec: {
                     podSelector: { matchLabels: { "job-name": cronJobName } }, // Select pods created by the CronJob
                     policyTypes: ["Egress"],
                     egress: [
                         { // Allow DNS
                             ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
                         },
                         { // Allow egress to Pushgateway (assuming internal service)
                             // This requires knowing the Pushgateway namespace/pod selector or IP
                             // Example: Allow to monitoring namespace
                             to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": promNamespace } } }],
                             ports: [{ protocol: "TCP", port: 9091 }] // Default Pushgateway port
                         },
                         { // Allow egress to iperf target host
                             // This is tricky without knowing the target. Allow all TCP for simplicity here.
                             // to: [{ ipBlock: { cidr: "0.0.0.0/0" }}], // Restrict if possible
                             ports: [{ protocol: "TCP" }] // Allow any TCP port for iperf
                         }
                     ],
                 }
             }, resourceOpts);
        }


        // --- Grafana Integration Notes ---
        // - This component sets up Prometheus metrics (probe_success, probe_duration_seconds, node_network_*, iperf3_bandwidth_mbps).
        // - Grafana dashboards need to be configured separately to visualize these metrics.
        // - Useful dashboards:
        //   - Blackbox Exporter overview (showing probe status, latency heatmap).
        //   - Node Exporter network details (throughput, errors, packets per interface).
        //   - Bandwidth test history chart.
        // - Ensure Grafana has the Prometheus instance (where these metrics are stored) configured as a data source.

        // --- Security Considerations ---
        // - Blackbox Exporter config doesn't contain secrets, but limit access to the ConfigMap.
        // - NetworkPolicies limit traffic, but review egress rules for Blackbox/iperf carefully. Avoid overly broad rules like allowing all egress if possible.
        // - Ensure Prometheus, Alertmanager, Grafana, Pushgateway are themselves secured (authentication, TLS).
        // - Container images should be scanned for vulnerabilities. Use specific tags, not 'latest'.
        // - Apply least privilege principle for any ServiceAccounts used (e.g., for CronJob if needed).

        this.registerOutputs({
            blackboxExporterServiceName: this.blackboxExporterService.metadata.name,
            // Add other relevant outputs if needed
        });
    }
}

// Example Usage (within your main Pulumi program)
/*
const netMon = new NetworkMonitoring("homelab-netmon", {
    namespace: "network-monitoring", // Deploy tools into this namespace
    prometheusNamespace: "monitoring", // Location of Prometheus/Alertmanager
    internalProbeTargets: [
        { name: "kubernetes-api", url: "https://kubernetes.default.svc:443", module: "http_2xx" }, // Note: Needs Blackbox config adjustment for TLS verification if needed
        { name: "prometheus-svc", url: "http://prometheus-k8s.monitoring.svc:9090", module: "http_2xx" },
        { name: "postgres-db", url: "tcp://main-postgres-postgresql.databases.svc:5432", module: "tcp_connect" },
    ],
    externalProbeTargets: [
        { name: "google-dns-tcp", url: "tcp://1.1.1.1:53", module: "tcp_connect" },
        { name: "google-dns-icmp", url: "1.1.1.1", module: "icmp" },
        { name: "cloudflare-web", url: "https://1.1.1.1", module: "http_2xx" },
    ],
    enableBandwidthTests: true,
    pushgatewayUrl: "http://prometheus-pushgateway.monitoring.svc:9091",
    iperfTargetHost: "iperf-server.default.svc", // Assumes an iperf server service exists
});

export const blackboxServiceName = netMon.blackboxExporterServiceName;
*/
