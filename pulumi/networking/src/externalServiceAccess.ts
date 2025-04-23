import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Configuration for a backend service path within an Ingress rule.
 */
interface IngressPathConfig {
    /** The path pattern (e.g., "/", "/api"). */
    path: pulumi.Input<string>;
    /** The type of path matching (e.g., "Prefix", "Exact"). */
    pathType: pulumi.Input<string>;
    /** The name of the Kubernetes Service to route traffic to. */
    serviceName: pulumi.Input<string>;
    /** The port number of the Kubernetes Service. */
    servicePort: pulumi.Input<number>;
}

/**
 * Configuration for a single externally accessible service via Ingress.
 */
interface IngressServiceConfig {
    /** A unique name for the Ingress resource. */
    resourceName: string;
    /** The hostname for the service (e.g., "grafana.example.com"). Must match DNS configured in Cloudflare. */
    hostname: pulumi.Input<string>;
    /** The name of the Kubernetes Secret containing the TLS certificate and key. */
    tlsSecretName: pulumi.Input<string>;
    /** An array of path configurations for this host. */
    paths: IngressPathConfig[];
    /** Optional: Annotations for the Ingress resource. */
    annotations?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
    /** Optional: Authentication configuration (e.g., annotations for oauth2-proxy). */
    auth?: {
        /** Example: Annotations needed for oauth2-proxy or similar */
        annotations: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
    };
}

/**
 * Arguments for the ExternalServiceAccess component.
 */
interface ExternalServiceAccessArgs {
    /** The Kubernetes provider instance. */
    provider: k8s.Provider;
    /** The Kubernetes namespace where the Ingress resources will be created. */
    namespace: pulumi.Input<string>;
    /** The name of the IngressClass resource to use (e.g., "nginx", "traefik"). */
    ingressClassName: pulumi.Input<string>;
    /** An array of service configurations to expose via Ingress. */
    services: IngressServiceConfig[];
    /** Optional: Default annotations to apply to all Ingress resources. */
    defaultAnnotations?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * Pulumi component for configuring Kubernetes Ingress resources for external service access.
 *
 * This component sets up Ingress resources, assuming an Ingress Controller (like Nginx or Traefik)
 * and potentially cert-manager (for TLS secrets) are already deployed in the cluster.
 *
 * Cloudflare Tunnel Integration: This component primarily focuses on the Kubernetes side.
 * External DNS (CNAME records pointing to the Cloudflare Tunnel) should be managed separately
 * (e.g., using the CloudflareTunnels or ExternalDns components). The hostnames defined here
 * must match the hostnames configured in the Cloudflare Tunnel ingress rules or DNS.
 *
 * Annotations are used for features like:
 * - TLS configuration (though spec.tls is preferred)
 * - Rate limiting (e.g., nginx.ingress.kubernetes.io/limit-rps)
 * - Security headers (e.g., nginx.ingress.kubernetes.io/configuration-snippet)
 * - Authentication (e.g., nginx.ingress.kubernetes.io/auth-url)
 */
export class ExternalServiceAccess extends pulumi.ComponentResource {
    public readonly ingresses: pulumi.Output<k8s.networking.v1.Ingress[]>;

    constructor(name: string, args: ExternalServiceAccessArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:ExternalServiceAccess", name, args, opts);

        const { provider, namespace, ingressClassName, services, defaultAnnotations = {} } = args;

        const createdIngresses: pulumi.Output<k8s.networking.v1.Ingress>[] = [];

        services.forEach(serviceConfig => {
            // Combine default, service-specific, and auth annotations
            const combinedAnnotations = pulumi.all([defaultAnnotations, serviceConfig.annotations || {}, serviceConfig.auth?.annotations || {}])
                .apply(([def, svc, auth]) => ({ ...def, ...svc, ...auth }));

            const ingress = new k8s.networking.v1.Ingress(serviceConfig.resourceName, {
                metadata: {
                    name: serviceConfig.resourceName,
                    namespace: namespace,
                    annotations: combinedAnnotations,
                },
                spec: {
                    ingressClassName: ingressClassName,
                    tls: [{
                        hosts: [serviceConfig.hostname],
                        secretName: serviceConfig.tlsSecretName,
                    }],
                    rules: [{
                        host: serviceConfig.hostname,
                        http: {
                            paths: serviceConfig.paths.map(pathConfig => ({
                                path: pathConfig.path,
                                pathType: pathConfig.pathType,
                                backend: {
                                    service: {
                                        name: pathConfig.serviceName,
                                        port: {
                                            number: pathConfig.servicePort,
                                        },
                                    },
                                },
                            })),
                        },
                    }],
                },
            }, { parent: this, provider: provider });

            createdIngresses.push(pulumi.output(ingress));
        });

        this.ingresses = pulumi.all(createdIngresses);

        this.registerOutputs({
            ingresses: this.ingresses,
        });
    }
}

// Example Usage (within your main Pulumi program):
/*
const k8sProvider = new k8s.Provider("k8s-provider", { ... });

// Assuming cert-manager created this secret for grafana.example.com
const grafanaTlsSecretName = "grafana-tls";

const externalAccess = new ExternalServiceAccess("homelab-external-access", {
    provider: k8sProvider,
    namespace: "default", // Or the namespace where your services reside
    ingressClassName: "nginx", // Your ingress controller's class name
    defaultAnnotations: {
        // Example: Force HTTPS redirect (often handled by Ingress controller config too)
        "nginx.ingress.kubernetes.io/force-ssl-redirect": "true",
        // Example: Basic security headers (consider more specific ones)
        "nginx.ingress.kubernetes.io/configuration-snippet": `
            add_header X-Frame-Options "SAMEORIGIN";
            add_header X-Content-Type-Options "nosniff";
            add_header Referrer-Policy "strict-origin-when-cross-origin";
        `,
    },
    services: [
        {
            resourceName: "grafana-ingress",
            hostname: "grafana.example.com", // Must match DNS CNAME pointing to Cloudflare Tunnel
            tlsSecretName: grafanaTlsSecretName,
            paths: [{
                path: "/",
                pathType: "Prefix",
                serviceName: "grafana-service", // The name of your Grafana Kubernetes service
                servicePort: 3000, // The port Grafana service listens on
            }],
            annotations: {
                // Example: Rate limit Grafana login page
                "nginx.ingress.kubernetes.io/limit-rps": "5", // Adjust rate as needed
            },
            // Example: Add authentication via oauth2-proxy
            // auth: {
            //     annotations: {
            //         "nginx.ingress.kubernetes.io/auth-url": "http://oauth2-proxy.security.svc.cluster.local/oauth2/auth",
            //         "nginx.ingress.kubernetes.io/auth-signin": "https://auth.example.com/oauth2/start?rd=$escaped_request_uri"
            //     }
            // }
        },
        // Add more service configurations here...
        {
            resourceName: "api-service-ingress",
            hostname: "api.example.com",
            tlsSecretName: "api-tls", // Assuming a secret named 'api-tls' exists
            paths: [
                {
                    path: "/users",
                    pathType: "Prefix",
                    serviceName: "user-api-service",
                    servicePort: 8080,
                },
                {
                    path: "/products",
                    pathType: "Prefix",
                    serviceName: "product-api-service",
                    servicePort: 8081,
                }
            ],
            annotations: {
                 "nginx.ingress.kubernetes.io/limit-rps": "100", // Higher limit for APIs
            }
        }
    ],
});
*/
