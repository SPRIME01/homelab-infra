import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface KubernetesRbacOptions {
    managedNamespaces: pulumi.Input<string>[];
    serviceAccounts?: {
        name: string;
        namespace: string;
        rules: k8s.types.input.rbac.v1.PolicyRule[];
    }[];
}

export class KubernetesRbac extends pulumi.ComponentResource {
    public readonly clusterRoles: { [key: string]: k8s.rbac.v1.ClusterRole };
    public readonly clusterRoleBindings: { [key: string]: k8s.rbac.v1.ClusterRoleBinding };
    public readonly roles: { [key: string]: k8s.rbac.v1.Role };
    public readonly roleBindings: { [key: string]: k8s.rbac.v1.RoleBinding };
    public readonly serviceAccounts: { [key: string]: k8s.core.v1.ServiceAccount };

    constructor(
        name: string,
        options: KubernetesRbacOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:KubernetesRbac", name, {}, opts);

        this.clusterRoles = {};
        this.clusterRoleBindings = {};
        this.roles = {};
        this.roleBindings = {};
        this.serviceAccounts = {};

        // Create admin ClusterRole
        this.clusterRoles.admin = new k8s.rbac.v1.ClusterRole(`${name}-admin`, {
            metadata: {
                name: "homelab-admin",
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                    "rbac.authorization.k8s.io/aggregate-to-admin": "true",
                },
            },
            rules: [
                {
                    apiGroups: ["*"],
                    resources: ["*"],
                    verbs: ["*"],
                },
                {
                    nonResourceURLs: ["*"],
                    verbs: ["*"],
                },
            ],
        }, { parent: this });

        // Create developer ClusterRole
        this.clusterRoles.developer = new k8s.rbac.v1.ClusterRole(`${name}-developer`, {
            metadata: {
                name: "homelab-developer",
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            rules: [
                {
                    apiGroups: [""],
                    resources: ["pods", "services", "configmaps", "secrets", "persistentvolumeclaims"],
                    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
                },
                {
                    apiGroups: ["apps"],
                    resources: ["deployments", "statefulsets", "daemonsets"],
                    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
                },
                {
                    apiGroups: ["networking.k8s.io"],
                    resources: ["ingresses"],
                    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
                },
                {
                    apiGroups: ["batch"],
                    resources: ["jobs", "cronjobs"],
                    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
                },
            ],
        }, { parent: this });

        // Create viewer ClusterRole
        this.clusterRoles.viewer = new k8s.rbac.v1.ClusterRole(`${name}-viewer`, {
            metadata: {
                name: "homelab-viewer",
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            rules: [
                {
                    apiGroups: [""],
                    resources: ["pods", "services", "configmaps", "persistentvolumeclaims"],
                    verbs: ["get", "list", "watch"],
                },
                {
                    apiGroups: ["apps"],
                    resources: ["deployments", "statefulsets", "daemonsets"],
                    verbs: ["get", "list", "watch"],
                },
                {
                    apiGroups: ["networking.k8s.io"],
                    resources: ["ingresses"],
                    verbs: ["get", "list", "watch"],
                },
            ],
        }, { parent: this });

        // Create service accounts and their roles
        if (options.serviceAccounts) {
            options.serviceAccounts.forEach(sa => {
                // Create service account
                this.serviceAccounts[sa.name] = new k8s.core.v1.ServiceAccount(`${name}-${sa.name}`, {
                    metadata: {
                        name: sa.name,
                        namespace: sa.namespace,
                        labels: {
                            "app.kubernetes.io/managed-by": "pulumi",
                        },
                    },
                }, { parent: this });

                // Create role for service account
                this.roles[sa.name] = new k8s.rbac.v1.Role(`${name}-${sa.name}`, {
                    metadata: {
                        name: sa.name,
                        namespace: sa.namespace,
                        labels: {
                            "app.kubernetes.io/managed-by": "pulumi",
                        },
                    },
                    rules: sa.rules,
                }, { parent: this });

                // Create role binding for service account
                this.roleBindings[sa.name] = new k8s.rbac.v1.RoleBinding(`${name}-${sa.name}`, {
                    metadata: {
                        name: sa.name,
                        namespace: sa.namespace,
                        labels: {
                            "app.kubernetes.io/managed-by": "pulumi",
                        },
                    },
                    subjects: [{
                        kind: "ServiceAccount",
                        name: this.serviceAccounts[sa.name].metadata.name,
                        namespace: sa.namespace,
                    }],
                    roleRef: {
                        kind: "Role",
                        name: this.roles[sa.name].metadata.name,
                        apiGroup: "rbac.authorization.k8s.io",
                    },
                }, { parent: this });
            });
        }

        // Create namespace-specific roles for each managed namespace
        options.managedNamespaces.forEach(namespace => {
            // Create developer role for namespace
            this.roles[`developer-${namespace}`] = new k8s.rbac.v1.Role(`${name}-developer-${namespace}`, {
                metadata: {
                    name: "developer",
                    namespace: namespace,
                    labels: {
                        "app.kubernetes.io/managed-by": "pulumi",
                    },
                },
                rules: [
                    {
                        apiGroups: [""],
                        resources: ["pods/exec", "pods/portforward"],
                        verbs: ["create", "get"],
                    },
                    {
                        apiGroups: [""],
                        resources: ["pods/log"],
                        verbs: ["get", "list", "watch"],
                    },
                ],
            }, { parent: this });

            // Create viewer role for namespace
            this.roles[`viewer-${namespace}`] = new k8s.rbac.v1.Role(`${name}-viewer-${namespace}`, {
                metadata: {
                    name: "viewer",
                    namespace: namespace,
                    labels: {
                        "app.kubernetes.io/managed-by": "pulumi",
                    },
                },
                rules: [
                    {
                        apiGroups: [""],
                        resources: ["pods/log"],
                        verbs: ["get", "list", "watch"],
                    },
                ],
            }, { parent: this });
        });

        // Create monitoring role for cross-namespace operations
        this.clusterRoles.monitoring = new k8s.rbac.v1.ClusterRole(`${name}-monitoring`, {
            metadata: {
                name: "homelab-monitoring",
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            rules: [
                {
                    apiGroups: [""],
                    resources: ["pods", "services", "nodes"],
                    verbs: ["get", "list", "watch"],
                },
                {
                    apiGroups: ["metrics.k8s.io"],
                    resources: ["pods", "nodes"],
                    verbs: ["get", "list", "watch"],
                },
            ],
        }, { parent: this });

        // Create security role for policy enforcement
        this.clusterRoles.security = new k8s.rbac.v1.ClusterRole(`${name}-security`, {
            metadata: {
                name: "homelab-security",
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            rules: [
                {
                    apiGroups: ["policy"],
                    resources: ["podsecuritypolicies"],
                    verbs: ["use"],
                },
                {
                    apiGroups: ["networking.k8s.io"],
                    resources: ["networkpolicies"],
                    verbs: ["get", "list", "watch"],
                },
            ],
        }, { parent: this });

        this.registerOutputs({
            clusterRoleNames: Object.keys(this.clusterRoles).reduce((acc, key) => ({
                ...acc,
                [key]: this.clusterRoles[key].metadata.name,
            }), {}),
            serviceAccountNames: Object.keys(this.serviceAccounts).reduce((acc, key) => ({
                ...acc,
                [key]: this.serviceAccounts[key].metadata.name,
            }), {}),
        });
    }

    // Helper method to create a role binding for a user
    public createUserRoleBinding(
        username: string,
        namespace: string,
        roleName: string
    ): k8s.rbac.v1.RoleBinding {
        return new k8s.rbac.v1.RoleBinding(`${username}-${namespace}`, {
            metadata: {
                name: `${username}-${roleName}`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            subjects: [{
                kind: "User",
                name: username,
                apiGroup: "rbac.authorization.k8s.io",
            }],
            roleRef: {
                kind: "ClusterRole",
                name: `homelab-${roleName}`,
                apiGroup: "rbac.authorization.k8s.io",
            },
        }, { parent: this });
    }

    // Helper method to create a service account with specific permissions
    public createServiceAccountWithRole(
        name: string,
        namespace: string,
        rules: k8s.types.input.rbac.v1.PolicyRule[]
    ): void {
        this.serviceAccounts[name] = new k8s.core.v1.ServiceAccount(`${name}`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
        }, { parent: this });

        this.roles[name] = new k8s.rbac.v1.Role(`${name}`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            rules: rules,
        }, { parent: this });

        this.roleBindings[name] = new k8s.rbac.v1.RoleBinding(`${name}`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            subjects: [{
                kind: "ServiceAccount",
                name: this.serviceAccounts[name].metadata.name,
                namespace: namespace,
            }],
            roleRef: {
                kind: "Role",
                name: this.roles[name].metadata.name,
                apiGroup: "rbac.authorization.k8s.io",
            },
        }, { parent: this });
    }
}
