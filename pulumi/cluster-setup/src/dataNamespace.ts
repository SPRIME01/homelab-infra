import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "./k8sProvider";

export interface DataNamespaceArgs {
    /**
     * Resource quota settings
     */
    quotas?: {
        cpu: {
            request: string;
            limit: string;
        };
        memory: {
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
        allowNamespaces?: string[];
        allowIngress?: {
            namespaces?: string[];
            podLabels?: { [key: string]: string };
        };
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class DataNamespace extends pulumi.ComponentResource {
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

    constructor(name: string, args: DataNamespaceArgs = {}, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k8s:DataNamespace", name, args, opts);

        const prefix = args.namePrefix || "";
        const quotas = args.quotas || {
            cpu: { request: "8", limit: "16" },
            memory: { request: "16Gi", limit: "32Gi" },
            storage: { capacity: "500Gi" },
            pods: 50
        };

        // Create the namespace
        this.namespace = new k8s.core.v1.Namespace(
            `${prefix}data-namespace`,
            {
                metadata: {
                    name: "data",
                    labels: {
                        "homelab-managed": "true",
                        "app.kubernetes.io/managed-by": "pulumi",
                        "kubernetes.io/metadata.name": "data",
                        "environment": "production",
                        "type": "data-services"
                    },
                    annotations: {
                        "monitoring.grafana.com/enabled": "true",
                        "backup.velero.io/include": "true",
                        "openshift.io/description": "Namespace for data services and storage",
                        "openshift.io/display-name": "Data Services"
                    }
                }
            },
            { provider, parent: this }
        );

        // Create resource quota
        this.resourceQuota = new k8s.core.v1.ResourceQuota(
            `${prefix}data-quota`,
            {
                metadata: {
                    name: "data-quota",
                    namespace: this.namespace.metadata.name
                },
                spec: {
                    hard: {
                        "requests.cpu": quotas.cpu.request,
                        "limits.cpu": quotas.cpu.limit,
                        "requests.memory": quotas.memory.request,
                        "limits.memory": quotas.memory.limit,
                        "requests.storage": quotas.storage?.capacity,
                        "pods": quotas.pods,
                        "services": "25",
                        "configmaps": "50",
                        "secrets": "50",
                        "persistentvolumeclaims": "25"
                    }
                }
            },
            { provider, parent: this, dependsOn: this.namespace }
        );

        // Create limit range
        this.limitRange = new k8s.core.v1.LimitRange(
            `${prefix}data-limits`,
            {
                metadata: {
                    name: "data-limits",
                    namespace: this.namespace.metadata.name
                },
                spec: {
                    limits: [
                        {
                            type: "Container",
                            default: {
                                cpu: "500m",
                                memory: "512Mi"
                            },
                            defaultRequest: {
                                cpu: "100m",
                                memory: "128Mi"
                            },
                            max: {
                                cpu: "4",
                                memory: "8Gi"
                            },
                            min: {
                                cpu: "50m",
                                memory: "64Mi"
                            }
                        },
                        {
                            type: "PersistentVolumeClaim",
                            max: {
                                storage: "100Gi"
                            },
                            min: {
                                storage: "1Gi"
                            }
                        }
                    ]
                }
            },
            { provider, parent: this, dependsOn: this.namespace }
        );

        // Create network policies
        this.networkPolicies = [
            // Default deny all ingress
            new k8s.networking.v1.NetworkPolicy(
                `${prefix}data-default-deny`,
                {
                    metadata: {
                        name: "default-deny",
                        namespace: this.namespace.metadata.name
                    },
                    spec: {
                        podSelector: {},
                        policyTypes: ["Ingress"]
                    }
                },
                { provider, parent: this, dependsOn: this.namespace }
            ),

            // Allow ingress from specified namespaces
            new k8s.networking.v1.NetworkPolicy(
                `${prefix}data-allow-ingress`,
                {
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
                                    {
                                        namespaceSelector: {
                                            matchLabels: {
                                                "kubernetes.io/metadata.name": "monitoring"
                                            }
                                        }
                                    },
                                    {
                                        namespaceSelector: {
                                            matchLabels: {
                                                "kubernetes.io/metadata.name": "ai"
                                            }
                                        }
                                    },
                                    {
                                        namespaceSelector: {
                                            matchLabels: {
                                                "kubernetes.io/metadata.name": "apps"
                                            }
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                },
                { provider, parent: this, dependsOn: this.namespace }
            ),

            // Allow DNS resolution
            new k8s.networking.v1.NetworkPolicy(
                `${prefix}data-allow-dns`,
                {
                    metadata: {
                        name: "allow-dns",
                        namespace: this.namespace.metadata.name
                    },
                    spec: {
                        podSelector: {},
                        policyTypes: ["Egress"],
                        egress: [
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
                            }
                        ]
                    }
                },
                { provider, parent: this, dependsOn: this.namespace }
            )
        ];

        // Register outputs
        this.registerOutputs({
            namespace: this.namespace,
            resourceQuota: this.resourceQuota,
            limitRange: this.limitRange,
            networkPolicies: this.networkPolicies
        });
    }
}

// Usage example
// const dataNamespace = new DataNamespace("data-namespace", {
//     quotas: {
//         cpu: { request: "4", limit: "8" },
//         memory: { request: "8Gi", limit: "16Gi" },
//         storage: { capacity: "200Gi" },
//         pods: 30
//     },
//     networkPolicies: {
//         allowNamespaces: ["monitoring", "apps"],
//         allowIngress: {
//             namespaces: ["monitoring"],
//             podLabels: { "app": "my-app" }
//         }
//     },
//     namePrefix: "my-cluster-"
// }, { parent: clusterSetup });
        //     networkPolicies: {
        //         allowNamespaces: ["monitoring", "apps"],
        //         allowIngress: {
        //             namespaces: ["monitoring"],
        //             podLabels: { "app": "my-app" }
        //         }
        //     },
        //     namePrefix: "my-cluster-"
        // }, { parent: clusterSetup });
        //     networkPolicies: {
        //         allowNamespaces: ["monitoring", "apps"],
        //         allowIngress: {
        //             namespaces: ["monitoring"],
        //             podLabels: { "app": "my-app" }
        //         }
        //     },
