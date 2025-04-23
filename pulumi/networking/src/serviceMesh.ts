import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Arguments for the ServiceMesh (Linkerd) component.
 */
interface ServiceMeshArgs {
    /** Kubernetes provider instance. */
    provider: k8s.Provider;
    /** Namespace for Linkerd control plane components (e.g., "linkerd"). */
    controlPlaneNamespace: pulumi.Input<string>;
    /** Namespace for Linkerd visualization components (e.g., "linkerd-viz"). */
    vizNamespace: pulumi.Input<string>;
    /** Enable deployment of the linkerd-viz extension (dashboard, metrics). Defaults to true. */
    deployViz?: pulumi.Input<boolean>;
    /** Optional: Resource requests and limits for Linkerd control plane components. */
    controlPlaneResources?: pulumi.Input<k8s.types.input.core.v1.ResourceRequirements>;
    /** Optional: Resource requests and limits for Linkerd data plane proxies (applied via annotation). */
    proxyResources?: pulumi.Input<k8s.types.input.core.v1.ResourceRequirements>;
    /** Optional: Additional Helm chart values for linkerd-control-plane. */
    controlPlaneHelmValues?: pulumi.Input<any>;
    /** Optional: Additional Helm chart values for linkerd-viz. */
    vizHelmValues?: pulumi.Input<any>;
    /** Optional: Set global proxy log level (e.g., "warn", "info", "debug"). Defaults to "warn". */
    proxyLogLevel?: pulumi.Input<string>;
    /** Optional: Set global proxy log format ("plain" or "json"). Defaults to "plain". */
    proxyLogFormat?: pulumi.Input<string>;
}

/**
 * Pulumi component for deploying the Linkerd service mesh.
 *
 * Deploys Linkerd using official Helm charts, providing a lightweight,
 * security-focused service mesh.
 *
 * Features Enabled/Configured by Default:
 * - Automatic mTLS: Encrypts all TCP communication between meshed pods.
 * - Basic Observability: Exposes Prometheus metrics from control plane and proxies.
 *
 * Configuration via CRDs (Examples):
 * - ServiceProfiles: Define per-route metrics, retries, and timeouts.
 * - ServerAuthorizations/Servers: Define fine-grained access policies (which clients can access which servers).
 * - TrafficSplits: Implement canary deployments or A/B testing.
 *
 * Performance Considerations:
 * - Linkerd's proxy (linkerd-proxy) is resource-efficient (written in Rust).
 * - Default resource requests/limits are generally low. Adjust `proxyResources` if needed.
 * - mTLS adds a small latency overhead, typically negligible for most applications.
 *
 * Testing Procedures:
 * - Verify mTLS: Use `linkerd check --proxy` and `linkerd viz tap deploy/...` to inspect traffic.
 * - Test Traffic Policies: Deploy `Server` and `ServerAuthorization` resources and verify blocked/allowed requests.
 * - Test Traffic Management: Deploy `ServiceProfile` or `TrafficSplit` and observe behavior/metrics.
 */
export class ServiceMesh extends pulumi.ComponentResource {
    public readonly controlPlaneRelease: k8s.helm.v3.Release;
    public readonly vizRelease?: k8s.helm.v3.Release;

    constructor(name: string, args: ServiceMeshArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:ServiceMesh", name, args, opts);

        const {
            provider,
            controlPlaneNamespace,
            vizNamespace,
            deployViz = true,
            controlPlaneResources,
            proxyResources,
            controlPlaneHelmValues = {},
            vizHelmValues = {},
            proxyLogLevel = "warn",
            proxyLogFormat = "plain",
        } = args;

        // Ensure namespaces exist
        const cpNs = new k8s.core.v1.Namespace("linkerd-cp-ns", {
            metadata: { name: controlPlaneNamespace }
        }, { parent: this, provider: provider });

        const vizNs = deployViz ? new k8s.core.v1.Namespace("linkerd-viz-ns", {
            metadata: { name: vizNamespace }
        }, { parent: this, provider: provider }) : undefined;

        // 1. Deploy Linkerd CRDs
        // It's crucial CRDs are installed before the control plane chart.
        const crdsChart = new k8s.helm.v3.Release(`${name}-crds`, {
            name: "linkerd-crds",
            chart: "linkerd-crds",
            version: "1.6.0", // Pin CRD version for stability
            repositoryOpts: { repo: "https://helm.linkerd.io/stable" },
            namespace: controlPlaneNamespace, // CRDs are cluster-scoped but Helm needs a namespace
        }, { parent: this, provider: provider, dependsOn: [cpNs] });

        // 2. Deploy Linkerd Control Plane
        this.controlPlaneRelease = new k8s.helm.v3.Release(`${name}-control-plane`, {
            name: "linkerd-control-plane",
            chart: "linkerd-control-plane",
            version: "1.14.0", // Pin control plane version
            repositoryOpts: { repo: "https://helm.linkerd.io/stable" },
            namespace: controlPlaneNamespace,
            values: pulumi.all([controlPlaneHelmValues, controlPlaneResources, proxyResources, proxyLogLevel, proxyLogFormat])
                .apply(([values, cpRes, pRes, pLogLevel, pLogFormat]) => ({
                    // Global settings
                    global: {
                        proxy: {
                            resources: pRes, // Apply proxy resource settings globally
                            logLevel: pLogLevel,
                            logFormat: pLogFormat,
                        },
                        // mTLS is enabled by default
                    },
                    // Control Plane resource settings
                    controller: { resources: cpRes },
                    destination: { resources: cpRes },
                    // ... other component resource settings if needed ...

                    // Merge additional user-provided values
                    ...values,
                })),
        }, { parent: this, provider: provider, dependsOn: [crdsChart] }); // Depends on CRDs

        // 3. Deploy Linkerd Viz Extension (Optional)
        if (deployViz && vizNs) {
            this.vizRelease = new k8s.helm.v3.Release(`${name}-viz`, {
                name: "linkerd-viz",
                chart: "linkerd-viz",
                version: "30.12.0", // Pin viz version
                repositoryOpts: { repo: "https://helm.linkerd.io/stable" },
                namespace: vizNamespace,
                values: vizHelmValues,
            }, { parent: this, provider: provider, dependsOn: [this.controlPlaneRelease, vizNs] }); // Depends on control plane
        }

        pulumi.log.info("Linkerd deployment initiated. Inject workloads by adding the 'linkerd.io/inject: enabled' annotation to their namespace or pod spec.", this);
        pulumi.log.info("Use 'linkerd check' and 'linkerd viz dashboard' (if deployed) to verify installation and runtime status.", this);
        pulumi.log.warn("Configure ServiceProfiles, ServerAuthorizations, etc., via separate k8s.apiextensions.CustomResource definitions.", this);

        this.registerOutputs({
            controlPlaneReleaseStatus: this.controlPlaneRelease.status,
            vizReleaseStatus: this.vizRelease ? this.vizRelease.status : undefined,
        });
    }
}

// Example Usage (within your main Pulumi program):
/*
const k8sProvider = new k8s.Provider("k8s-provider", { ... });

const linkerdMesh = new ServiceMesh("homelab-linkerd", {
    provider: k8sProvider,
    controlPlaneNamespace: "linkerd",
    vizNamespace: "linkerd-viz",
    deployViz: true,
    // Optional: Define resource limits for control plane and proxies
    // controlPlaneResources: {
    //     requests: { cpu: "100m", memory: "128Mi" },
    //     limits: { cpu: "500m", memory: "256Mi" },
    // },
    // proxyResources: {
    //     requests: { cpu: "25m", memory: "64Mi" },
    //     limits: { cpu: "200m", memory: "128Mi" },
    // },
    proxyLogLevel: "info", // Increase log level for debugging if needed
});

// Example: Define a ServiceProfile for a specific service
const myAppServiceProfile = new k8s.apiextensions.CustomResource("my-app-sp", {
    apiVersion: "linkerd.io/v1alpha2",
    kind: "ServiceProfile",
    metadata: {
        namespace: "my-app-namespace", // Namespace of the target service
        name: "my-app-service.my-app-namespace.svc.cluster.local", // FQDN of the service
    },
    spec: {
        routes: [{
            condition: {
                method: "GET",
                pathRegex: "/api/users/\\d+",
            },
            name: "get_user_by_id",
            isRetryable: true, // Enable retries for this route
            timeout: "100ms", // Set a timeout
        }],
        // Add more routes or default settings
    }
}, { provider: k8sProvider, dependsOn: [linkerdMesh] }); // Ensure mesh is deployed first

// Example: Define a ServerAuthorization (Access Policy)
const myApiServer = new k8s.apiextensions.CustomResource("my-api-server", {
    apiVersion: "policy.linkerd.io/v1beta3",
    kind: "Server",
    metadata: {
        namespace: "my-api-namespace",
        name: "my-api-server",
    },
    spec: {
        podSelector: { matchLabels: { app: "my-api" } }, // Selects the API server pods
        port: "http", // Reference a port named 'http' on the pods
        proxyProtocol: "HTTP/1", // Specify the protocol
    }
}, { provider: k8sProvider, dependsOn: [linkerdMesh] });

const allowFrontendAuthz = new k8s.apiextensions.CustomResource("allow-frontend-authz", {
    apiVersion: "policy.linkerd.io/v1beta3",
    kind: "ServerAuthorization",
    metadata: {
        namespace: "my-api-namespace", // Namespace where the Server resides
        name: "allow-frontend",
    },
    spec: {
        server: { name: "my-api-server" }, // Reference the Server resource
        client: {
            // Allow traffic from pods with the 'frontend' service account in the 'web' namespace
            serviceAccounts: [{ namespace: "web", name: "frontend" }],
            // Optionally restrict based on mTLS identity
            // meshTLS: {
            //     identities: ["frontend.web.serviceaccount.identity.linkerd.cluster.local"]
            // }
        }
    }
}, { provider: k8sProvider, dependsOn: [myApiServer] }); // Depends on the Server resource
*/
