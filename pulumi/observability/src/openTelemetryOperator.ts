import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface OpenTelemetryOperatorArgs {
    /**
     * Namespace where the operator will be deployed
     */
    namespace: string;

    /**
     * Resource limits for the operator
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
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class OpenTelemetryOperator extends pulumi.ComponentResource {
    /**
     * The namespace where the operator is deployed
     */
    public readonly namespace: pulumi.Output<string>;

    /**
     * The service account used by the operator
     */
    public readonly serviceAccount: k8s.core.v1.ServiceAccount;

    /**
     * CRDs created by the operator
     */
    public readonly crds: k8s.apiextensions.v1.CustomResourceDefinition[];

    constructor(name: string, args: OpenTelemetryOperatorArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:opentelemetry:Operator", name, args, opts);

        const prefix = args.namePrefix || "";

        // Default resource configuration for small homelab deployment
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
        const ns = new k8s.core.v1.Namespace(`${prefix}otel-system`, {
            metadata: {
                name: args.namespace,
                labels: {
                    "homelab-managed": "true",
                    "app.kubernetes.io/managed-by": "pulumi",
                    "opentelemetry.io/enabled": "true"
                }
            }
        }, { provider, parent: this });

        this.namespace = ns.metadata.name;

        // Create service account
        this.serviceAccount = new k8s.core.v1.ServiceAccount(`${prefix}otel-operator`, {
            metadata: {
                name: "opentelemetry-operator",
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "opentelemetry-operator",
                    "app.kubernetes.io/part-of": "opentelemetry"
                }
            }
        }, { provider, parent: this, dependsOn: ns });

        // Create cluster role
        const clusterRole = new k8s.rbac.v1.ClusterRole(`${prefix}otel-operator`, {
            metadata: {
                name: `${prefix}opentelemetry-operator`,
                labels: {
                    "app.kubernetes.io/name": "opentelemetry-operator",
                    "app.kubernetes.io/part-of": "opentelemetry"
                }
            },
            rules: [
                {
                    apiGroups: [""],
                    resources: ["configmaps", "events", "pods", "secrets", "services"],
                    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
                },
                {
                    apiGroups: ["apps"],
                    resources: ["daemonsets", "deployments", "statefulsets"],
                    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
                },
                {
                    apiGroups: ["opentelemetry.io"],
                    resources: ["*"],
                    verbs: ["*"]
                },
                {
                    apiGroups: ["admissionregistration.k8s.io"],
                    resources: ["mutatingwebhookconfigurations", "validatingwebhookconfigurations"],
                    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
                }
            ]
        }, { provider, parent: this });

        // Create cluster role binding
        const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding(`${prefix}otel-operator`, {
            metadata: {
                name: `${prefix}opentelemetry-operator`,
                labels: {
                    "app.kubernetes.io/name": "opentelemetry-operator",
                    "app.kubernetes.io/part-of": "opentelemetry"
                }
            },
            subjects: [{
                kind: "ServiceAccount",
                name: this.serviceAccount.metadata.name,
                namespace: args.namespace
            }],
            roleRef: {
                kind: "ClusterRole",
                name: clusterRole.metadata.name,
                apiGroup: "rbac.authorization.k8s.io"
            }
        }, { provider, parent: this });

        // Create CRDs
        this.crds = [
            // OpenTelemetry Collector CRD
            new k8s.apiextensions.v1.CustomResourceDefinition(`${prefix}otelcols`, {
                metadata: {
                    name: "opentelemetrycollectors.opentelemetry.io",
                    labels: {
                        "app.kubernetes.io/name": "opentelemetry-operator",
                        "app.kubernetes.io/part-of": "opentelemetry"
                    }
                },
                spec: {
                    group: "opentelemetry.io",
                    names: {
                        kind: "OpenTelemetryCollector",
                        plural: "opentelemetrycollectors",
                        singular: "opentelemetrycollector",
                        shortNames: ["otel"]
                    },
                    scope: "Namespaced",
                    versions: [{
                        name: "v1alpha1",
                        served: true,
                        storage: true,
                        schema: {
                            openAPIV3Schema: {
                                type: "object",
                                properties: {
                                    spec: {
                                        type: "object",
                                        properties: {
                                            mode: {
                                                type: "string",
                                                enum: ["daemonset", "deployment", "sidecar"]
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

        // Create webhook service
        const webhookService = new k8s.core.v1.Service(`${prefix}otel-webhook`, {
            metadata: {
                name: "opentelemetry-webhook",
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "opentelemetry-operator",
                    "app.kubernetes.io/part-of": "opentelemetry"
                }
            },
            spec: {
                ports: [{
                    port: 443,
                    targetPort: 8443,
                    name: "webhook"
                }],
                selector: {
                    "app.kubernetes.io/name": "opentelemetry-operator"
                }
            }
        }, { provider, parent: this });

        // Create webhook configuration
        const webhook = new k8s.admissionregistration.v1.MutatingWebhookConfiguration(`${prefix}otel-webhook`, {
            metadata: {
                name: `${prefix}opentelemetry-webhook`,
                labels: {
                    "app.kubernetes.io/name": "opentelemetry-operator",
                    "app.kubernetes.io/part-of": "opentelemetry"
                }
            },
            webhooks: [{
                name: "collector.opentelemetry.io",
                admissionReviewVersions: ["v1beta1"],
                sideEffects: "None",
                clientConfig: {
                    service: {
                        name: webhookService.metadata.name,
                        namespace: args.namespace,
                        path: "/mutate-opentelemetry-io-v1alpha1-opentelemetrycollector"
                    }
                },
                rules: [{
                    apiGroups: ["opentelemetry.io"],
                    apiVersions: ["v1alpha1"],
                    operations: ["CREATE", "UPDATE"],
                    resources: ["opentelemetrycollectors"]
                }],
                failurePolicy: "Fail"
            }]
        }, { provider, parent: this });

        // Create operator deployment
        const deployment = new k8s.apps.v1.Deployment(`${prefix}otel-operator`, {
            metadata: {
                name: "opentelemetry-operator",
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "opentelemetry-operator",
                    "app.kubernetes.io/part-of": "opentelemetry"
                }
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "opentelemetry-operator"
                    }
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "opentelemetry-operator",
                            "app.kubernetes.io/part-of": "opentelemetry"
                        }
                    },
                    spec: {
                        serviceAccountName: this.serviceAccount.metadata.name,
                        containers: [{
                            name: "manager",
                            image: "ghcr.io/open-telemetry/opentelemetry-operator/opentelemetry-operator:v0.74.0",
                            args: [
                                "--enable-leader-election",
                                "--webhook-port=8443"
                            ],
                            ports: [{
                                containerPort: 8443,
                                name: "webhook"
                            }],
                            resources: resources,
                            securityContext: {
                                allowPrivilegeEscalation: false,
                                capabilities: {
                                    drop: ["ALL"]
                                }
                            }
                        }],
                        securityContext: {
                            runAsNonRoot: true,
                            seccompProfile: {
                                type: "RuntimeDefault"
                            }
                        }
                    }
                }
            }
        }, { provider, parent: this });

        this.registerOutputs({
            namespace: this.namespace,
            serviceAccount: this.serviceAccount,
            crds: this.crds
        });
    }
}
