import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface TraefikArgs {
    namespace?: string;
    createNamespace?: boolean;
    dashboard?: {
        enabled?: boolean;
        domain?: string;
        auth?: {
            enabled?: boolean;
            username?: string;
            passwordHash?: string;
        };
    };
    middlewares?: {
        headers?: {
            enabled?: boolean;
            sslRedirect?: boolean;
            stsSeconds?: number;
        };
        rateLimit?: {
            enabled?: boolean;
            average?: number;
            burst?: number;
        };
    };
    tls?: {
        options?: {
            minVersion?: string;
            maxVersion?: string;
            cipherSuites?: string[];
        };
    };
    config?: {
        replicas?: number;
        logging?: {
            level?: string;
        };
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
    };
}

export class Traefik extends pulumi.ComponentResource {
    constructor(name: string, args: TraefikArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:traefik:Traefik", name, args, opts);

        const namespace = args.namespace || "traefik-system";

        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("traefik-namespace", {
                metadata: {
                    name: namespace,
                },
            }, { parent: this, ...opts });
        }

        // Create the operator subscription
        const subscription = new k8s.apiextensions.CustomResource("traefik-operator", {
            apiVersion: "operators.coreos.com/v1alpha1",
            kind: "Subscription",
            metadata: {
                name: "traefik-operator",
                namespace: namespace,
            },
            spec: {
                channel: "alpha",
                name: "traefik-operator",
                source: "operatorhubio-catalog",
                sourceNamespace: "olm",
            },
        }, { parent: this, ...opts });

        // Create the Traefik controller
        const controller = new k8s.apiextensions.CustomResource("traefik-controller", {
            apiVersion: "traefik.io/v1alpha1",
            kind: "TraefikController",
            metadata: {
                name: "traefik-controller",
                namespace: namespace,
            },
            spec: {
                config: args.config || {},
            },
        }, { parent: this, ...opts });

        // Create dashboard IngressRoute if enabled
        if (args.dashboard?.enabled) {
            const auth = args.dashboard.auth;
            let middlewares: { name: string; namespace: string }[] = [];

            if (auth?.enabled) {
                const authMiddleware = new k8s.apiextensions.CustomResource("traefik-auth", {
                    apiVersion: "traefik.io/v1alpha1",
                    kind: "Middleware",
                    metadata: {
                        name: "traefik-auth",
                        namespace: namespace,
                    },
                    spec: {
                        basicAuth: {
                            users: [`${auth.username}:${auth.passwordHash}`],
                        },
                    },
                }, { parent: this, ...opts });

                middlewares.push({
                    name: "traefik-auth",
                    namespace: namespace,
                });
            }

            const dashboardRoute = new k8s.apiextensions.CustomResource("traefik-dashboard", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "IngressRoute",
                metadata: {
                    name: "traefik-dashboard",
                    namespace: namespace,
                },
                spec: {
                    entryPoints: ["websecure"],
                    routes: [
                        {
                            match: `Host(\`${args.dashboard.domain}\`)`,
                            kind: "Rule",
                            services: [
                                {
                                    name: "api@internal",
                                    kind: "TraefikService",
                                },
                            ],
                            middlewares: middlewares,
                        },
                    ],
                },
            }, { parent: this, ...opts });
        }

        // Create middlewares if configured
        if (args.middlewares?.headers?.enabled) {
            const headers = new k8s.apiextensions.CustomResource("secure-headers", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: "secure-headers",
                    namespace: namespace,
                },
                spec: {
                    headers: {
                        sslRedirect: args.middlewares.headers.sslRedirect,
                        stsSeconds: args.middlewares.headers.stsSeconds,
                        stsIncludeSubdomains: true,
                        stsPreload: true,
                        forceSTSHeader: true,
                    },
                },
            }, { parent: this, ...opts });
        }

        if (args.middlewares?.rateLimit?.enabled) {
            const rateLimit = new k8s.apiextensions.CustomResource("rate-limit", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: "rate-limit",
                    namespace: namespace,
                },
                spec: {
                    rateLimit: {
                        average: args.middlewares.rateLimit.average,
                        burst: args.middlewares.rateLimit.burst,
                    },
                },
            }, { parent: this, ...opts });
        }

        // Create TLS options if configured
        if (args.tls?.options) {
            const tlsOptions = new k8s.apiextensions.CustomResource("default-tls", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "TLSOption",
                metadata: {
                    name: "default",
                    namespace: namespace,
                },
                spec: {
                    minVersion: args.tls.options.minVersion,
                    maxVersion: args.tls.options.maxVersion,
                    cipherSuites: args.tls.options.cipherSuites,
                },
            }, { parent: this, ...opts });
        }

        this.registerOutputs({
            namespace: namespace,
        });
    }
}
