import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export class AutomationNamespace extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;

    constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:automation:AutomationNamespace", name, {}, opts);

        // Create the namespace
        this.namespace = new k8s.core.v1.Namespace("automation", {
            metadata: {
                name: "automation",
                labels: {
                    "name": "automation",
                    "managed-by": "pulumi",
                    "purpose": "workflow-automation"
                },
                annotations: {
                    "description": "Namespace for automation tools like n8n"
                }
            }
        }, { parent: this });

        // Resource Quota
        const resourceQuota = new k8s.core.v1.ResourceQuota("automation-quota", {
            metadata: {
                namespace: this.namespace.metadata.name
            },
            spec: {
                hard: {
                    "requests.cpu": "4",
                    "requests.memory": "8Gi",
                    "limits.cpu": "8",
                    "limits.memory": "16Gi",
                    "pods": "20"
                }
            }
        }, { parent: this });

        // Default Limit Range
        const limitRange = new k8s.core.v1.LimitRange("automation-limits", {
            metadata: {
                namespace: this.namespace.metadata.name
            },
            spec: {
                limits: [{
                    type: "Container",
                    default: {
                        cpu: "500m",
                        memory: "512Mi"
                    },
                    defaultRequest: {
                        cpu: "100m",
                        memory: "256Mi"
                    },
                    max: {
                        cpu: "2",
                        memory: "4Gi"
                    },
                    min: {
                        cpu: "50m",
                        memory: "64Mi"
                    }
                }]
            }
        }, { parent: this });

        // Network Policy
        const networkPolicy = new k8s.networking.v1.NetworkPolicy("automation-network-policy", {
            metadata: {
                namespace: this.namespace.metadata.name
            },
            spec: {
                podSelector: {},
                policyTypes: ["Ingress", "Egress"],
                ingress: [{
                    from: [{
                        namespaceSelector: {
                            matchLabels: {
                                "kubernetes.io/metadata.name": "ingress-nginx"
                            }
                        }
                    }]
                }],
                egress: [{
                    to: [{ ipBlock: { cidr: "0.0.0.0/0" } }]
                }]
            }
        }, { parent: this });

        this.registerOutputs({
            namespaceName: this.namespace.metadata.name
        });
    }
}
