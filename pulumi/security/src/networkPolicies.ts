import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface NetworkPolicyOptions {
    namespaces: string[];
    allowMetrics?: boolean;
    allowLogging?: boolean;
    allowDNS?: boolean;
    allowEgress?: boolean;
    monitoringNamespace?: string;
    loggingNamespace?: string;
    ingressNamespace?: string;
}

export class NetworkPolicies extends pulumi.ComponentResource {
    public readonly defaultDenyPolicies: { [key: string]: k8s.networking.v1.NetworkPolicy };
    public readonly tierPolicies: { [key: string]: k8s.networking.v1.NetworkPolicy };
    public readonly monitoringPolicies: { [key: string]: k8s.networking.v1.NetworkPolicy };
    public readonly dnsPolicies: { [key: string]: k8s.networking.v1.NetworkPolicy };
    public readonly loggingPolicies: { [key: string]: k8s.networking.v1.NetworkPolicy };

    constructor(
        name: string,
        options: NetworkPolicyOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:NetworkPolicies", name, {}, opts);

        const {
            namespaces,
            allowMetrics = true,
            allowLogging = true,
            allowDNS = true,
            allowEgress = true,
            monitoringNamespace = "monitoring",
            loggingNamespace = "logging",
            ingressNamespace = "ingress-nginx",
        } = options;

        this.defaultDenyPolicies = {};
        this.tierPolicies = {};
        this.monitoringPolicies = {};
        this.dnsPolicies = {};
        this.loggingPolicies = {};

        // Create default deny policies for each namespace
        namespaces.forEach(namespace => {
            // Default deny all ingress traffic
            this.defaultDenyPolicies[`${namespace}-deny-ingress`] = new k8s.networking.v1.NetworkPolicy(
                `${namespace}-deny-ingress`,
                {
                    metadata: {
                        name: "default-deny-ingress",
                        namespace: namespace,
                    },
                    spec: {
                        podSelector: {},
                        policyTypes: ["Ingress"],
                    },
                },
                { parent: this }
            );

            // Default deny all egress traffic
            this.defaultDenyPolicies[`${namespace}-deny-egress`] = new k8s.networking.v1.NetworkPolicy(
                `${namespace}-deny-egress`,
                {
                    metadata: {
                        name: "default-deny-egress",
                        namespace: namespace,
                    },
                    spec: {
                        podSelector: {},
                        policyTypes: ["Egress"],
                    },
                },
                { parent: this }
            );

            // Allow ingress from ingress-controller
            this.tierPolicies[`${namespace}-ingress-controller`] = new k8s.networking.v1.NetworkPolicy(
                `${namespace}-ingress-controller`,
                {
                    metadata: {
                        name: "allow-ingress-controller",
                        namespace: namespace,
                    },
                    spec: {
                        podSelector: {},
                        policyTypes: ["Ingress"],
                        ingress: [{
                            from: [{
                                namespaceSelector: {
                                    matchLabels: {
                                        "kubernetes.io/metadata.name": ingressNamespace,
                                    },
                                },
                            }],
                        }],
                    },
                },
                { parent: this }
            );

            // Create tier-specific policies
            this.createTierPolicies(namespace);

            // Allow monitoring if enabled
            if (allowMetrics) {
                this.createMonitoringPolicy(namespace, monitoringNamespace);
            }

            // Allow logging if enabled
            if (allowLogging) {
                this.createLoggingPolicy(namespace, loggingNamespace);
            }

            // Allow DNS if enabled
            if (allowDNS) {
                this.createDNSPolicy(namespace);
            }

            // Allow controlled egress if enabled
            if (allowEgress) {
                this.createEgressPolicy(namespace);
            }
        });

        this.registerOutputs({
            defaultDenyPolicyNames: Object.keys(this.defaultDenyPolicies),
            tierPolicyNames: Object.keys(this.tierPolicies),
            monitoringPolicyNames: Object.keys(this.monitoringPolicies),
            dnsPolicyNames: Object.keys(this.dnsPolicies),
            loggingPolicyNames: Object.keys(this.loggingPolicies),
        });
    }

    private createTierPolicies(namespace: string): void {
        // Frontend tier policy
        this.tierPolicies[`${namespace}-frontend`] = new k8s.networking.v1.NetworkPolicy(
            `${namespace}-frontend`,
            {
                metadata: {
                    name: "frontend-policy",
                    namespace: namespace,
                },
                spec: {
                    podSelector: {
                        matchLabels: {
                            tier: "frontend",
                        },
                    },
                    policyTypes: ["Ingress", "Egress"],
                    ingress: [{
                        from: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": namespace,
                                },
                            },
                            podSelector: {
                                matchLabels: {
                                    tier: "backend",
                                },
                            },
                        }],
                    }],
                    egress: [{
                        to: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": namespace,
                                },
                            },
                            podSelector: {
                                matchLabels: {
                                    tier: "backend",
                                },
                            },
                        }],
                    }],
                },
            },
            { parent: this }
        );

        // Backend tier policy
        this.tierPolicies[`${namespace}-backend`] = new k8s.networking.v1.NetworkPolicy(
            `${namespace}-backend`,
            {
                metadata: {
                    name: "backend-policy",
                    namespace: namespace,
                },
                spec: {
                    podSelector: {
                        matchLabels: {
                            tier: "backend",
                        },
                    },
                    policyTypes: ["Ingress", "Egress"],
                    ingress: [{
                        from: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": namespace,
                                },
                            },
                            podSelector: {
                                matchLabels: {
                                    tier: "frontend",
                                },
                            },
                        }],
                    }],
                    egress: [{
                        to: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": namespace,
                                },
                            },
                            podSelector: {
                                matchLabels: {
                                    tier: "database",
                                },
                            },
                        }],
                    }],
                },
            },
            { parent: this }
        );

        // Database tier policy
        this.tierPolicies[`${namespace}-database`] = new k8s.networking.v1.NetworkPolicy(
            `${namespace}-database`,
            {
                metadata: {
                    name: "database-policy",
                    namespace: namespace,
                },
                spec: {
                    podSelector: {
                        matchLabels: {
                            tier: "database",
                        },
                    },
                    policyTypes: ["Ingress"],
                    ingress: [{
                        from: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": namespace,
                                },
                            },
                            podSelector: {
                                matchLabels: {
                                    tier: "backend",
                                },
                            },
                        }],
                    }],
                },
            },
            { parent: this }
        );
    }

    private createMonitoringPolicy(namespace: string, monitoringNamespace: string): void {
        this.monitoringPolicies[namespace] = new k8s.networking.v1.NetworkPolicy(
            `${namespace}-monitoring`,
            {
                metadata: {
                    name: "allow-monitoring",
                    namespace: namespace,
                },
                spec: {
                    podSelector: {},
                    policyTypes: ["Ingress"],
                    ingress: [{
                        from: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": monitoringNamespace,
                                },
                            },
                        }],
                        ports: [{
                            port: 9090,
                            protocol: "TCP",
                        }],
                    }],
                },
            },
            { parent: this }
        );
    }

    private createLoggingPolicy(namespace: string, loggingNamespace: string): void {
        this.loggingPolicies[namespace] = new k8s.networking.v1.NetworkPolicy(
            `${namespace}-logging`,
            {
                metadata: {
                    name: "allow-logging",
                    namespace: namespace,
                },
                spec: {
                    podSelector: {},
                    policyTypes: ["Egress"],
                    egress: [{
                        to: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": loggingNamespace,
                                },
                            },
                        }],
                    }],
                },
            },
            { parent: this }
        );
    }

    private createDNSPolicy(namespace: string): void {
        this.dnsPolicies[namespace] = new k8s.networking.v1.NetworkPolicy(
            `${namespace}-dns`,
            {
                metadata: {
                    name: "allow-dns",
                    namespace: namespace,
                },
                spec: {
                    podSelector: {},
                    policyTypes: ["Egress"],
                    egress: [{
                        to: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": "kube-system",
                                },
                            },
                            podSelector: {
                                matchLabels: {
                                    "k8s-app": "kube-dns",
                                },
                            },
                        }],
                        ports: [{
                            protocol: "UDP",
                            port: 53,
                        }, {
                            protocol: "TCP",
                            port: 53,
                        }],
                    }],
                },
            },
            { parent: this }
        );
    }

    private createEgressPolicy(namespace: string): void {
        this.tierPolicies[`${namespace}-egress`] = new k8s.networking.v1.NetworkPolicy(
            `${namespace}-egress`,
            {
                metadata: {
                    name: "allow-controlled-egress",
                    namespace: namespace,
                },
                spec: {
                    podSelector: {},
                    policyTypes: ["Egress"],
                    egress: [
                        {
                            to: [{
                                ipBlock: {
                                    cidr: "0.0.0.0/0",
                                    except: [
                                        "10.0.0.0/8",
                                        "172.16.0.0/12",
                                        "192.168.0.0/16",
                                    ],
                                },
                            }],
                            ports: [{
                                protocol: "TCP",
                                port: 443,
                            }],
                        },
                    ],
                },
            },
            { parent: this }
        );
    }
}
