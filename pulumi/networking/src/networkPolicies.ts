import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Defines a peer for network policy rules (podSelector, namespaceSelector, or ipBlock).
 */
interface NetworkPolicyPeer {
    podSelector?: pulumi.Input<k8s.types.input.meta.v1.LabelSelector>;
    namespaceSelector?: pulumi.Input<k8s.types.input.meta.v1.LabelSelector>;
    ipBlock?: pulumi.Input<k8s.types.input.networking.v1.IPBlock>;
}

/**
 * Defines ports for network policy rules.
 */
interface NetworkPolicyPort {
    protocol?: pulumi.Input<string>; // TCP, UDP, SCTP
    port?: pulumi.Input<number | string>; // Port number or named port
}

/**
 * Configuration for a specific allow rule (ingress or egress).
 */
interface AllowRule {
    /** Description of the rule for clarity. */
    description: string;
    /** List of peers the rule applies to. */
    peers: NetworkPolicyPeer[];
    /** List of ports the rule applies to. */
    ports?: NetworkPolicyPort[];
}

/**
 * Configuration for network policies within a specific namespace.
 */
interface NamespacePolicyConfig {
    /** The name of the namespace. */
    namespace: pulumi.Input<string>;
    /** Apply default deny-all ingress policy. Defaults to true. */
    defaultDenyIngress?: boolean;
    /** Apply default deny-all egress policy. Defaults to true. */
    defaultDenyEgress?: boolean;
    /** Pod selector for which these policies apply (default: all pods in namespace). */
    podSelector?: pulumi.Input<k8s.types.input.meta.v1.LabelSelector>;
    /** List of specific ingress allow rules. */
    ingressAllows?: AllowRule[];
    /** List of specific egress allow rules. */
    egressAllows?: AllowRule[];
    /** Allow egress to DNS (kube-dns/coredns). Defaults to true. */
    allowDnsEgress?: boolean;
}

/**
 * Arguments for the NetworkPolicies component.
 */
interface NetworkPoliciesArgs {
    /** Kubernetes provider instance. */
    provider: k8s.Provider;
    /** Array of policy configurations for each namespace. */
    namespacePolicies: NamespacePolicyConfig[];
    /** Optional: Global egress rules applied to all managed namespaces (e.g., allow egress to monitoring). */
    globalEgressAllows?: AllowRule[];
}

/**
 * Pulumi component for configuring Kubernetes Network Policies.
 *
 * Creates default deny policies and specific allow rules for ingress and egress
 * across multiple namespaces.
 *
 * Visualization: Tools like 'netpol' (https://github.com/ahmetb/kubernetes-network-policy-recipes)
 * or commercial solutions can help visualize the applied policies.
 *
 * Testing: Use tools like 'np-viewer' or manually test connectivity between pods
 * (e.g., `kubectl exec -it <pod> -- curl <target-service>`) to verify policy enforcement.
 * Consider network policy testing frameworks for automated validation.
 */
export class NetworkPolicies extends pulumi.ComponentResource {
    public readonly policies: pulumi.Output<k8s.networking.v1.NetworkPolicy[]>;

    constructor(name: string, args: NetworkPoliciesArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:NetworkPolicies", name, args, opts);

        const { provider, namespacePolicies, globalEgressAllows = [] } = args;
        const createdPolicies: pulumi.Output<k8s.networking.v1.NetworkPolicy>[] = [];

        namespacePolicies.forEach(nsConfig => {
            const namespace = nsConfig.namespace;
            const podSelector = nsConfig.podSelector ?? {}; // Default to all pods if not specified
            const defaultDenyIngress = nsConfig.defaultDenyIngress ?? true;
            const defaultDenyEgress = nsConfig.defaultDenyEgress ?? true;
            const allowDnsEgress = nsConfig.allowDnsEgress ?? true;

            // --- Default Deny Policies ---
            if (defaultDenyIngress) {
                const denyIngress = new k8s.networking.v1.NetworkPolicy(`${name}-deny-ingress-${pulumi.output(namespace).apply(ns => ns)}`, {
                    metadata: { name: "default-deny-ingress", namespace: namespace },
                    spec: {
                        podSelector: podSelector,
                        policyTypes: ["Ingress"],
                        ingress: [], // Empty ingress array means deny all
                    },
                }, { parent: this, provider: provider });
                createdPolicies.push(pulumi.output(denyIngress));
            }

            if (defaultDenyEgress) {
                const denyEgress = new k8s.networking.v1.NetworkPolicy(`${name}-deny-egress-${pulumi.output(namespace).apply(ns => ns)}`, {
                    metadata: { name: "default-deny-egress", namespace: namespace },
                    spec: {
                        podSelector: podSelector,
                        policyTypes: ["Egress"],
                        egress: [], // Empty egress array means deny all (will be overridden by specific allows)
                    },
                }, { parent: this, provider: provider });
                createdPolicies.push(pulumi.output(denyEgress));
            }

            // --- Specific Allow Policies ---
            const ingressRules = nsConfig.ingressAllows?.map(rule => ({
                from: rule.peers,
                ports: rule.ports,
            })) ?? [];

            const egressRules = nsConfig.egressAllows?.map(rule => ({
                to: rule.peers,
                ports: rule.ports,
            })) ?? [];

            // Add global egress rules
            globalEgressAllows.forEach(rule => {
                egressRules.push({
                    to: rule.peers,
                    ports: rule.ports,
                });
            });

            // Add DNS egress rule if enabled
            if (allowDnsEgress) {
                egressRules.push({
                    // Allow egress to kube-dns/coredns service endpoints
                    // This selector might need adjustment based on your cluster's DNS setup
                    to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } }, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
                    ports: [
                        { protocol: "UDP", port: 53 },
                        { protocol: "TCP", port: 53 },
                    ],
                });
            }

            // Create combined allow policy if there are any rules
            if (ingressRules.length > 0 || egressRules.length > 0) {
                const allowPolicy = new k8s.networking.v1.NetworkPolicy(`${name}-allow-${pulumi.output(namespace).apply(ns => ns)}`, {
                    metadata: { name: `allow-traffic`, namespace: namespace },
                    spec: {
                        podSelector: podSelector,
                        policyTypes: [
                            ...(ingressRules.length > 0 ? ["Ingress"] : []),
                            ...(egressRules.length > 0 ? ["Egress"] : []),
                        ],
                        ingress: ingressRules.length > 0 ? ingressRules : undefined,
                        egress: egressRules.length > 0 ? egressRules : undefined,
                    },
                }, { parent: this, provider: provider });
                createdPolicies.push(pulumi.output(allowPolicy));
            }
        });

        this.policies = pulumi.all(createdPolicies);

        pulumi.log.info("Network Policies configured. Use tools like 'kubectl get netpol -A' to view. Test connectivity between pods.", this);
        pulumi.log.warn("Network Policy visualization and automated testing require external tools.", this);

        this.registerOutputs({
            policies: this.policies,
        });
    }
}

// Example Usage (within your main Pulumi program):
/*
const k8sProvider = new k8s.Provider("k8s-provider", { ... });

const monitoringNamespace = "monitoring";
const aiNamespace = "ai";
const dataNamespace = "data";

const networkPolicies = new NetworkPolicies("homelab-netpols", {
    provider: k8sProvider,
    // Define global rules, e.g., allow all namespaces to talk to monitoring
    globalEgressAllows: [
        {
            description: "Allow egress to monitoring namespace",
            peers: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": monitoringNamespace } } }],
            // Add specific ports if needed, otherwise allows all ports to selected peers
        }
    ],
    namespacePolicies: [
        // Monitoring Namespace: Allow ingress from Prometheus, Grafana, etc. Allow broad egress.
        {
            namespace: monitoringNamespace,
            defaultDenyIngress: true,
            defaultDenyEgress: false, // Allow egress by default from monitoring namespace
            ingressAllows: [
                {
                    description: "Allow ingress from specific monitoring components if needed",
                    peers: [
                        // Example: Allow from Grafana pods if they are in a different namespace
                        // { namespaceSelector: { matchLabels: { name: "grafana" } }, podSelector: { matchLabels: { app: "grafana" } } }
                    ],
                    // ports: [...] // Specify ports if needed
                },
                 {
                    description: "Allow ingress from API Gateway for metrics",
                    peers: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": aiNamespace } }, podSelector: { matchLabels: { app: "internal-ai-gw-traefik" } } }], // Adjust labels
                    ports: [{ protocol: "TCP", port: 9100 }], // Example Prometheus scrape port
                },
            ],
            // Egress allowed by default (defaultDenyEgress: false)
        },
        // AI Namespace: Default deny, allow ingress from API gateway, egress to data and monitoring
        {
            namespace: aiNamespace,
            defaultDenyIngress: true,
            defaultDenyEgress: true,
            ingressAllows: [
                {
                    description: "Allow ingress from Internal API Gateway",
                    peers: [{ podSelector: { matchLabels: { app: "internal-ai-gw-traefik" } } }], // Assuming GW is in the same namespace
                    // ports: [...] // Specify ports AI services listen on
                },
            ],
            egressAllows: [
                {
                    description: "Allow egress to Data namespace services",
                    peers: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": dataNamespace } } }],
                    // ports: [...] // Specify ports for DBs, queues etc.
                },
                // Global egress rule already allows egress to monitoring
            ],
        },
        // Data Namespace: Default deny, allow ingress from AI namespace, limited egress
        {
            namespace: dataNamespace,
            defaultDenyIngress: true,
            defaultDenyEgress: true,
            ingressAllows: [
                {
                    description: "Allow ingress from AI namespace",
                    peers: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": aiNamespace } } }],
                    // ports: [...] // Specify ports DBs, queues listen on
                },
            ],
            egressAllows: [
                // Allow egress back to specific AI services if needed (e.g., callbacks)
                // {
                //     description: "Allow egress back to specific AI service",
                //     peers: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": aiNamespace } }, podSelector: { matchLabels: { app: "specific-ai-app" } } }],
                //     ports: [...]
                // },
                // Global egress rule already allows egress to monitoring
            ],
        },
        // Add configurations for other namespaces (e.g., automation)
    ],
});
*/
