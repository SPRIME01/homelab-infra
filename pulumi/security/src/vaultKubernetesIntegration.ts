import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as vault from "@pulumi/vault";
import * as fs from "fs";

/**
 * VaultKubernetesIntegration sets up Vault integration with Kubernetes
 * for secret management and injection into pods.
 */
export class VaultKubernetesIntegration extends pulumi.ComponentResource {
    public readonly kubeAuthBackend: vault.auth.Backend;
    public readonly vaultPolicies: { [name: string]: vault.Policy };
    public readonly vaultRoles: { [name: string]: vault.auth.KubernetesAuthBackendRole };
    public readonly vaultInjector: k8s.helm.v3.Release;

    constructor(name: string, args: VaultKubernetesIntegrationArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:security:VaultKubernetesIntegration", name, args, opts);

        const {
            kubeConfig,
            vaultAddr,
            kubeNamespace = "vault",
            kubeServiceAccount = "vault",
            kubeAuthPath = "kubernetes",
            policies = [],
            roles = [],
        } = args;

        // 1. Enable Kubernetes auth method in Vault
        this.kubeAuthBackend = new vault.auth.Backend(`${name}-k8s-auth`, {
            type: "kubernetes",
            path: kubeAuthPath,
        }, { parent: this });

        // 2. Configure Kubernetes auth method
        const k8sAuthConfig = new vault.auth.KubernetesAuthBackendConfig(`${name}-k8s-auth-config`, {
            backend: kubeAuthPath,
            kubernetesHost: "https://kubernetes.default.svc",
            // Uncomment if using TokenReviewer approach
            // serviceAccountJwt: serviceAccountToken,
        }, { parent: this, dependsOn: [this.kubeAuthBackend] });

        // 3. Create Vault policies
        this.vaultPolicies = {};
        for (const policy of policies) {
            this.vaultPolicies[policy.name] = new vault.Policy(`${name}-policy-${policy.name}`, {
                name: policy.name,
                policy: policy.rules,
            }, { parent: this });
        }

        // 4. Create Kubernetes auth roles that map service accounts to policies
        this.vaultRoles = {};
        for (const role of roles) {
            this.vaultRoles[role.name] = new vault.auth.KubernetesAuthBackendRole(`${name}-role-${role.name}`, {
                backend: kubeAuthPath,
                roleName: role.name,
                boundServiceAccountNames: role.serviceAccounts,
                boundServiceAccountNamespaces: role.namespaces,
                tokenTtl: role.ttl || 3600,
                tokenPolicies: role.policies,
            }, { parent: this, dependsOn: [k8sAuthConfig] });
        }

        // 5. Deploy Vault Agent Injector using Helm
        this.vaultInjector = new k8s.helm.v3.Release(`${name}-injector`, {
            chart: "vault",
            version: "0.25.0", // Update to the latest stable version
            repositoryOpts: {
                repo: "https://helm.releases.hashicorp.com",
            },
            namespace: kubeNamespace,
            createNamespace: true,
            values: {
                injector: {
                    enabled: true,
                },
                server: {
                    enabled: false, // We're using an external Vault server
                },
                externalVaultAddr: vaultAddr,
            },
        }, { parent: this });

        this.registerOutputs({
            kubeAuthBackend: this.kubeAuthBackend,
            vaultPolicies: this.vaultPolicies,
            vaultRoles: this.vaultRoles,
            vaultInjector: this.vaultInjector,
        });
    }
}

/**
 * Arguments for VaultKubernetesIntegration
 */
export interface VaultKubernetesIntegrationArgs {
    /**
     * Path to kubeconfig file
     */
    kubeConfig: string;

    /**
     * Vault server address
     */
    vaultAddr: string;

    /**
     * Kubernetes namespace for Vault components
     */
    kubeNamespace?: string;

    /**
     * Service account for Vault
     */
    kubeServiceAccount?: string;

    /**
     * Path for Kubernetes auth method
     */
    kubeAuthPath?: string;

    /**
     * Vault policies to create
     */
    policies: VaultPolicy[];

    /**
     * Kubernetes auth roles to create
     */
    roles: VaultKubernetesRole[];
}

/**
 * Represents a Vault policy
 */
export interface VaultPolicy {
    name: string;
    rules: string;
}

/**
 * Represents a Vault Kubernetes auth role
 */
export interface VaultKubernetesRole {
    name: string;
    serviceAccounts: string[];
    namespaces: string[];
    ttl?: number;
    policies: string[];
}

/**
 * Example usage of VaultKubernetesIntegration
 */
export function createVaultKubernetesExample(): VaultKubernetesIntegration {
    // Define policies for different application types
    const databasePolicy: VaultPolicy = {
        name: "database-access",
        rules: `
            path "database/creds/postgres-*" {
                capabilities = ["read"]
            }
            path "database/creds/mysql-*" {
                capabilities = ["read"]
            }
        `,
    };

    const secretsPolicy: VaultPolicy = {
        name: "app-secrets",
        rules: `
            path "secret/data/apps/*" {
                capabilities = ["read"]
            }
        `,
    };

    // Define Kubernetes auth roles
    const appRole: VaultKubernetesRole = {
        name: "app-role",
        serviceAccounts: ["default", "app"],
        namespaces: ["default", "apps"],
        ttl: 3600,
        policies: ["app-secrets"],
    };

    const dbRole: VaultKubernetesRole = {
        name: "db-role",
        serviceAccounts: ["db"],
        namespaces: ["database"],
        ttl: 1800,
        policies: ["database-access"],
    };

    // Create Vault Kubernetes integration
    return new VaultKubernetesIntegration("homelab", {
        kubeConfig: "~/.kube/config",
        vaultAddr: "http://vault.homelab:8200",
        kubeNamespace: "vault",
        policies: [databasePolicy, secretsPolicy],
        roles: [appRole, dbRole],
    });
}

/**
 * Example: Pod with Vault annotations for secret injection
 *
 * This is an example of how to use annotations with the Vault Agent Injector.
 * You would use these annotations on your Kubernetes pods to inject secrets.
 */
export function podWithVaultAnnotationsExample(): k8s.core.v1.Pod {
    return new k8s.core.v1.Pod("example-app", {
        metadata: {
            name: "example-app",
            namespace: "default",
            annotations: {
                "vault.hashicorp.com/agent-inject": "true",
                "vault.hashicorp.com/role": "app-role",
                "vault.hashicorp.com/agent-inject-secret-config.json": "secret/data/apps/example-app",
                "vault.hashicorp.com/agent-inject-template-config.json": `
                    {{- with secret "secret/data/apps/example-app" -}}
                    {
                        "apiKey": "{{ .data.data.apiKey }}",
                        "dbPassword": "{{ .data.data.dbPassword }}"
                    }
                    {{- end -}}
                `,
                "vault.hashicorp.com/agent-inject-secret-db-creds": "database/creds/postgres-role",
                "vault.hashicorp.com/agent-inject-template-db-creds": `
                    {{- with secret "database/creds/postgres-role" -}}
                    {
                        "username": "{{ .data.username }}",
                        "password": "{{ .data.password }}"
                    }
                    {{- end -}}
                `,
            },
        },
        spec: {
            containers: [{
                name: "app",
                image: "your-app-image:latest",
                volumeMounts: [
                    {
                        name: "config",
                        mountPath: "/app/config",
                        readOnly: true,
                    },
                ],
            }],
            serviceAccountName: "app",
        },
    });
}
