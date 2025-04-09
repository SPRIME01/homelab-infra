import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface PrometheusArgs {
    /**
     * Namespace where Prometheus will be deployed
     */
    namespace: string;

    /**
     * Storage configuration
     */
    storage?: {
        size: string;
        storageClass?: string;
        retentionDays?: number;
    };

    /**
     * Resource limits
     */
    resources?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };

    /**
     * OpenTelemetry configuration
     */
    openTelemetry?: {
        endpoint: string;
        protocol: "http" | "grpc";
        headers?: Record<string, string>;
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class Prometheus extends pulumi.ComponentResource {
    /**
     * The Prometheus Custom Resource
     */
    public readonly prometheus: k8s.apiextensions.CustomResource;

    /**
     * Service monitors
     */
    public readonly serviceMonitors: k8s.apiextensions.CustomResource[];

    /**
     * Alert rules
     */
    public readonly prometheusRules: k8s.apiextensions.CustomResource[];

    constructor(name: string, args: PrometheusArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:Prometheus", name, args, opts);

        const prefix = args.namePrefix || "";

        // Default resource configuration for homelab environment
        const defaultResources = {
            requests: {
                cpu: "200m",
                memory: "512Mi"
            },
            limits: {
                cpu: "1",
                memory: "2Gi"
            }
        };

        const resources = args.resources || defaultResources;

        // Create Prometheus CR
        this.prometheus = new k8s.apiextensions.CustomResource(`${prefix}prometheus`, {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "Prometheus",
            metadata: {
                name: `${prefix}prometheus`,
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "prometheus",
                    "app.kubernetes.io/part-of": "monitoring"
                }
            },
            spec: {
                replicas: 1,
                version: "v2.45.0",
                serviceAccountName: "prometheus",
                podMonitorSelector: {},
                serviceMonitorSelector: {},
                resources: resources,
                retention: `${args.storage?.retentionDays || 15}d`,
                storage: args.storage ? {
                    volumeClaimTemplate: {
                        spec: {
                            storageClassName: args.storage.storageClass,
                            resources: {
                                requests: {
                                    storage: args.storage.size
                                }
                            }
                        }
                    }
                } : undefined,
                // OpenTelemetry integration
                remoteWrite: args.openTelemetry ? [{
                    url: args.openTelemetry.endpoint,
                    remoteTimeout: "30s",
                    writeRelabelConfigs: [{
                        sourceLabels: ["__name__"],
                        regex: "up|node.*|kube.*|container.*|triton.*|ray.*|rabbitmq.*",
                        action: "keep"
                    }],
                    headers: args.openTelemetry.headers
                }] : undefined,
                securityContext: {
                    fsGroup: 2000,
                    runAsNonRoot: true,
                    runAsUser: 1000
                }
            }
        }, { provider, parent: this });

        // Create service monitors
        this.serviceMonitors = [
            // Kubernetes components monitor
            new k8s.apiextensions.CustomResource(`${prefix}k8s-monitor`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}k8s-components`,
                    namespace: args.namespace
                },
                spec: {
                    endpoints: [
                        {
                            port: "https-metrics",
                            scheme: "https",
                            interval: "30s",
                            scrapeTimeout: "30s",
                            bearerTokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token",
                            tlsConfig: {
                                insecureSkipVerify: true
                            }
                        }
                    ],
                    selector: {
                        matchLabels: {
                            "k8s-app": "kubernetes-components"
                        }
                    },
                    namespaceSelector: {
                        matchNames: ["kube-system"]
                    }
                }
            }, { provider, parent: this }),

            // RabbitMQ monitor
            new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-monitor`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}rabbitmq`,
                    namespace: args.namespace
                },
                spec: {
                    endpoints: [
                        {
                            port: "prometheus",
                            interval: "30s",
                            scrapeTimeout: "30s"
                        }
                    ],
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "rabbitmq"
                        }
                    },
                    namespaceSelector: {
                        matchNames: ["data"]
                    }
                }
            }, { provider, parent: this }),

            // Triton monitor
            new k8s.apiextensions.CustomResource(`${prefix}triton-monitor`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}triton`,
                    namespace: args.namespace
                },
                spec: {
                    endpoints: [
                        {
                            port: "metrics",
                            interval: "30s",
                            scrapeTimeout: "30s"
                        }
                    ],
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "triton-inference-server"
                        }
                    },
                    namespaceSelector: {
                        matchNames: ["ai"]
                    }
                }
            }, { provider, parent: this }),

            // Ray monitor
            new k8s.apiextensions.CustomResource(`${prefix}ray-monitor`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}ray`,
                    namespace: args.namespace
                },
                spec: {
                    endpoints: [
                        {
                            port: "dashboard",
                            interval: "30s",
                            scrapeTimeout: "30s",
                            path: "/metrics"
                        }
                    ],
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "ray"
                        }
                    },
                    namespaceSelector: {
                        matchNames: ["ai"]
                    }
                }
            }, { provider, parent: this })
        ];

        // Create alert rules
        this.prometheusRules = [
            new k8s.apiextensions.CustomResource(`${prefix}alert-rules`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "PrometheusRule",
                metadata: {
                    name: `${prefix}homelab-alerts`,
                    namespace: args.namespace,
                    labels: {
                        "app.kubernetes.io/name": "prometheus",
                        "app.kubernetes.io/part-of": "monitoring",
                        "prometheus": "homelab"
                    }
                },
                spec: {
                    groups: [
                        // Node alerts
                        {
                            name: "node.rules",
                            rules: [
                                {
                                    alert: "NodeHighCPU",
                                    expr: "avg(node_cpu_seconds_total{mode='idle'}) by (instance) < 0.2",
                                    for: "5m",
                                    labels: {
                                        severity: "warning",
                                        area: "system"
                                    },
                                    annotations: {
                                        summary: "Node CPU usage high",
                                        description: "Node {{ $labels.instance }} CPU usage is above 80% for 5 minutes"
                                    }
                                },
                                {
                                    alert: "NodeHighMemory",
                                    expr: "(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.85",
                                    for: "5m",
                                    labels: {
                                        severity: "warning",
                                        area: "system"
                                    },
                                    annotations: {
                                        summary: "Node memory usage high",
                                        description: "Node {{ $labels.instance }} memory usage is above 85% for 5 minutes"
                                    }
                                }
                            ]
                        },
                        // RabbitMQ alerts
                        {
                            name: "rabbitmq.rules",
                            rules: [
                                {
                                    alert: "RabbitmqNodeDown",
                                    expr: "rabbitmq_up == 0",
                                    for: "1m",
                                    labels: {
                                        severity: "critical",
                                        area: "messaging"
                                    },
                                    annotations: {
                                        summary: "RabbitMQ node down",
                                        description: "RabbitMQ node {{ $labels.node }} is down"
                                    }
                                }
                            ]
                        },
                        // Triton alerts
                        {
                            name: "triton.rules",
                            rules: [
                                {
                                    alert: "TritonHighLatency",
                                    expr: "rate(nv_inference_request_duration_us[5m]) / 1000 > 1000",
                                    for: "5m",
                                    labels: {
                                        severity: "warning",
                                        area: "ai"
                                    },
                                    annotations: {
                                        summary: "Triton inference latency high",
                                        description: "Model {{ $labels.model_name }} inference latency is above 1 second"
                                    }
                                }
                            ]
                        }
                    ]
                }
            }, { provider, parent: this })
        ];

        this.registerOutputs({
            prometheus: this.prometheus,
            serviceMonitors: this.serviceMonitors,
            prometheusRules: this.prometheusRules
        });
    }
}
