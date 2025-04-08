import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface RabbitMQClusterArgs {
    /**
     * Namespace where the cluster will be deployed
     */
    namespace: string;

    /**
     * High availability configuration
     */
    highAvailability?: {
        replicas?: number;
        availabilityZones?: string[];
        quorumMode?: boolean;
    };

    /**
     * Resource configuration
     */
    resources?: {
        requests?: {
            cpu?: string;
            memory?: string;
            storage?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
            storage?: string;
        };
    };

    /**
     * Monitoring configuration
     */
    monitoring?: {
        enabled: boolean;
        prometheusRules?: boolean;
        openTelemetry?: {
            enabled: boolean;
            endpoint?: string;
        };
    };

    /**
     * Virtual hosts configuration
     */
    virtualHosts?: Array<{
        name: string;
        tags?: string[];
    }>;

    /**
     * Domain-specific exchanges
     */
    exchanges?: Array<{
        name: string;
        vhost: string;
        type: "direct" | "fanout" | "topic" | "headers";
        durable?: boolean;
        autoDelete?: boolean;
    }>;

    /**
     * Plugins to enable
     */
    plugins?: string[];

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class RabbitMQCluster extends pulumi.ComponentResource {
    /**
     * The RabbitMQ cluster custom resource
     */
    public readonly cluster: k8s.apiextensions.CustomResource;

    /**
     * The cluster's admin secret
     */
    public readonly adminSecret: k8s.core.v1.Secret;

    constructor(name: string, args: RabbitMQClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:rabbitmq:Cluster", name, args, opts);

        const prefix = args.namePrefix || "";

        // Default configuration
        const defaultConfig = {
            highAvailability: {
                replicas: 3,
                quorumMode: true
            },
            resources: {
                requests: {
                    cpu: "500m",
                    memory: "1Gi",
                    storage: "10Gi"
                },
                limits: {
                    cpu: "2",
                    memory: "2Gi",
                    storage: "20Gi"
                }
            },
            plugins: [
                "rabbitmq_management",
                "rabbitmq_peer_discovery_k8s",
                "rabbitmq_prometheus",
                "rabbitmq_federation",
                "rabbitmq_federation_management",
                "rabbitmq_shovel",
                "rabbitmq_shovel_management",
                "rabbitmq_auth_backend_oauth2"
            ]
        };

        // Merge configurations
        const config = {
            highAvailability: { ...defaultConfig.highAvailability, ...args.highAvailability },
            resources: { ...defaultConfig.resources, ...args.resources },
            plugins: [...new Set([...defaultConfig.plugins, ...(args.plugins || [])])]
        };

        // Create admin secret
        this.adminSecret = new k8s.core.v1.Secret(`${prefix}rabbitmq-admin`, {
            metadata: {
                name: `${prefix}rabbitmq-admin`,
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq",
                    "app.kubernetes.io/instance": name,
                    "app.kubernetes.io/managed-by": "pulumi"
                }
            },
            stringData: {
                username: "admin",
                password: pulumi.secret(Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8))
            }
        }, { provider, parent: this });

        // Create RabbitMQ cluster
        this.cluster = new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-cluster`, {
            apiVersion: "rabbitmq.com/v1beta1",
            kind: "RabbitmqCluster",
            metadata: {
                name: `${prefix}rabbitmq`,
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq",
                    "app.kubernetes.io/instance": name,
                    "app.kubernetes.io/managed-by": "pulumi"
                }
            },
            spec: {
                replicas: config.highAvailability.replicas,
                rabbitmq: {
                    additionalConfig: `
                        cluster_formation.peer_discovery_backend = rabbit_peer_discovery_k8s
                        cluster_formation.k8s.host = kubernetes.default
                        cluster_formation.k8s.address_type = hostname
                        cluster_partition_handling = autoheal
                        queue_master_locator = min-masters
                        ${config.highAvailability.quorumMode ? "default_queue_type = quorum" : ""}
                        collect_statistics_interval = 10000
                        cluster_name = ${name}
                    `,
                    additionalPlugins: config.plugins,
                    advancedConfig: `
                        [{kernel, [
                            {net_ticktime, 10},
                            {inet_dist_listen_min, 25672},
                            {inet_dist_listen_max, 25672}
                        ]}].
                    `
                },
                service: {
                    type: "ClusterIP",
                    annotations: {
                        "prometheus.io/scrape": "true",
                        "prometheus.io/port": "15692"
                    }
                },
                persistence: {
                    storageClassName: "local-path",
                    storage: config.resources.requests.storage
                },
                resources: {
                    requests: {
                        cpu: config.resources.requests.cpu,
                        memory: config.resources.requests.memory
                    },
                    limits: {
                        cpu: config.resources.limits.cpu,
                        memory: config.resources.limits.memory
                    }
                },
                affinity: {
                    podAntiAffinity: {
                        preferredDuringSchedulingIgnoredDuringExecution: [{
                            weight: 100,
                            podAffinityTerm: {
                                labelSelector: {
                                    matchExpressions: [{
                                        key: "app.kubernetes.io/name",
                                        operator: "In",
                                        values: ["rabbitmq"]
                                    }]
                                },
                                topologyKey: "kubernetes.io/hostname"
                            }
                        }]
                    }
                },
                override: {
                    statefulSet: {
                        spec: {
                            template: {
                                spec: {
                                    containers: [{
                                        name: "rabbitmq",
                                        env: [
                                            {
                                                name: "RABBITMQ_ENABLED_PLUGINS_FILE",
                                                value: "/etc/rabbitmq/enabled_plugins"
                                            }
                                        ]
                                    }]
                                }
                            }
                        }
                    }
                }
            }
        }, { provider, parent: this, dependsOn: [this.adminSecret] });

        // Create virtual hosts
        if (args.virtualHosts) {
            args.virtualHosts.forEach((vhost, index) => {
                new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-vhost-${index}`, {
                    apiVersion: "rabbitmq.com/v1beta1",
                    kind: "Vhost",
                    metadata: {
                        name: `${prefix}${vhost.name}`,
                        namespace: args.namespace
                    },
                    spec: {
                        name: vhost.name,
                        tags: vhost.tags || [],
                        rabbitmqClusterReference: {
                            name: this.cluster.metadata.name
                        }
                    }
                }, { provider, parent: this, dependsOn: [this.cluster] });
            });
        }

        // Create exchanges
        if (args.exchanges) {
            args.exchanges.forEach((exchange, index) => {
                new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-exchange-${index}`, {
                    apiVersion: "rabbitmq.com/v1beta1",
                    kind: "Exchange",
                    metadata: {
                        name: `${prefix}${exchange.name}`,
                        namespace: args.namespace
                    },
                    spec: {
                        name: exchange.name,
                        vhost: exchange.vhost,
                        type: exchange.type,
                        durable: exchange.durable ?? true,
                        autoDelete: exchange.autoDelete ?? false,
                        rabbitmqClusterReference: {
                            name: this.cluster.metadata.name
                        }
                    }
                }, { provider, parent: this, dependsOn: [this.cluster] });
            });
        }

        // Set up monitoring if enabled
        if (args.monitoring?.enabled) {
            // Create ServiceMonitor
            new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-servicemonitor`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}rabbitmq`,
                    namespace: args.namespace,
                    labels: {
                        "app.kubernetes.io/name": "rabbitmq",
                        "app.kubernetes.io/instance": name
                    }
                },
                spec: {
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "rabbitmq",
                            "app.kubernetes.io/instance": name
                        }
                    },
                    endpoints: [{
                        port: "prometheus",
                        interval: "10s"
                    }]
                }
            }, { provider, parent: this, dependsOn: [this.cluster] });

            // Set up OpenTelemetry if enabled
            if (args.monitoring.openTelemetry?.enabled) {
                new k8s.core.v1.ConfigMap(`${prefix}rabbitmq-otel-config`, {
                    metadata: {
                        name: `${prefix}rabbitmq-otel-config`,
                        namespace: args.namespace
                    },
                    data: {
                        "otel-collector-config.yaml": `
                            receivers:
                              otlp:
                                protocols:
                                  grpc:
                                    endpoint: "0.0.0.0:4317"

                            exporters:
                              otlp:
                                endpoint: "${args.monitoring.openTelemetry.endpoint || "otel-collector:4317"}"
                                tls:
                                  insecure: true

                            service:
                              pipelines:
                                traces:
                                  receivers: [otlp]
                                  exporters: [otlp]
                        `
                    }
                }, { provider, parent: this });
            }
        }

        this.registerOutputs({
            cluster: this.cluster,
            adminSecret: this.adminSecret
        });
    }
}
