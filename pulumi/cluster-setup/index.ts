import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "./k8sProvider";
import { DataNamespace } from "./dataNamespace";

/**
 * Input properties for the ClusterSetup component
 */
export interface ClusterSetupArgs {
    /**
     * List of namespaces to create in the cluster
     */
    namespaces?: string[];

    /**
     * Node labels to apply to cluster nodes
     * Key is the node name, value is a map of label key/values
     */
    nodeLabels?: {
        [nodeName: string]: {
            [labelKey: string]: string;
        };
    };

    /**
     * Optional prefix for resources created by this component
     */
    namePrefix?: string;

    /**
     * Data namespace configuration
     */
    dataNamespace?: {
        quotas?: {
            cpu: { request: string; limit: string; };
            memory: { request: string; limit: string; };
            storage?: { capacity: string; };
            pods?: number;
        };
    };
}

/**
 * ClusterSetup is a component resource that sets up the core components
 * for a K3s Kubernetes cluster in a homelab environment.
 */
export class ClusterSetup extends pulumi.ComponentResource {
    /**
     * The namespaces created by this component
     */
    public readonly namespaces: k8s.core.v1.Namespace[];

    /**
     * The service accounts created by this component
     */
    public readonly serviceAccounts: k8s.core.v1.ServiceAccount[];

    /**
     * Node labels applied by this component
     */
    public readonly nodeLabels: pulumi.Output<k8s.core.v1.Node>[];

    /**
     * The data namespace component
     */
    public readonly dataNamespace: DataNamespace;

    constructor(name: string, args: ClusterSetupArgs = {}, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k8s:ClusterSetup", name, args, opts);

        const prefix = args.namePrefix || "";
        const namespaces = args.namespaces || ["monitoring", "apps", "database", "storage"];
        const nodeLabels = args.nodeLabels || {};

        // Create namespaces
        this.namespaces = namespaces.map(ns => {
            return new k8s.core.v1.Namespace(
                `${prefix}${ns}-namespace`,
                {
                    metadata: {
                        name: ns,
                        labels: {
                            "homelab-managed": "true",
                            "app.kubernetes.io/managed-by": "pulumi",
                        },
                    },
                },
                { provider, parent: this }
            );
        });

        // Create service accounts for each namespace
        this.serviceAccounts = this.namespaces.map(namespace => {
            const ns = namespace.metadata.name;
            return new k8s.core.v1.ServiceAccount(
                `${prefix}${ns}-sa`,
                {
                    metadata: {
                        name: `${ns}-admin`,
                        namespace: ns,
                    },
                },
                { provider, parent: this, dependsOn: namespace }
            );
        });

        // Create RBAC roles and bindings
        this.namespaces.forEach(namespace => {
            const ns = namespace.metadata.name;

            // Create a Role for the namespace
            const role = new k8s.rbac.v1.Role(
                `${prefix}${ns}-admin-role`,
                {
                    metadata: {
                        name: `${ns}-admin-role`,
                        namespace: ns,
                    },
                    rules: [
                        {
                            apiGroups: ["*"],
                            resources: ["*"],
                            verbs: ["*"],
                        },
                    ],
                },
                { provider, parent: this, dependsOn: namespace }
            );

            // Create a RoleBinding for the namespace
            new k8s.rbac.v1.RoleBinding(
                `${prefix}${ns}-admin-rolebinding`,
                {
                    metadata: {
                        name: `${ns}-admin-binding`,
                        namespace: ns,
                    },
                    subjects: [
                        {
                            kind: "ServiceAccount",
                            name: `${ns}-admin`,
                            namespace: ns,
                        },
                    ],
                    roleRef: {
                        kind: "Role",
                        name: role.metadata.name,
                        apiGroup: "rbac.authorization.k8s.io",
                    },
                },
                { provider, parent: this, dependsOn: [namespace, role] }
            );
        });

        // Apply node labels
        this.nodeLabels = Object.entries(nodeLabels).map(([nodeName, labels]) => {
            return pulumi.output(
                new k8s.core.v1.Node(
                    `${prefix}${nodeName}-labels`,
                    {
                        metadata: {
                            name: nodeName,
                            labels: labels,
                        },
                    },
                    { provider, parent: this }
                )
            );
        });

        // Create data namespace
        this.dataNamespace = new DataNamespace(`${prefix}data`, {
            quotas: args.dataNamespace?.quotas,
            namePrefix: prefix
        }, { provider, parent: this });

        this.registerOutputs({
            namespaces: this.namespaces,
            serviceAccounts: this.serviceAccounts,
            nodeLabels: this.nodeLabels,
            dataNamespace: this.dataNamespace,
        });
    }
}
