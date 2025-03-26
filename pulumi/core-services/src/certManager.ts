import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

/**
 * Input properties for the CertManager component
 */
export interface CertManagerArgs {
    /**
     * The namespace to deploy cert-manager into
     * @default "cert-manager"
     */
    namespace?: string;

    /**
     * The version of cert-manager to deploy
     * @default "v1.13.2"
     */
    version?: string;

    /**
     * Email address for Let's Encrypt registration
     */
    acmeEmail: string;

    /**
     * Resource requests and limits for cert-manager components
     * @default - see defaultResourceSettings
     */
    resources?: CertManagerResourceSettings;

    /**
     * Whether to create ClusterIssuers for Let's Encrypt
     * @default true
     */
    createClusterIssuers?: boolean;

    /**
     * Domain name for the DNS01 solver
     * If provided, configures DNS01 challenges for Let's Encrypt
     */
    solverDomain?: string;

    /**
     * Optional prefix for resources created by this component
     */
    namePrefix?: string;
}

/**
 * Resource settings for cert-manager components
 */
export interface CertManagerResourceSettings {
    controller?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };
    webhook?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };
    cainjector?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };
}

/**
 * Default resource settings suitable for a homelab environment
 */
const defaultResourceSettings: CertManagerResourceSettings = {
    controller: {
        requests: {
            cpu: "50m",
            memory: "64Mi",
        },
        limits: {
            cpu: "200m",
            memory: "256Mi",
        },
    },
    webhook: {
        requests: {
            cpu: "50m",
            memory: "64Mi",
        },
        limits: {
            cpu: "100m",
            memory: "128Mi",
        },
    },
    cainjector: {
        requests: {
            cpu: "50m",
            memory: "64Mi",
        },
        limits: {
            cpu: "100m",
            memory: "128Mi",
        },
    },
};

/**
 * CertManager is a component resource that deploys cert-manager on a Kubernetes cluster
 * and configures it with Let's Encrypt issuers for TLS certificate management.
 */
export class CertManager extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly serviceAccount: k8s.core.v1.ServiceAccount;
    public readonly controller: k8s.apps.v1.Deployment;
    public readonly webhook: k8s.apps.v1.Deployment;
    public readonly cainjector: k8s.apps.v1.Deployment;
    public readonly productionIssuer?: k8s.apiextensions.CustomResource;
    public readonly stagingIssuer?: k8s.apiextensions.CustomResource;

    constructor(name: string, args: CertManagerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k8s:CertManager", name, args, opts);

        const prefix = args.namePrefix || "";
        const namespace = args.namespace || "cert-manager";
        const version = args.version || "v1.13.2";
        const resources = args.resources || defaultResourceSettings;
        const createClusterIssuers = args.createClusterIssuers !== false;

        // Create namespace
        this.namespace = new k8s.core.v1.Namespace(`${prefix}${name}-namespace`, {
            metadata: {
                name: namespace,
                labels: {
                    "homelab-managed": "true",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
        }, { parent: this });

        // Create ServiceAccount
        this.serviceAccount = new k8s.core.v1.ServiceAccount(`${prefix}${name}-sa`, {
            metadata: {
                name: "cert-manager",
                namespace: namespace,
            },
        }, { parent: this });

        // Create ClusterRole
        const clusterRole = new k8s.rbac.v1.ClusterRole(`${prefix}${name}-role`, {
            metadata: {
                name: `${namespace}:controller`,
            },
            rules: [
                {
                    apiGroups: ["cert-manager.io"],
                    resources: ["*"],
                    verbs: ["*"],
                },
                {
                    apiGroups: [""],
                    resources: ["configmaps", "secrets", "events", "services", "pods"],
                    verbs: ["*"],
                },
                {
                    apiGroups: ["apps"],
                    resources: ["deployments"],
                    verbs: ["*"],
                },
            ],
        }, { parent: this });

        // Create ClusterRoleBinding
        const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding(`${prefix}${name}-rolebinding`, {
            metadata: {
                name: `${namespace}:controller`,
            },
            roleRef: {
                apiGroup: "rbac.authorization.k8s.io",
                kind: "ClusterRole",
                name: clusterRole.metadata.name,
            },
            subjects: [{
                kind: "ServiceAccount",
                name: this.serviceAccount.metadata.name,
                namespace: namespace,
            }],
        }, { parent: this });

        // Install CRDs
        const crds = ["certificates", "certificaterequests", "challenges", "clusterissuers", "issuers", "orders"].map(crd => {
            return new k8s.apiextensions.v1.CustomResourceDefinition(`${prefix}${name}-${crd}-crd`, {
                metadata: {
                    name: `${crd}.cert-manager.io`,
                },
                spec: {
                    group: "cert-manager.io",
                    names: {
                        kind: crd.charAt(0).toUpperCase() + crd.slice(1),
                        listKind: crd.charAt(0).toUpperCase() + crd.slice(1) + "List",
                        plural: crd,
                        singular: crd,
                    },
                    scope: crd === "clusterissuers" ? "Cluster" : "Namespaced",
                    versions: [{
                        name: "v1",
                        served: true,
                        storage: true,
                        schema: {
                            openAPIV3Schema: {
                                type: "object",
                                properties: {
                                    spec: {
                                        type: "object",
                                        "x-kubernetes-preserve-unknown-fields": true
                                    },
                                    status: {
                                        type: "object",
                                        "x-kubernetes-preserve-unknown-fields": true
                                    }
                                }
                            }
                        },
                        subresources: {
                            status: {}
                        },
                        additionalPrinterColumns: [
                            {
                                jsonPath: ".status.conditions[?(@.type==\"Ready\")].status",
                                name: "Ready",
                                type: "string"
                            },
                            {
                                jsonPath: ".status.conditions[?(@.type==\"Ready\")].message",
                                name: "Status",
                                type: "string",
                                priority: 1
                            },
                            {
                                jsonPath: ".metadata.creationTimestamp",
                                description: "CreationTimestamp is a timestamp representing the server time when this object was created",
                                name: "Age",
                                type: "date"
                            }
                        ]
                    }]
                }
            }, { parent: this });
        });

        // Deploy cert-manager controller
        this.controller = new k8s.apps.v1.Deployment(`${prefix}${name}-controller`, {
            metadata: {
                name: "cert-manager-controller",
                namespace: namespace,
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cert-manager",
                        "app.kubernetes.io/component": "controller",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "cert-manager",
                            "app.kubernetes.io/component": "controller",
                        },
                    },
                    spec: {
                        serviceAccountName: this.serviceAccount.metadata.name,
                        containers: [{
                            name: "cert-manager",
                            image: `quay.io/jetstack/cert-manager-controller:${version}`,
                            args: [
                                "--v=2",
                                "--cluster-resource-namespace=$(POD_NAMESPACE)",
                                "--leader-election-namespace=$(POD_NAMESPACE)",
                                "--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53",
                                "--dns01-recursive-nameservers-only",
                            ],
                            resources: resources.controller,
                            env: [{
                                name: "POD_NAMESPACE",
                                valueFrom: {
                                    fieldRef: {
                                        fieldPath: "metadata.namespace",
                                    },
                                },
                            }],
                        }],
                    },
                },
            },
        }, { parent: this });

        // Deploy webhook
        this.webhook = new k8s.apps.v1.Deployment(`${prefix}${name}-webhook`, {
            metadata: {
                name: "cert-manager-webhook",
                namespace: namespace,
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cert-manager",
                        "app.kubernetes.io/component": "webhook",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "cert-manager",
                            "app.kubernetes.io/component": "webhook",
                        },
                    },
                    spec: {
                        serviceAccountName: this.serviceAccount.metadata.name,
                        containers: [{
                            name: "cert-manager-webhook",
                            image: `quay.io/jetstack/cert-manager-webhook:${version}`,
                            args: [
                                "--v=2",
                                "--secure-port=10250",
                            ],
                            resources: resources.webhook,
                        }],
                    },
                },
            },
        }, { parent: this });

        // Create webhook service
        const webhookService = new k8s.core.v1.Service(`${prefix}${name}-webhook-service`, {
            metadata: {
                name: "cert-manager-webhook",
                namespace: namespace,
            },
            spec: {
                ports: [{
                    name: "https",
                    port: 443,
                    targetPort: 10250,
                }],
                selector: {
                    "app.kubernetes.io/name": "cert-manager",
                    "app.kubernetes.io/component": "webhook",
                },
            },
        }, { parent: this });

        // Deploy cainjector
        this.cainjector = new k8s.apps.v1.Deployment(`${prefix}${name}-cainjector`, {
            metadata: {
                name: "cert-manager-cainjector",
                namespace: namespace,
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cert-manager",
                        "app.kubernetes.io/component": "cainjector",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "cert-manager",
                            "app.kubernetes.io/component": "cainjector",
                        },
                    },
                    spec: {
                        serviceAccountName: this.serviceAccount.metadata.name,
                        containers: [{
                            name: "cert-manager-cainjector",
                            image: `quay.io/jetstack/cert-manager-cainjector:${version}`,
                            args: [
                                "--v=2",
                            ],
                            resources: resources.cainjector,
                        }],
                    },
                },
            },
        }, { parent: this });

        // Create metrics service
        const metricsService = new k8s.core.v1.Service(`${prefix}${name}-metrics-service`, {
            metadata: {
                name: "cert-manager-metrics",
                namespace: namespace,
            },
            spec: {
                ports: [{
                    name: "metrics",
                    port: 9402,
                    protocol: "TCP",
                    targetPort: 9402,
                }],
                selector: {
                    "app.kubernetes.io/name": "cert-manager",
                    "app.kubernetes.io/component": "controller",
                },
            },
        }, { parent: this });

        // Only create ClusterIssuers if requested
        if (createClusterIssuers) {
            // Create Let's Encrypt Staging ClusterIssuer
            this.stagingIssuer = new k8s.apiextensions.CustomResource(`${prefix}${name}-staging-issuer`, {
                apiVersion: "cert-manager.io/v1",
                kind: "ClusterIssuer",
                metadata: {
                    name: "letsencrypt-staging",
                },
                spec: {
                    acme: {
                        server: "https://acme-staging-v02.api.letsencrypt.org/directory",
                        email: args.acmeEmail,
                        privateKeySecretRef: {
                            name: "letsencrypt-staging-account-key",
                        },
                        solvers: getSolvers(args),
                    },
                },
            }, { parent: this, dependsOn: this.controller });

            // Create Let's Encrypt Production ClusterIssuer
            this.productionIssuer = new k8s.apiextensions.CustomResource(`${prefix}${name}-production-issuer`, {
                apiVersion: "cert-manager.io/v1",
                kind: "ClusterIssuer",
                metadata: {
                    name: "letsencrypt-production",
                },
                spec: {
                    acme: {
                        server: "https://acme-v02.api.letsencrypt.org/directory",
                        email: args.acmeEmail,
                        privateKeySecretRef: {
                            name: "letsencrypt-production-account-key",
                        },
                        solvers: getSolvers(args),
                    },
                },
            }, { parent: this, dependsOn: this.controller });
        }

        this.registerOutputs({
            namespace: this.namespace,
            controller: this.controller,
            webhook: this.webhook,
            cainjector: this.cainjector,
            productionIssuer: this.productionIssuer,
            stagingIssuer: this.stagingIssuer,
        });
    }
}

/**
 * Helper function to get the appropriate ACME solvers based on configuration
 */
function getSolvers(args: CertManagerArgs): any[] {
    const solvers: any[] = [];

    // If a domain is specified for DNS01 challenges, configure it
    if (args.solverDomain) {
        solvers.push({
            selector: {
                dnsZones: [args.solverDomain],
            },
            dns01: {
                // This example uses CloudFlare - replace with your DNS provider
                cloudflare: {
                    email: args.acmeEmail,
                    apiTokenSecretRef: {
                        name: "cloudflare-api-token",
                        key: "api-token",
                    },
                },
            },
        });
    }

    // Always include an HTTP01 solver for general use
    solvers.push({
        http01: {
            ingress: {
                class: "traefik",
            },
        },
    });

    return solvers;
}
