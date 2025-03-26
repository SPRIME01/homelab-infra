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
    /**
     * The namespace where cert-manager is deployed
     */
    public readonly namespace: k8s.core.v1.Namespace;

    /**
     * The cert-manager release
     */
    public readonly release: k8s.helm.v3.Release;

    /**
     * The Let's Encrypt production ClusterIssuer
     */
    public readonly productionIssuer?: k8s.apiextensions.CustomResource;

    /**
     * The Let's Encrypt staging ClusterIssuer
     */
    public readonly stagingIssuer?: k8s.apiextensions.CustomResource;

    constructor(name: string, args: CertManagerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k8s:CertManager", name, args, opts);

        const prefix = args.namePrefix || "";
        const namespace = args.namespace || "cert-manager";
        const version = args.version || "v1.13.2";
        const resources = args.resources || defaultResourceSettings;
        const createClusterIssuers = args.createClusterIssuers !== false;

        // Create namespace for cert-manager
        this.namespace = new k8s.core.v1.Namespace(`${prefix}${name}-namespace`, {
            metadata: {
                name: namespace,
                labels: {
                    "homelab-managed": "true",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
        }, { parent: this });

        // Create random ID for the helm release
        const releaseId = new random.RandomId(`${prefix}${name}-release-id`, {
            byteLength: 8,
        }, { parent: this });

        // Deploy cert-manager using Helm
        this.release = new k8s.helm.v3.Release(`${prefix}${name}`, {
            name: `cert-manager-${releaseId.hex}`,
            namespace: this.namespace.metadata.name,
            repositoryOpts: {
                repo: "https://charts.jetstack.io",
            },
            chart: "cert-manager",
            version: version,
            values: {
                installCRDs: true,
                replicaCount: 1,
                global: {
                    leaderElection: {
                        namespace: namespace,
                    },
                },
                resources: resources.controller,
                webhook: {
                    resources: resources.webhook,
                },
                cainjector: {
                    resources: resources.cainjector,
                },
                prometheus: {
                    enabled: true,
                    servicemonitor: {
                        enabled: false, // Set to true if you have Prometheus Operator installed
                    },
                },
                extraArgs: [
                    "--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53",
                    "--dns01-recursive-nameservers-only",
                ],
            },
        }, { parent: this, dependsOn: this.namespace });

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
            }, { parent: this, dependsOn: this.release });

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
            }, { parent: this, dependsOn: this.release });
        }

        this.registerOutputs({
            namespace: this.namespace,
            release: this.release,
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
