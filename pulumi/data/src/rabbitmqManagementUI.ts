import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface RabbitMQManagementUIArgs {
    /**
     * Namespace where RabbitMQ is deployed
     */
    namespace: string;

    /**
     * RabbitMQ service name
     */
    serviceName: string;

    /**
     * Domain name for the management UI
     */
    hostname: string;

    /**
     * TLS configuration
     */
    tls?: {
        secretName: string;
        issuer?: string;
    };

    /**
     * Authentication configuration
     */
    auth?: {
        enabled: boolean;
        autheliaNamespace?: string;
        autheliaService?: string;
    };

    /**
     * Network policy configuration
     */
    networkPolicy?: {
        allowedCIDRs?: string[];
        allowedNamespaces?: string[];
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class RabbitMQManagementUI extends pulumi.ComponentResource {
    /**
     * The Ingress resource
     */
    public readonly ingress: k8s.networking.v1.Ingress;

    /**
     * Network policies
     */
    public readonly networkPolicies: k8s.networking.v1.NetworkPolicy[];

    constructor(name: string, args: RabbitMQManagementUIArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:rabbitmq:ManagementUI", name, args, opts);

        const prefix = args.namePrefix || "";

        // Create security headers middleware
        const securityHeaders = new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-mgmt-headers`, {
            apiVersion: "traefik.io/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${prefix}rabbitmq-mgmt-headers`,
                namespace: args.namespace
            },
            spec: {
                headers: {
                    customResponseHeaders: {
                        "X-Frame-Options": "DENY",
                        "X-Content-Type-Options": "nosniff",
                        "X-XSS-Protection": "1; mode=block",
                        "Referrer-Policy": "strict-origin-when-cross-origin",
                        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
                        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
                    }
                }
            }
        }, { provider, parent: this });

        // Create rate limiting middleware
        const rateLimit = new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-mgmt-ratelimit`, {
            apiVersion: "traefik.io/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${prefix}rabbitmq-mgmt-ratelimit`,
                namespace: args.namespace
            },
            spec: {
                rateLimit: {
                    average: 100,
                    burst: 50
                }
            }
        }, { provider, parent: this });

        // Create authentication middleware if enabled
        const authMiddleware = args.auth?.enabled ?
            new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-mgmt-auth`, {
                apiVersion: "traefik.io/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: `${prefix}rabbitmq-mgmt-auth`,
                    namespace: args.namespace
                },
                spec: {
                    forwardAuth: {
                        address: `http://${args.auth.autheliaService || "authelia"}.${args.auth.autheliaNamespace || "auth"}/api/verify?rd=https://auth.${args.hostname}`,
                        trustForwardHeader: true,
                        authResponseHeaders: [
                            "Remote-User",
                            "Remote-Name",
                            "Remote-Email",
                            "Remote-Groups"
                        ]
                    }
                }
            }, { provider, parent: this }) : undefined;

        // Create ingress
        this.ingress = new k8s.networking.v1.Ingress(`${prefix}rabbitmq-mgmt-ingress`, {
            metadata: {
                name: `${prefix}rabbitmq-mgmt`,
                namespace: args.namespace,
                annotations: {
                    "cert-manager.io/cluster-issuer": args.tls?.issuer || "letsencrypt-prod",
                    "traefik.ingress.kubernetes.io/router.middlewares": [
                        `${args.namespace}-${prefix}rabbitmq-mgmt-headers@kubernetescrd`,
                        `${args.namespace}-${prefix}rabbitmq-mgmt-ratelimit@kubernetescrd`,
                        ...(args.auth?.enabled ? [`${args.namespace}-${prefix}rabbitmq-mgmt-auth@kubernetescrd`] : [])
                    ].join(",")
                }
            },
            spec: {
                ingressClassName: "traefik",
                tls: [{
                    hosts: [args.hostname],
                    secretName: args.tls?.secretName || `${prefix}rabbitmq-mgmt-tls`
                }],
                rules: [{
                    host: args.hostname,
                    http: {
                        paths: [{
                            path: "/",
                            pathType: "Prefix",
                            backend: {
                                service: {
                                    name: args.serviceName,
                                    port: {
                                        number: 15672
                                    }
                                }
                            }
                        }]
                    }
                }]
            }
        }, { provider, parent: this });

        // Create network policies
        this.networkPolicies = [
            // Default deny all ingress
            new k8s.networking.v1.NetworkPolicy(`${prefix}rabbitmq-mgmt-default-deny`, {
                metadata: {
                    name: `${prefix}rabbitmq-mgmt-default-deny`,
                    namespace: args.namespace
                },
                spec: {
                    podSelector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "rabbitmq"
                        }
                    },
                    policyTypes: ["Ingress"]
                }
            }, { provider, parent: this }),

            // Allow ingress from specified sources
            new k8s.networking.v1.NetworkPolicy(`${prefix}rabbitmq-mgmt-allow`, {
                metadata: {
                    name: `${prefix}rabbitmq-mgmt-allow`,
                    namespace: args.namespace
                },
                spec: {
                    podSelector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "rabbitmq"
                        }
                    },
                    policyTypes: ["Ingress"],
                    ingress: [{
                        from: [
                            // Allow from specified namespaces
                            ...(args.networkPolicy?.allowedNamespaces || []).map(ns => ({
                                namespaceSelector: {
                                    matchLabels: {
                                        "kubernetes.io/metadata.name": ns
                                    }
                                }
                            })),
                            // Allow from traefik ingress
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        "kubernetes.io/metadata.name": "traefik-system"
                                    }
                                },
                                podSelector: {
                                    matchLabels: {
                                        "app.kubernetes.io/name": "traefik"
                                    }
                                }
                            }
                        ],
                        ports: [{
                            port: 15672,
                            protocol: "TCP"
                        }]
                    }]
                }
            }, { provider, parent: this })
        ];

        // Register outputs
        this.registerOutputs({
            ingress: this.ingress,
            networkPolicies: this.networkPolicies
        });
    }
}
