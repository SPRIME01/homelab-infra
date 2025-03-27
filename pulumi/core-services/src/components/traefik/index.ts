import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { TraefikArgs, TraefikStatus } from "./types";
import {
    DEFAULT_NAMESPACE,
    DEFAULT_ARGUMENTS,
    DEFAULT_TLS_CIPHER_SUITES,
    OPERATOR_CONFIG
} from "./constants";
import {
    createMiddlewares,
    mergeResourceConfig,
    createAuthMiddleware,
    validateLogging
} from "./helpers";

/**
 * Traefik is a modern reverse proxy and load balancer that integrates with your existing infrastructure.
 * This implementation uses the Kubernetes operator pattern for better lifecycle management and native integration.
 */
export class Traefik extends pulumi.ComponentResource {
    public readonly namespace: string;
    public readonly subscription: k8s.apiextensions.CustomResource;
    public readonly controller: k8s.apiextensions.CustomResource;
    public readonly middlewares: {[key: string]: k8s.apiextensions.CustomResource} = {};

    constructor(name: string, args: TraefikArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:traefik:Traefik", name, args, opts);

        // Initialize core configuration
        const namespace = args.namespace || DEFAULT_NAMESPACE;
        this.namespace = namespace;

        // Create namespace if requested
        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("traefik-namespace", {
                metadata: {
                    name: namespace,
                },
            }, { parent: this, ...opts });
        }

        // Create the operator subscription
        this.subscription = new k8s.apiextensions.CustomResource("traefik-operator", {
            apiVersion: "operators.coreos.com/v1alpha1",
            kind: "Subscription",
            metadata: {
                name: "traefik-operator",
                namespace: namespace,
            },
            spec: {
                channel: OPERATOR_CONFIG.channel,
                name: "traefik-operator",
                source: OPERATOR_CONFIG.source,
                sourceNamespace: OPERATOR_CONFIG.sourceNamespace,
            },
        }, { parent: this, ...opts });

        // Create the Traefik controller with validated configuration
        this.controller = new k8s.apiextensions.CustomResource("traefik-controller", {
            apiVersion: "traefik.io/v1alpha1",
            kind: "TraefikController",
            metadata: {
                name: "traefik-controller",
                namespace: namespace,
            },
            spec: {
                replicas: args.replicas || 1,
                resources: mergeResourceConfig(args.resources),
                logging: validateLogging(args.logging?.level),
                additionalArguments: DEFAULT_ARGUMENTS,
            },
        }, { parent: this, dependsOn: [this.subscription], ...opts });

        // Set up middlewares
        const middlewares = createMiddlewares(namespace, args.middlewares, {
            parent: this,
            ...opts
        });
        Object.assign(this.middlewares, middlewares);

        // Configure dashboard if enabled
        if (args.dashboard?.enabled) {
            const auth = args.dashboard.auth;
            let dashboardMiddlewares: { name: string; namespace: string }[] = [];

            // Set up authentication if configured
            if (auth?.enabled) {
                const authMiddleware = createAuthMiddleware(
                    namespace,
                    auth.username,
                    auth.passwordHash,
                    { parent: this, ...opts }
                );

                if (authMiddleware) {
                    this.middlewares["auth"] = authMiddleware;
                    dashboardMiddlewares.push({
                        name: "traefik-auth",
                        namespace: namespace,
                    });
                }
            }

            // Create dashboard IngressRoute
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
                            middlewares: dashboardMiddlewares,
                        },
                    ],
                },
            }, {
                parent: this,
                dependsOn: [...Object.values(this.middlewares)],
                ...opts
            });
        }

        // Configure TLS options if provided
        if (args.tls?.options) {
            const tlsOptions = new k8s.apiextensions.CustomResource("default-tls", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "TLSOption",
                metadata: {
                    name: "default",
                    namespace: namespace,
                },
                spec: {
                    minVersion: args.tls.options.minVersion || "VersionTLS12",
                    maxVersion: args.tls.options.maxVersion,
                    cipherSuites: args.tls.options.cipherSuites || DEFAULT_TLS_CIPHER_SUITES,
                },
            }, { parent: this, ...opts });
        }

        // Register all outputs
        const outputs: TraefikStatus = {
            namespace: this.namespace,
            subscription: this.subscription,
            controller: this.controller,
            middlewares: this.middlewares,
        };

        this.registerOutputs(outputs);
    }
}
