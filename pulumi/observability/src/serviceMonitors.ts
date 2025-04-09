import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface ServiceMonitorArgs {
    /**
     * Namespace where ServiceMonitors will be created
     */
    namespace: string;

    /**
     * Additional labels to apply to ServiceMonitors
     */
    labels?: { [key: string]: string };

    /**
     * Scrape configuration defaults
     */
    defaultConfig?: {
        scrapeInterval?: string;
        scrapeTimeout?: string;
        honorLabels?: boolean;
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class ServiceMonitors extends pulumi.ComponentResource {
    /**
     * All created ServiceMonitors
     */
    public readonly serviceMonitors: k8s.apiextensions.CustomResource[];

    constructor(name: string, args: ServiceMonitorArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:ServiceMonitors", name, args, opts);

        const prefix = args.namePrefix || "";
        const defaultConfig = {
            scrapeInterval: "30s",
            scrapeTimeout: "10s",
            honorLabels: true,
            ...args.defaultConfig
        };

        const commonLabels = {
            "monitoring.grafana.com/enabled": "true",
            ...args.labels
        };

        this.serviceMonitors = [
            // Kubernetes components monitor
            new k8s.apiextensions.CustomResource(`${prefix}k8s-components`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}k8s-components`,
                    namespace: args.namespace,
                    labels: commonLabels
                },
                spec: {
                    jobLabel: "k8s-app",
                    endpoints: [
                        {
                            port: "https-metrics",
                            scheme: "https",
                            interval: "30s",
                            scrapeTimeout: "10s",
                            honorLabels: true,
                            tlsConfig: {
                                insecureSkipVerify: true,
                                caFile: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
                            },
                            bearerTokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token"
                        }
                    ],
                    namespaceSelector: {
                        matchNames: ["kube-system"]
                    },
                    selector: {
                        matchLabels: {
                            "k8s-app": "kubernetes-components"
                        }
                    }
                }
            }, { provider, parent: this }),

            // RabbitMQ monitor
            new k8s.apiextensions.CustomResource(`${prefix}rabbitmq`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}rabbitmq`,
                    namespace: args.namespace,
                    labels: commonLabels
                },
                spec: {
                    endpoints: [
                        {
                            port: "prometheus",
                            interval: defaultConfig.scrapeInterval,
                            scrapeTimeout: defaultConfig.scrapeTimeout,
                            path: "/metrics",
                            honorLabels: defaultConfig.honorLabels,
                            relabelings: [
                                {
                                    sourceLabels: ["__meta_kubernetes_pod_name"],
                                    targetLabel: "pod",
                                    action: "replace"
                                }
                            ]
                        }
                    ],
                    namespaceSelector: {
                        matchNames: ["data"]
                    },
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "rabbitmq"
                        }
                    }
                }
            }, { provider, parent: this }),

            // Triton Inference Server monitor
            new k8s.apiextensions.CustomResource(`${prefix}triton`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}triton`,
                    namespace: args.namespace,
                    labels: commonLabels
                },
                spec: {
                    endpoints: [
                        {
                            port: "metrics",
                            interval: "15s",  // More frequent for ML metrics
                            scrapeTimeout: "5s",
                            path: "/metrics",
                            honorLabels: defaultConfig.honorLabels,
                            metricRelabelings: [
                                {
                                    sourceLabels: ["model_name"],
                                    targetLabel: "model",
                                    action: "replace"
                                }
                            ]
                        }
                    ],
                    namespaceSelector: {
                        matchNames: ["ai"]
                    },
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "triton-inference-server"
                        }
                    }
                }
            }, { provider, parent: this }),

            // Ray Cluster monitor
            new k8s.apiextensions.CustomResource(`${prefix}ray`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}ray`,
                    namespace: args.namespace,
                    labels: commonLabels
                },
                spec: {
                    endpoints: [
                        {
                            port: "dashboard",
                            interval: defaultConfig.scrapeInterval,
                            scrapeTimeout: defaultConfig.scrapeTimeout,
                            path: "/metrics",
                            honorLabels: defaultConfig.honorLabels,
                            relabelings: [
                                {
                                    sourceLabels: ["__meta_kubernetes_pod_label_ray_io_node_type"],
                                    targetLabel: "ray_node_type",
                                    action: "replace"
                                }
                            ]
                        }
                    ],
                    namespaceSelector: {
                        matchNames: ["ai"]
                    },
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "ray"
                        }
                    }
                }
            }, { provider, parent: this }),

            // n8n monitor
            new k8s.apiextensions.CustomResource(`${prefix}n8n`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}n8n`,
                    namespace: args.namespace,
                    labels: commonLabels
                },
                spec: {
                    endpoints: [
                        {
                            port: "metrics",
                            interval: defaultConfig.scrapeInterval,
                            scrapeTimeout: defaultConfig.scrapeTimeout,
                            path: "/metrics",
                            honorLabels: defaultConfig.honorLabels
                        }
                    ],
                    namespaceSelector: {
                        matchNames: ["apps"]
                    },
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "n8n"
                        }
                    }
                }
            }, { provider, parent: this }),

            // Custom applications monitor
            new k8s.apiextensions.CustomResource(`${prefix}custom-apps`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${prefix}custom-apps`,
                    namespace: args.namespace,
                    labels: commonLabels
                },
                spec: {
                    endpoints: [
                        {
                            port: "metrics",
                            interval: defaultConfig.scrapeInterval,
                            scrapeTimeout: defaultConfig.scrapeTimeout,
                            path: "/metrics",
                            honorLabels: defaultConfig.honorLabels,
                            relabelings: [
                                {
                                    sourceLabels: ["__meta_kubernetes_service_label_app_kubernetes_io_name"],
                                    targetLabel: "app",
                                    action: "replace"
                                },
                                {
                                    sourceLabels: ["__meta_kubernetes_namespace"],
                                    targetLabel: "namespace",
                                    action: "replace"
                                }
                            ]
                        }
                    ],
                    namespaceSelector: {
                        any: true  // Monitor all namespaces
                    },
                    selector: {
                        matchLabels: {
                            "monitoring.homelab/scrape": "true"
                        }
                    }
                }
            }, { provider, parent: this })
        ];

        this.registerOutputs({
            serviceMonitors: this.serviceMonitors
        });
    }
}
