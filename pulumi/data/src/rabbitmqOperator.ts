import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface RabbitMQOperatorArgs {
    /**
     * Namespace to deploy the operator
     */
    namespace: string;

    /**
     * Resource limits for operator pods
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
     * High availability configuration
     */
    highAvailability?: {
        enabled: boolean;
        replicas?: number;
    };

    /**
     * Monitoring configuration
     */
    monitoring?: {
        enabled: boolean;
        serviceMonitor?: boolean;
        grafanaDashboards?: boolean;
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class RabbitMQOperator extends pulumi.ComponentResource {
    /**
     * The namespace where the operator is deployed
     */
    public readonly namespace: pulumi.Output<string>;

    /**
     * The service account used by the operator
     */
    public readonly serviceAccount: k8s.core.v1.ServiceAccount;

    /**
     * The custom resource definitions created by the operator
     */
    public readonly crds: k8s.apiextensions.v1.CustomResourceDefinition[];

    constructor(name: string, args: RabbitMQOperatorArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:rabbitmq:Operator", name, args, opts);

        const prefix = args.namePrefix || "";

        // Default resource configuration
        const defaultResources = {
            requests: {
                cpu: "100m",
                memory: "128Mi"
            },
            limits: {
                cpu: "500m",
                memory: "256Mi"
            }
        };

        const resources = args.resources || defaultResources;

        // Create namespace if it doesn't exist
        const ns = new k8s.core.v1.Namespace(`${prefix}rabbitmq-system`, {
            metadata: {
                name: args.namespace,
                labels: {
                    "homelab-managed": "true",
                    "app.kubernetes.io/managed-by": "pulumi",
                    "app.kubernetes.io/name": "rabbitmq-operator",
                    "app.kubernetes.io/part-of": "rabbitmq"
                }
            }
        }, { provider, parent: this });

        this.namespace = ns.metadata.name;

        // Create service account
        this.serviceAccount = new k8s.core.v1.ServiceAccount(`${prefix}rabbitmq-operator`, {
            metadata: {
                name: "rabbitmq-operator",
                namespace: this.namespace,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq-operator",
                    "app.kubernetes.io/part-of": "rabbitmq"
                }
            }
        }, { provider, parent: this, dependsOn: ns });

        // Create cluster role
        const clusterRole = new k8s.rbac.v1.ClusterRole(`${prefix}rabbitmq-operator`, {
            metadata: {
                name: `${prefix}rabbitmq-operator`,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq-operator",
                    "app.kubernetes.io/part-of": "rabbitmq"
                }
            },
            rules: [
                {
                    apiGroups: [""],
                    resources: ["configmaps", "events", "pods", "secrets", "services", "persistentvolumeclaims"],
                    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
                },
                {
                    apiGroups: ["apps"],
                    resources: ["statefulsets"],
                    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
                },
                {
                    apiGroups: ["rabbitmq.com"],
                    resources: ["*"],
                    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
                },
                {
                    apiGroups: ["monitoring.coreos.com"],
                    resources: ["servicemonitors", "podmonitors"],
                    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
                }
            ]
        }, { provider, parent: this });

        // Create cluster role binding
        const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding(`${prefix}rabbitmq-operator`, {
            metadata: {
                name: `${prefix}rabbitmq-operator`,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq-operator",
                    "app.kubernetes.io/part-of": "rabbitmq"
                }
            },
            subjects: [{
                kind: "ServiceAccount",
                name: this.serviceAccount.metadata.name,
                namespace: this.namespace
            }],
            roleRef: {
                kind: "ClusterRole",
                name: clusterRole.metadata.name,
                apiGroup: "rbac.authorization.k8s.io"
            }
        }, { provider, parent: this });

        // Create CRDs
        this.crds = [
            new k8s.apiextensions.v1.CustomResourceDefinition(`${prefix}rabbitmqclusters`, {
                metadata: {
                    name: "rabbitmqclusters.rabbitmq.com",
                    labels: {
                        "app.kubernetes.io/name": "rabbitmq-operator",
                        "app.kubernetes.io/part-of": "rabbitmq"
                    }
                },
                spec: {
                    group: "rabbitmq.com",
                    names: {
                        kind: "RabbitmqCluster",
                        plural: "rabbitmqclusters",
                        singular: "rabbitmqcluster",
                        shortNames: ["rmq"]
                    },
                    scope: "Namespaced",
                    versions: [{
                        name: "v1beta1",
                        served: true,
                        storage: true,
                        schema: {
                            openAPIV3Schema: {
                                type: "object",
                                properties: {
                                    spec: {
                                        type: "object",
                                        properties: {
                                            replicas: {
                                                type: "integer",
                                                minimum: 1,
                                                default: 1
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }, { provider, parent: this })
        ];

        // Create operator deployment
        const deployment = new k8s.apps.v1.Deployment(`${prefix}rabbitmq-operator`, {
            metadata: {
                name: "rabbitmq-operator",
                namespace: this.namespace,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq-operator",
                    "app.kubernetes.io/part-of": "rabbitmq"
                }
            },
            spec: {
                replicas: args.highAvailability?.enabled ? (args.highAvailability.replicas || 2) : 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "rabbitmq-operator"
                    }
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "rabbitmq-operator",
                            "app.kubernetes.io/part-of": "rabbitmq"
                        }
                    },
                    spec: {
                        serviceAccountName: this.serviceAccount.metadata.name,
                        containers: [{
                            name: "operator",
                            image: "rabbitmqoperator/cluster-operator:2.0.0",
                            resources: resources,
                            env: [
                                {
                                    name: "OPERATOR_NAMESPACE",
                                    valueFrom: {
                                        fieldRef: {
                                            fieldPath: "metadata.namespace"
                                        }
                                    }
                                }
                            ]
                        }]
                    }
                }
            }
        }, { provider, parent: this });

        // Create monitoring resources if enabled
        if (args.monitoring?.enabled) {
            if (args.monitoring.serviceMonitor) {
                new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-servicemonitor`, {
                    apiVersion: "monitoring.coreos.com/v1",
                    kind: "ServiceMonitor",
                    metadata: {
                        name: "rabbitmq-operator",
                        namespace: this.namespace,
                        labels: {
                            "app.kubernetes.io/name": "rabbitmq-operator",
                            "app.kubernetes.io/part-of": "rabbitmq"
                        }
                    },
                    spec: {
                        selector: {
                            matchLabels: {
                                "app.kubernetes.io/name": "rabbitmq-operator"
                            }
                        },
                        endpoints: [{
                            port: "metrics"
                        }]
                    }
                }, { provider, parent: this });
            }

            // Add Grafana dashboard ConfigMap if enabled
            if (args.monitoring.grafanaDashboards) {
                new k8s.core.v1.ConfigMap(`${prefix}rabbitmq-dashboards`, {
                    metadata: {
                        name: "rabbitmq-grafana-dashboards",
                        namespace: this.namespace,
                        labels: {
                            "app.kubernetes.io/name": "rabbitmq-operator",
                            "app.kubernetes.io/part-of": "rabbitmq",
                            "grafana_dashboard": "true"
                        }
                    },
                    data: {
                        "rabbitmq-operator-dashboard.json": JSON.stringify({
                            // Dashboard configuration would go here
                            // This should be replaced with actual RabbitMQ dashboard JSON
                        })
                    }
                }, { provider, parent: this });
            }
        }

        this.registerOutputs({
            namespace: this.namespace,
            serviceAccount: this.serviceAccount,
            crds: this.crds
        });
    }
}
