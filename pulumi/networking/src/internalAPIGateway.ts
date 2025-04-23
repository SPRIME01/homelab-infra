import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Configuration for an API route backend.
 */
interface ApiRouteBackend {
    /** Name of the Kubernetes service. */
    serviceName: pulumi.Input<string>;
    /** Port of the Kubernetes service. */
    servicePort: pulumi.Input<number>;
    /** Optional weight for load balancing. */
    weight?: pulumi.Input<number>;
    /** Optional scheme (http or https) if backend uses TLS. */
    scheme?: pulumi.Input<string>;
}

/**
 * Configuration for a specific API route.
 */
interface ApiRouteConfig {
    /** Unique name for the route configuration (used for resource naming). */
    routeName: string;
    /** Match rule (e.g., "Host(`my-api.internal`) && PathPrefix(`/v1`)"). See Traefik docs for syntax. */
    matchRule: pulumi.Input<string>;
    /** Backend service(s) for this route. */
    backends: ApiRouteBackend[];
    /** Optional: List of middleware names (strings) to apply to this route. */
    middleware?: pulumi.Input<string>[];
    /** Optional: Priority for the route. */
    priority?: pulumi.Input<number>;
    /** Optional: Entry points for this route (default: ["web"]). */
    entryPoints?: pulumi.Input<string>[];
}

/**
 * Configuration for Traefik Middleware.
 */
interface MiddlewareConfig {
    /** Unique name for the middleware resource. */
    name: string;
    /** Middleware configuration (e.g., rateLimit, circuitBreaker, headers, forwardAuth). */
    spec: any; // Use specific Traefik Middleware types for better validation if desired
}

/**
 * Arguments for the InternalApiGateway component.
 */
interface InternalApiGatewayArgs {
    /** Kubernetes provider instance. */
    provider: k8s.Provider;
    /** Namespace to deploy the API Gateway into. */
    namespace: pulumi.Input<string>;
    /** List of API routes to configure. */
    routes: ApiRouteConfig[];
    /** Optional: List of Traefik Middleware configurations. */
    middleware?: MiddlewareConfig[];
    /** Optional: Enable Prometheus metrics. Defaults to true. */
    enableMetrics?: pulumi.Input<boolean>;
    /** Optional: Enable Traefik access logs. Defaults to false. */
    enableAccessLogs?: pulumi.Input<boolean>;
    /** Optional: Number of replicas for HA. Defaults to 1 for lightweight setup. */
    replicas?: pulumi.Input<number>;
    /** Optional: Resource requests and limits for Traefik pods. */
    resources?: pulumi.Input<k8s.types.input.core.v1.ResourceRequirements>;
    /** Optional: Additional Helm chart values for Traefik. */
    helmChartValues?: pulumi.Input<any>;
}

/**
 * Pulumi component for deploying Traefik as an internal API Gateway.
 *
 * This component deploys Traefik using its Helm chart and configures it
 * via IngressRoute and Middleware Custom Resources (CRDs).
 *
 * AI Protocol Considerations (MCP, A2A):
 * - Routing: Define specific `ApiRouteConfig` entries with appropriate `matchRule`
 *   (e.g., PathPrefix based on protocol endpoints like `/mcp/v1` or `/a2a/`)
 *   pointing to the backend services implementing these protocols.
 * - gRPC: Ensure Traefik is configured to handle gRPC if needed (often requires specific entrypoint config or annotations).
 * - Transformation/Auth: Use `MiddlewareConfig` to define header manipulations,
 *   authentication (e.g., ForwardAuth to an OAuth2 proxy), or rate limits
 *   as required by the protocols or services.
 * - Custom Logic: Complex protocol-specific interactions might require custom
 *   backend logic or potentially Traefik plugins (not covered by this basic component).
 *
 * Monitoring: Includes options for Prometheus metrics.
 */
export class InternalApiGateway extends pulumi.ComponentResource {
    public readonly gatewayServiceName: pulumi.Output<string>;
    public readonly gatewayServiceClusterIp: pulumi.Output<string>;
    public readonly traefikHelmRelease: k8s.helm.v3.Release;
    public readonly ingressRoutes: pulumi.Output<k8s.apiextensions.CustomResource[]>;
    public readonly middlewares: pulumi.Output<k8s.apiextensions.CustomResource[]>;

    constructor(name: string, args: InternalApiGatewayArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:InternalApiGateway", name, args, opts);

        const {
            provider,
            namespace,
            routes,
            middleware = [],
            enableMetrics = true,
            enableAccessLogs = false,
            replicas = 1,
            resources,
            helmChartValues = {},
        } = args;

        const appName = `${name}-traefik`;
        const labels = { app: appName };

        // 1. Deploy Traefik using Helm Chart
        // Ensure CRDs are installed beforehand or enable `crds.install=true` (less recommended for GitOps)
        const traefikChart = new k8s.helm.v3.Release(appName, {
            name: appName,
            chart: "traefik",
            repositoryOpts: {
                repo: "https://helm.traefik.io/traefik",
            },
            namespace: namespace,
            values: pulumi.all([helmChartValues, resources]).apply(([values, res]) => ({
                // Basic configuration for internal gateway
                deployment: {
                    replicas: replicas,
                    kind: "Deployment", // Use Deployment instead of DaemonSet for internal gateway
                },
                service: {
                    type: "ClusterIP", // Expose internally only
                },
                // Disable default IngressRoute for the dashboard for security
                ingressRoute: {
                    dashboard: { enabled: false },
                },
                // Enable CRD provider
                providers: {
                    kubernetesCRD: { enabled: true, namespace: namespace },
                    // Disable Ingress provider if only using CRDs
                    kubernetesIngress: { enabled: false },
                },
                // Define internal entry point
                ports: {
                    web: {
                        port: 8000, // Internal port Traefik listens on
                        expose: true,
                        exposedPort: 80, // Port the ClusterIP service will expose
                        protocol: "TCP",
                    },
                    // Add websecure entrypoint if internal TLS is needed
                    // websecure: { ... }
                    // Add gRPC entrypoint if needed
                    // grpc: { port: 9000, expose: true, exposedPort: 90, protocol: "TCP", tls: { enabled: false } }
                },
                // Monitoring & Logging
                metrics: {
                    prometheus: {
                        enabled: enableMetrics,
                        // entryPoint: "metrics", // Ensure a metrics entrypoint exists if needed
                        // addRoutersLabels: true,
                    },
                },
                logs: {
                    access: { enabled: enableAccessLogs },
                    general: { level: "ERROR" }, // Adjust log level as needed
                },
                // Resources
                resources: res,
                // Merge additional user-provided values
                ...values,
            })),
        }, { parent: this, provider: provider });

        this.traefikHelmRelease = traefikChart;
        this.gatewayServiceName = pulumi.interpolate`${appName}`; // Helm release name often matches service name
        // Fetch ClusterIP dynamically
        this.gatewayServiceClusterIp = traefikChart.status.apply(status =>
            k8s.core.v1.Service.get(`${appName}-svc-lookup`, pulumi.interpolate`${namespace}/${appName}`, { provider: provider }).spec.clusterIP
        );


        // 2. Create Middleware Resources
        const createdMiddlewares = middleware.map(mw =>
            new k8s.apiextensions.CustomResource(`${appName}-mw-${mw.name}`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: mw.name,
                    namespace: namespace,
                },
                spec: mw.spec,
            }, { parent: this, provider: provider, dependsOn: [traefikChart] }) // Depend on Helm release
        );
        this.middlewares = pulumi.output(createdMiddlewares);

        // 3. Create IngressRoute Resources
        const createdIngressRoutes = routes.map(route =>
            new k8s.apiextensions.CustomResource(`${appName}-ir-${route.routeName}`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "IngressRoute",
                metadata: {
                    name: `${appName}-ir-${route.routeName}`,
                    namespace: namespace,
                    labels: labels,
                },
                spec: {
                    entryPoints: route.entryPoints ?? ["web"], // Default to internal 'web' entrypoint
                    routes: [{
                        match: route.matchRule,
                        kind: "Rule",
                        priority: route.priority,
                        services: route.backends.map(backend => ({
                            name: backend.serviceName,
                            port: backend.servicePort,
                            weight: backend.weight,
                            scheme: backend.scheme,
                        })),
                        middlewares: (route.middleware ?? []).map(mwName => ({
                            name: mwName, // Reference Middleware by name
                            namespace: namespace, // Ensure namespace is specified if middleware is namespaced
                        })),
                    }],
                    // tls: {} // Add TLS config if using websecure entrypoint
                },
            }, { parent: this, provider: provider, dependsOn: [traefikChart, ...createdMiddlewares] }) // Depend on Helm and Middlewares
        );
        this.ingressRoutes = pulumi.output(createdIngressRoutes);

        // 4. Monitoring Integration (ServiceMonitor for Prometheus Operator)
        if (enableMetrics) {
            // Example ServiceMonitor (requires Prometheus Operator CRDs)
            const serviceMonitor = new k8s.apiextensions.CustomResource(`${appName}-servicemonitor`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: appName,
                    namespace: namespace, // Deploy SM in the same namespace as Traefik
                    labels: { ...labels, release: "prometheus" }, // Adjust labels for your Prometheus Operator selector
                },
                spec: {
                    selector: {
                        matchLabels: labels, // Select the Traefik service
                    },
                    namespaceSelector: {
                        matchNames: [namespace],
                    },
                    endpoints: [{
                        // Traefik's default metrics port is 9100 if using the 'metrics' entrypoint,
                        // or exposed via the main service if configured differently in Helm values.
                        // Adjust port name/number based on Helm chart values.
                        port: "metrics", // Assumes a port named 'metrics' exists on the service (check Helm values)
                        path: "/metrics",
                        interval: "30s",
                    }],
                },
            }, { parent: this, provider: provider, dependsOn: [traefikChart] });
             pulumi.log.info("ServiceMonitor created for Traefik metrics.", this);
        }


        this.registerOutputs({
            gatewayServiceName: this.gatewayServiceName,
            gatewayServiceClusterIp: this.gatewayServiceClusterIp,
            traefikHelmRelease: this.traefikHelmRelease,
            ingressRoutes: this.ingressRoutes,
            middlewares: this.middlewares,
        });
    }
}

// Example Usage (within your main Pulumi program):
/*
const k8sProvider = new k8s.Provider("k8s-provider", { ... });

// Define Middleware
const rateLimitMiddleware: MiddlewareConfig = {
    name: "global-rate-limit",
    spec: {
        rateLimit: {
            average: 100, // requests per second
            burst: 200,
        }
    }
};

const stripApiPrefixMiddleware: MiddlewareConfig = {
    name: "strip-api-prefix",
    spec: {
        stripPrefix: {
            prefixes: ["/api/triton", "/api/custom"],
        }
    }
};

// Define Routes
const tritonRoute: ApiRouteConfig = {
    routeName: "triton",
    matchRule: "Host(`internal-gw.homelab.local`) && PathPrefix(`/api/triton`)",
    backends: [{ serviceName: "triton-inference-server", servicePort: 8000 }], // Assuming Triton runs on port 8000
    middleware: ["strip-api-prefix", "global-rate-limit"],
};

const customApiRoute: ApiRouteConfig = {
    routeName: "custom-ai",
    matchRule: "Host(`internal-gw.homelab.local`) && PathPrefix(`/api/custom`)",
    backends: [{ serviceName: "custom-ai-service", servicePort: 5000 }],
    middleware: ["strip-api-prefix"],
};

// Placeholder route for MCP - adjust match rule and backend as needed
const mcpRoute: ApiRouteConfig = {
    routeName: "mcp-handler",
    matchRule: "Host(`internal-gw.homelab.local`) && PathPrefix(`/mcp/v1`)",
    backends: [{ serviceName: "mcp-backend-service", servicePort: 8080 }],
    // Add specific middleware for MCP auth/transformation if required
};

// Placeholder route for A2A - adjust match rule and backend as needed
const a2aRoute: ApiRouteConfig = {
    routeName: "a2a-handler",
    matchRule: "Host(`internal-gw.homelab.local`) && PathPrefix(`/a2a/`)", // Or maybe gRPC routing if applicable
    backends: [{ serviceName: "a2a-backend-service", servicePort: 9090 }],
    // Add specific middleware for A2A auth/transformation if required
};


const internalGw = new InternalApiGateway("internal-ai-gw", {
    provider: k8sProvider,
    namespace: "ai-infra", // Deploy gateway in the AI namespace
    replicas: 2,
    middleware: [rateLimitMiddleware, stripApiPrefixMiddleware],
    routes: [tritonRoute, customApiRoute, mcpRoute, a2aRoute],
    enableMetrics: true,
    enableAccessLogs: true,
    helmChartValues: { // Example: Add custom Helm values
        // Configure gRPC entrypoint if needed for A2A
        // ports: {
        //     grpc: { port: 9000, expose: true, exposedPort: 90, protocol: "TCP" }
        // }
    }
});

export const gatewayIp = internalGw.gatewayServiceClusterIp;
*/
