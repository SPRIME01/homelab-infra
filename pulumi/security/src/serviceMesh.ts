import * R from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

// --- Configuration Interfaces ---

export interface ServiceMeshArgs {
    /**
     * Namespace for the Linkerd control plane.
     * @default "linkerd"
     */
    namespace?: R.Input<string>;

    /**
     * Enable High Availability mode for Linkerd control plane. Recommended: false for homelabs.
     * @default false
     */
    haMode?: R.Input<boolean>;

    /**
     * Install the Linkerd Viz extension for observability (dashboard, metrics).
     * @default true
     */
    enableViz?: R.Input<boolean>;

    /**
     * Namespace for the Linkerd Viz extension.
     * @default "linkerd-viz"
     */
    vizNamespace?: R.Input<string>;

    /**
     * The identity trust domain used by Linkerd.
     * @default "cluster.local"
     */
    identityTrustDomain?: R.Input<string>;

    /**
     * Version of the Linkerd control plane Helm chart.
     * @default "stable-2.14.9" // Example: Use a specific stable version
     */
    linkerdVersion?: R.Input<string>;

    /**
     * Version of the Linkerd Viz extension Helm chart.
     * @default "stable-2.14.9" // Example: Use a specific stable version matching control plane
     */
    vizVersion?: R.Input<string>;

    /**
     * Optional Helm values overrides for the Linkerd control plane chart.
     */
    helmValues?: R.Input<object>;

    /**
     * Optional Helm values overrides for the Linkerd Viz extension chart.
     */
    vizHelmValues?: R.Input<object>;

    /**
     * Optional: Reference to the InternalTls component's CA secret if using custom CA.
     * Linkerd generates its own CA by default. Provide this only for advanced integration.
     * Secret must contain tls.crt, tls.key, and ca.crt.
     */
    // internalCaSecretName?: R.Input<string>; // Advanced: Usually not needed for Linkerd's own identity system
}

export interface ServerAuthorizationArgs {
    /** Pulumi resource name */
    name: string;
    /** Namespace for the ServerAuthorization resource */
    namespace: R.Input<string>;
    /** Name of the Server resource this authorization applies to */
    serverName: R.Input<string>;
    /** List of authenticated client identities (ServiceAccounts) allowed */
    allowedServiceAccounts: R.Input<string[]>; // e.g., ["client-sa.client-ns", "another-sa.another-ns"]
    /** Optional labels for the ServerAuthorization resource */
    labels?: R.Input<{[key: string]: R.Input<string>}>;
}

export interface ServerArgs {
    /** Pulumi resource name */
    name: string;
    /** Namespace for the Server resource */
    namespace: R.Input<string>;
    /** Labels for the Server resource */
    labels?: R.Input<{[key: string]: R.Input<string>}>;
    /** Selects pods to which this Server applies */
    podSelector: R.Input<{[key: string]: R.Input<string>}>;
    /** Port on the pods to which this Server applies (numeric or name) */
    port: R.Input<number | string>;
    /** Optional proxy protocol expected (e.g., "HTTP/1", "HTTP/2", "gRPC", "opaque") */
    proxyProtocol?: R.Input<string>;
}


// --- ServiceMesh Component ---

/**
 * Deploys and configures Linkerd as a lightweight service mesh for secure
 * service-to-service communication in Kubernetes.
 *
 * Features:
 * - Installs Linkerd control plane via Helm.
 * - Installs Linkerd Viz extension for observability (optional).
 * - Enables automatic mutual TLS (mTLS) for meshed pods.
 * - Provides helpers for creating Linkerd Server and ServerAuthorization policies.
 *
 * Note: Pods must be annotated with `linkerd.io/inject: enabled` (typically on their namespace)
 * to join the mesh and get the Linkerd sidecar proxy injected.
 */
export class ServiceMesh extends R.ComponentResource {
    public readonly linkerdNamespace: R.Output<string>;
    public readonly vizNamespace?: R.Output<string>;
    public readonly linkerdChart: k8s.helm.v3.Chart;
    public readonly vizChart?: k8s.helm.v3.Chart;

    constructor(name: string, args: ServiceMeshArgs, opts?: R.ComponentResourceOptions) {
        super("homelab:security:ServiceMesh", name, args, opts);

        const linkerdNsName = args.namespace ?? "linkerd";
        const vizNsName = args.vizNamespace ?? "linkerd-viz";
        const enableViz = args.enableViz ?? true;
        const haMode = args.haMode ?? false;
        const identityTrustDomain = args.identityTrustDomain ?? "cluster.local";
        const linkerdVersion = args.linkerdVersion ?? "stable-2.14.9"; // Pin version
        const vizVersion = args.vizVersion ?? linkerdVersion; // Match viz version

        this.linkerdNamespace = R.output(linkerdNsName);

        // Create Linkerd Namespace
        const linkerdNs = new k8s.core.v1.Namespace(linkerdNsName, {
            metadata: {
                name: linkerdNsName,
                labels: { "linkerd.io/is-control-plane": "true" } // Label for potential policies
            }
        }, { parent: this });

        // Install Linkerd Control Plane Helm Chart
        // CRDs are typically installed separately or via the chart's CRD resources.
        // Linkerd Helm chart handles CRD installation.
        this.linkerdChart = new k8s.helm.v3.Chart("linkerd-control-plane", {
            chart: "linkerd-control-plane",
            version: linkerdVersion,
            namespace: linkerdNsName,
            fetchOpts: { repo: "https://helm.linkerd.io/stable" },
            values: R.all([args.helmValues ?? {}]).apply(([helmValues]) => ({
                identityTrustDomain: identityTrustDomain,
                // Disable HA by default for homelab efficiency
                controllerReplicas: haMode ? 3 : 1,
                proxy: { // Adjust proxy resources if needed
                    resources: {
                        cpu: { limit: "1", request: "10m" }, // Example: Lower requests for homelab
                        memory: { limit: "250Mi", request: "20Mi" }
                    }
                },
                // Spread additional user-provided values
                ...helmValues,
                // Ensure CRDs are managed by Helm
                installCRDs: true, // Let Helm handle CRDs
            })),
        }, { parent: this, dependsOn: [linkerdNs] });

        // Install Linkerd Viz Extension (Optional)
        if (enableViz) {
            this.vizNamespace = R.output(vizNsName);

            const vizNs = new k8s.core.v1.Namespace(vizNsName, {
                metadata: {
                    name: vizNsName,
                    labels: { "linkerd.io/extension": "viz" }
                }
            }, { parent: this });

            this.vizChart = new k8s.helm.v3.Chart("linkerd-viz", {
                chart: "linkerd-viz",
                version: vizVersion,
                namespace: vizNsName,
                fetchOpts: { repo: "https://helm.linkerd.io/stable" },
                values: R.all([args.vizHelmValues ?? {}]).apply(([vizHelmValues]) => ({
                    // Adjust resources if needed
                    dashboard: {
                        replicas: haMode ? 2 : 1,
                        resources: { // Example: Lower requests
                            cpu: { request: "10m" },
                            memory: { request: "50Mi" }
                        }
                    },
                    // Spread additional user-provided values
                    ...vizHelmValues,
                })),
            }, { parent: this, dependsOn: [this.linkerdChart, vizNs] }); // Depends on control plane
        }

        // Register outputs
        this.registerOutputs({
            linkerdNamespace: this.linkerdNamespace,
            vizNamespace: this.vizNamespace,
            linkerdChartResources: this.linkerdChart.resources,
            vizChartResources: this.vizChart ? this.vizChart.resources : undefined,
        });
    }

    /**
     * Creates a Linkerd Server resource.
     * Defines a logical server identified by port and protocol over a set of pods.
     */
    public createServer(args: ServerArgs, opts?: R.CustomResourceOptions): k8s.apiextensions.CustomResource {
        return new k8s.apiextensions.CustomResource(args.name, {
            apiVersion: "policy.linkerd.io/v1beta1", // Use appropriate API version
            kind: "Server",
            metadata: {
                name: args.name,
                namespace: args.namespace,
                labels: args.labels,
            },
            spec: {
                podSelector: args.podSelector,
                port: args.port,
                proxyProtocol: args.proxyProtocol,
            }
        }, { parent: this, ...opts });
    }

    /**
     * Creates a Linkerd ServerAuthorization resource.
     * Defines which authenticated clients (based on mTLS identity/ServiceAccount)
     * are allowed to access a specific Server.
     */
    public createServerAuthorization(args: ServerAuthorizationArgs, opts?: R.CustomResourceOptions): k8s.apiextensions.CustomResource {
        return new k8s.apiextensions.CustomResource(args.name, {
            apiVersion: "policy.linkerd.io/v1alpha1", // Use appropriate API version
            kind: "ServerAuthorization",
            metadata: {
                name: args.name,
                namespace: args.namespace,
                labels: args.labels,
            },
            spec: {
                server: {
                    name: args.serverName,
                    // selector: {} // Can also select servers by label
                },
                client: {
                    // Allow meshed clients whose ServiceAccount matches the list
                    meshTLS: {
                        serviceAccounts: args.allowedServiceAccounts.map(sa => {
                            const parts = sa.split('.');
                            const name = parts[0];
                            const namespace = parts.length > 1 ? parts[1] : args.namespace; // Default to same namespace if not specified
                            return { name, namespace };
                        }),
                    },
                    // Can also allow unauthenticated clients if needed (less secure)
                    // unauthenticated: true,
                }
            }
        }, { parent: this, ...opts });
    }
}

/*
Example Usage:

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ServiceMesh } from "./serviceMesh"; // Adjust path

// 1. Deploy the Service Mesh
const mesh = new ServiceMesh("homelab-mesh", {
    namespace: "linkerd-system", // Optional: Customize namespace
    enableViz: true,
    // haMode: false, // Default is false, suitable for homelab
});

// --- Example Policy Configuration ---

// Assume:
// - Namespace 'app-ns' has annotation 'linkerd.io/inject: enabled'
// - A Deployment 'backend-api' in 'app-ns' with label 'app: backend-api' and ServiceAccount 'backend-api-sa'
// - A Deployment 'frontend-app' in 'app-ns' with label 'app: frontend-app' and ServiceAccount 'frontend-app-sa'

const appNs = "app-ns";

// 2. Define a Server for the backend API service on port 8080
const backendApiServer = mesh.createServer({
    name: "backend-api-server",
    namespace: appNs,
    podSelector: { app: "backend-api" }, // Selects pods of the backend deployment
    port: 8080, // The port the backend service listens on
    proxyProtocol: "HTTP/1", // Specify expected protocol
});

// 3. Define an Authorization Policy: Allow only 'frontend-app-sa' to access the 'backend-api-server'
const backendApiAuthPolicy = mesh.createServerAuthorization({
    name: "backend-api-auth",
    namespace: appNs,
    serverName: backendApiServer.metadata.name, // Reference the Server created above
    allowedServiceAccounts: [
        `frontend-app-sa.${appNs}` // Fully qualified ServiceAccount name (name.namespace)
        // Add other allowed client ServiceAccounts here if needed
    ],
});

// --- Notes ---
// - Ensure relevant namespaces (like 'app-ns' above) have the injection annotation:
//   `kubectl annotate ns app-ns linkerd.io/inject=enabled`
// - Ensure Deployments/Pods have appropriate ServiceAccount names assigned.
// - Authentication Integration: Linkerd secures traffic *between* services using mTLS based on Kubernetes ServiceAccounts.
//   It does *not* replace application-level authentication (like user logins via OAuth2/JWT) which typically happens
//   at the ingress gateway or within the application itself. Linkerd ensures that only authenticated *services*
//   (identified by their SA) can talk to each other according to policy.
// - Observability: Use `linkerd viz dashboard` (if Viz is enabled) to view traffic, success rates, latency,
//   and security policy enforcement (e.g., which connections are allowed/denied by policies).

// Export the Linkerd namespace
export const linkerdNamespace = mesh.linkerdNamespace;

*/
