import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "./k8sProvider";

export interface MonitoringNamespaceArgs {
    /**
     * Resource quotas for the monitoring namespace
     */
    quotas?: {
        cpu?: {
            request: string;
            limit: string;
        };
        memory?: {
            request: string;
            limit: string;
        };
        storage?: {
            capacity: string;
        };
        pods?: number;
    };

    /**
     * Network policy settings
     */
    networkPolicies?: {
        ingressNamespaces?: string[];
        egressNamespaces?: string[];
        customPolicies?: k8s.types.input.networking.v1.NetworkPolicySpec[];
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class MonitoringNamespace extends pulumi.ComponentResource {
    /**
     * The created namespace
     */
    public readonly namespace: k8s.core.v1.Namespace;

    /**
     * The resource quota
     */
    public readonly resourceQuota: k8s.core.v1.ResourceQuota;

    /**
     * The limit range
     */
    public readonly limitRange: k8s.core.v1.LimitRange;

    /**
     * The network policies
     */
    public readonly networkPolicies: k8s.networking.v1.NetworkPolicy[];

    constructor(name: string, args: MonitoringNamespaceArgs = {}, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k8s:MonitoringNamespace", name, args, opts);

        const prefix = args.namePrefix || "";

        // Default quotas suitable for monitoring workloads
        const quotas = args.quotas || {
            cpu: {
                request: "4",
                limit: "8"
            },
            memory: {
                request: "8Gi",
                limit: "16Gi"
            },
            storage: {
                capacity: "100Gi"
            },
            pods: 50
        };

        // Create the namespace
        this.namespace = new k8s.core.v1.Namespace(`${prefix}monitoring`, {
            metadata: {
                name: "monitoring",
                labels: {
                    "homelab-managed": "true",
                    "app.kubernetes.io/managed-by": "pulumi",
                    "kubernetes.io/metadata.name": "monitoring",
                    "environment": "production",
                    "type": "observability",
                    "prometheus.io/scrape": "true"
                },
                annotations: {
                    "monitoring.grafana.com/dashboards": "enabled",
                    "monitoring.grafana.com/alerting": "enabled",
                    "monitoring.grafana.com/logging": "enabled",
                    "monitoring.grafana.com/tracing": "enabled"
                }
            }
        }, { provider, parent: this });

        // Create resource quota
        this.resourceQuota = new k8s.core.v1.ResourceQuota(`${prefix}monitoring-quota`, {
            metadata: {
                name: "monitoring-quota",
                namespace: this.namespace.metadata.name
            },
            spec: {
                hard: {
                    "requests.cpu": quotas.cpu?.request,
                    "limits.cpu": quotas.cpu?.limit,
                    "requests.memory": quotas.memory?.request,
                    "limits.memory": quotas.memory?.limit,
                    "requests.storage": quotas.storage?.capacity,
                    "pods": quotas.pods,
                    "services": "20",
                    "configmaps": "100",
                    "secrets": "100",
                    "persistentvolumeclaims": "20"
                }
            }
        }, { provider, parent: this });

        // Create limit range
        this.limitRange = new k8s.core.v1.LimitRange(`${prefix}monitoring-limits`, {
            metadata: {
                name: "monitoring-limits",
                namespace: this.namespace.metadata.name
            },
            spec: {
                limits: [
                    {
                        type: "Container",
                        default: {
                            cpu: "200m",
                            memory: "256Mi"
                        },
                        defaultRequest: {
                            cpu: "100m",
                            memory: "128Mi"
                        },
                        max: {
                            cpu: "2",
                            memory: "4Gi"
                        },
                        min: {
                            cpu: "50m",
                            memory: "64Mi"
                        }
                    },
                    {
                        type: "PersistentVolumeClaim",
                        max: {
                            storage: "50Gi"
                        },
                        min: {
                            storage: "1Gi"
                        }
                    }
                ]
            }
        }, { provider, parent: this });

        // Create network policies
        this.networkPolicies = [
            // Default deny all ingress
            new k8s.networking.v1.NetworkPolicy(`${prefix}monitoring-default-deny`, {
                metadata: {
                    name: "default-deny",
                    namespace: this.namespace.metadata.name
                },
                spec: {
                    podSelector: {},
                    policyTypes: ["Ingress"]
                }
            }, { provider, parent: this }),

            // Allow ingress from specified namespaces
            new k8s.networking.v1.NetworkPolicy(`${prefix}monitoring-allow-ingress`, {
                metadata: {
                    name: "allow-ingress",
                    namespace: this.namespace.metadata.name
                },
                spec: {
                    podSelector: {},
                    policyTypes: ["Ingress"],
                    ingress: [
                        {
                            from: [
                                // Allow from kube-system for metrics collection
                                {
                                    namespaceSelector: {
                                        matchLabels: {
                                            "kubernetes.io/metadata.name": "kube-system"
                                        }
                                    }
                                },
                                // Allow from specified namespaces
                                ...(args.networkPolicies?.ingressNamespaces || []).map(ns => ({
                                    namespaceSelector: {
                                        matchLabels: {
                                            "kubernetes.io/metadata.name": ns
                                        }
                                    }
                                }))
                            ]
                        }
                    ]
                }
            }, { provider, parent: this }),

            // Allow egress to necessary services
            new k8s.networking.v1.NetworkPolicy(`${prefix}monitoring-allow-egress`, {
                metadata: {
                    name: "allow-egress",
                    namespace: this.namespace.metadata.name
                },
                spec: {
                    podSelector: {},
                    policyTypes: ["Egress"],
                    egress: [
                        // Allow DNS resolution
                        {
                            to: [
                                {
                                    namespaceSelector: {
                                        matchLabels: {
                                            "kubernetes.io/metadata.name": "kube-system"
                                        }
                                    }
                                }
                            ],
                            ports: [
                                {
                                    protocol: "UDP",
                                    port: 53
                                }
                            ]
                        },
                        // Allow egress to specified namespaces
                        {
                            to: [
                                ...(args.networkPolicies?.egressNamespaces || []).map(ns => ({
                                    namespaceSelector: {
                                        matchLabels: {
                                            "kubernetes.io/metadata.name": ns
                                        }
                                    }
                                }))
                            ]
                        }
                    ]
                }
            }, { provider, parent: this }),

            // Allow Prometheus to scrape metrics
            new k8s.networking.v1.NetworkPolicy(`${prefix}monitoring-allow-prometheus`, {
                metadata: {
                    name: "allow-prometheus",
                    namespace: this.namespace.metadata.name
                },
                spec: {
                    podSelector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "prometheus"
                        }
                    },
                    policyTypes: ["Ingress", "Egress"],
                    ingress: [
                        {
                            ports: [
                                {
                                    port: 9090,
                                    protocol: "TCP"
                                }
                            ]
                        }
                    ],
                    egress: [
                        {
                            // Allow scraping metrics from all namespaces
                            to: [
                                {
                                    namespaceSelector: {}
                                }
                            ],
                            ports: [
                                {
                                    port: 9090,
                                    protocol: "TCP"
                                },
                                {
                                    port: 9100,
                                    protocol: "TCP"
                                },
                                {
                                    port: 8080,
                                    protocol: "TCP"
                                }
                            ]
                        }
                    ]
                }
            }, { provider, parent: this }),

            // Add custom network policies if specified
            ...(args.networkPolicies?.customPolicies || []).map((policySpec, index) =>
                new k8s.networking.v1.NetworkPolicy(`${prefix}monitoring-custom-${index}`, {
                    metadata: {
                        name: `custom-policy-${index}`,
                        namespace: this.namespace.metadata.name
                    },
                    spec: policySpec
                }, { provider, parent: this })
            )
        ];

        this.registerOutputs({
            namespace: this.namespace,
            resourceQuota: this.resourceQuota,
            limitRange: this.limitRange,
            networkPolicies: this.networkPolicies
        });
    }
}

/** usage example
 import { MonitoringNamespace } from "./monitoringNamespace";`

const monitoring = new MonitoringNamespace("monitoring", {
    quotas: {
        cpu: {
            request: "4",
            limit: "8"
        },
        memory: {
            request: "8Gi",
            limit: "16Gi"
        }
    },
    networkPolicies: {
        ingressNamespaces: ["apps", "data"],
        egressNamespaces: ["kube-system", "data"]
    }
});
**/
