import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { OpenTelemetryOperator } from "./openTelemetryOperator";
import { OpenTelemetryCollectors } from "./openTelemetryCollectors";
import { Prometheus } from "./prometheus";
import { ServiceMonitors } from "./serviceMonitors";
import { PrometheusRules } from "./prometheusRules";
import { AlertManager } from "./alertManager";
import { Loki } from "./loki";
import { Tempo } from "./tempo";
import { Grafana } from "./grafana";
import { GrafanaDashboards } from "./grafanaDashboards";

interface ObservabilityStackArgs {
    namespace: string;
    domain: string;
    storageClass: string;
    grafanaAuthProxy?: {
        headerName: string;
        headerValue: string;
    };
    alerting?: {
        email?: {
            from: string;
            smartHost: string;
            username: string;
            password: string;
            recipients: string[];
        };
        slack?: {
            webhookUrl: string;
            channel: string;
        };
    };
}

export class ObservabilityStack extends pulumi.ComponentResource {
    constructor(name: string, args: ObservabilityStackArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:ObservabilityStack", name, args, opts);

        // Create namespace if it doesn't exist
        const namespace = new k8s.core.v1.Namespace("monitoring", {
            metadata: {
                name: args.namespace,
                labels: {
                    "kubernetes.io/metadata.name": args.namespace,
                    "observability": "true",
                },
            },
        }, { parent: this });

        // Deploy OpenTelemetry Operator first
        const otelOperator = new OpenTelemetryOperator("otel-operator", {
            namespace: args.namespace,
        }, { parent: this, dependsOn: [namespace] });

        // Deploy storage components
        const prometheus = new Prometheus("prometheus", {
            namespace: args.namespace,
            storageClass: args.storageClass,
            retentionTime: "15d",
            resources: {
                requests: {
                    cpu: "200m",
                    memory: "512Mi",
                },
                limits: {
                    cpu: "1",
                    memory: "2Gi",
                },
            },
        }, { parent: this, dependsOn: [namespace] });

        const loki = new Loki("loki", {
            namespace: args.namespace,
            storageClass: args.storageClass,
        }, { parent: this, dependsOn: [namespace] });

        const tempo = new Tempo("tempo", {
            namespace: args.namespace,
            storageClass: args.storageClass,
        }, { parent: this, dependsOn: [namespace] });

        // Deploy collectors after storage is ready
        const collectors = new OpenTelemetryCollectors("collectors", {
            namespace: args.namespace,
            endpoints: {
                prometheus: prometheus.getEndpoint(),
                loki: loki.getEndpoint(),
                tempo: tempo.getEndpoint(),
            },
        }, { parent: this, dependsOn: [otelOperator, prometheus, loki, tempo] });

        // Configure monitoring
        const serviceMonitors = new ServiceMonitors("monitors", {
            namespace: args.namespace,
        }, { parent: this, dependsOn: [prometheus] });

        const rules = new PrometheusRules("rules", {
            namespace: args.namespace,
        }, { parent: this, dependsOn: [prometheus] });

        const alertManager = new AlertManager("alertmanager", {
            namespace: args.namespace,
            notifications: args.alerting,
        }, { parent: this, dependsOn: [prometheus] });

        // Deploy Grafana last
        const grafana = new Grafana("grafana", {
            namespace: args.namespace,
            domain: `grafana.${args.domain}`,
            storageClass: args.storageClass,
            authProxyHeaderName: args.grafanaAuthProxy?.headerName,
            authProxyHeaderValue: args.grafanaAuthProxy?.headerValue,
            dataSources: {
                prometheus: prometheus.getEndpoint(),
                loki: loki.getEndpoint(),
                tempo: tempo.getEndpoint(),
            },
        }, { parent: this, dependsOn: [prometheus, loki, tempo] });

        // Configure dashboards
        const dashboards = new GrafanaDashboards("dashboards", {
            namespace: args.namespace,
            dashboardsPath: "./dashboards",
            deploymentName: grafana.getDeploymentName(),
        }, { parent: this, dependsOn: [grafana] });

        // Health check job
        const healthCheck = new k8s.batch.v1.CronJob("observability-health", {
            metadata: {
                name: "observability-health",
                namespace: args.namespace,
            },
            spec: {
                schedule: "*/5 * * * *",  // Every 5 minutes
                jobTemplate: {
                    spec: {
                        template: {
                            spec: {
                                containers: [{
                                    name: "health-check",
                                    image: "curlimages/curl:latest",
                                    command: ["/bin/sh", "-c"],
                                    args: [
                                        `
                                        # Check Prometheus
                                        curl -sf http://prometheus-operated:9090/-/healthy || exit 1
                                        # Check Loki
                                        curl -sf http://loki:3100/ready || exit 1
                                        # Check Tempo
                                        curl -sf http://tempo:3200/ready || exit 1
                                        # Check Grafana
                                        curl -sf http://grafana:3000/api/health || exit 1
                                        # Check OpenTelemetry Collector
                                        curl -sf http://otel-collector:13133/health || exit 1
                                        `
                                    ],
                                }],
                                restartPolicy: "OnFailure",
                            },
                        },
                    },
                },
            },
        }, { parent: this, dependsOn: [prometheus, loki, tempo, grafana, collectors] });

        // Export stack outputs
        this.registerOutputs({
            namespace: namespace.metadata.name,
            grafanaUrl: pulumi.interpolate`https://grafana.${args.domain}`,
            prometheusUrl: prometheus.getEndpoint(),
            lokiUrl: loki.getEndpoint(),
            tempoUrl: tempo.getEndpoint(),
        });
    }
}

/* example usage:
const observability = new ObservabilityStack("observability", {
    namespace: "monitoring",
    domain: "homelab.local",
    storageClass: "local-path",
    grafanaAuthProxy: {
        headerName: "X-WEBAUTH-USER",
        headerValue: "${user}"
    },
    alerting: {
        email: {
            from: "alerts@homelab.local",
            smartHost: "smtp.gmail.com:587",
            username: "alerts@gmail.com",
            password: "app-password",
            recipients: ["admin@homelab.local"]
        }
    }
});
*/
