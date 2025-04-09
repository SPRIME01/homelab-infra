import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

export interface N8nApiKeyOptions {
    namespace: pulumi.Input<string>;
    n8nDeploymentName: pulumi.Input<string>;
    keyRotationSchedule?: string;
    keyCount?: number;
    keyLength?: number;
    apiRateLimiting?: boolean;
    rateLimit?: number;
    rateLimitPeriodSeconds?: number;
    apiKeyUsageLogging?: boolean;
}

export class N8nApiKeys extends pulumi.ComponentResource {
    public readonly secret: k8s.core.v1.Secret;
    public readonly configMap: k8s.core.v1.ConfigMap;
    public readonly rotationJob?: k8s.batch.v1.CronJob;
    public readonly networkPolicy: k8s.networking.v1.NetworkPolicy;

    constructor(
        name: string,
        options: N8nApiKeyOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:automation:N8nApiKeys", name, {}, opts);

        const {
            namespace,
            n8nDeploymentName,
            keyRotationSchedule = "0 0 1 * *", // Monthly by default
            keyCount = 3,
            keyLength = 32,
            apiRateLimiting = true,
            rateLimit = 600,
            rateLimitPeriodSeconds = 60,
            apiKeyUsageLogging = true,
        } = options;

        // Generate API keys
        const apiKeys: Record<string, pulumi.Output<string>> = {};
        const keyNames: string[] = [];

        for (let i = 1; i <= keyCount; i++) {
            const keyName = `api-key-${i}`;
            keyNames.push(keyName);

            const key = new random.RandomPassword(`${name}-${keyName}`, {
                length: keyLength,
                special: false,
                upper: true,
                lower: true,
                number: true,
            }, { parent: this }).result;

            apiKeys[keyName] = key;
        }

        // Create a Secret containing the API keys
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-api-keys`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "api-keys",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
                annotations: {
                    "pulumi.com/skipAwait": "true",
                    "last-rotated": new Date().toISOString(),
                    "rotation-schedule": keyRotationSchedule,
                },
            },
            type: "Opaque",
            stringData: pulumi.all(apiKeys).apply(keys => {
                const data: Record<string, string> = {};
                Object.entries(keys).forEach(([keyName, keyValue]) => {
                    data[keyName.replace(/-/g, '_')] = keyValue;
                });
                return data;
            }),
        }, { parent: this });

        // Create a ConfigMap with documentation and usage instructions
        this.configMap = new k8s.core.v1.ConfigMap(`${name}-docs`, {
            metadata: {
                name: `${name}-api-key-docs`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "api-keys",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            data: {
                "README.md": `# n8n API Keys

## Available Keys

${keyNames.map(keyName => `- \`${keyName}\`: For ${keyName.includes('webhook') ? 'webhook triggers' : 'workflow execution'}`).join('\n')}

## Rotation Schedule

API keys are automatically rotated ${keyRotationSchedule === "0 0 1 * *" ? "monthly" : `according to schedule: \`${keyRotationSchedule}\``}.

## Security Guidelines

1. **Never** commit API keys to source control
2. Use separate keys for different integrations
3. Implement the principle of least privilege
4. Keys should only be used from authorized systems
5. Revoke keys immediately if compromised

## Usage Examples

### Trigger a workflow via API

\`\`\`bash
curl -X POST \\
  https://n8n.example.com/api/v1/workflows/123/trigger \\
  -H "X-N8N-API-KEY: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"data": {"key": "value"}}'
\`\`\`

### List all active workflows

\`\`\`bash
curl -X GET \\
  https://n8n.example.com/api/v1/workflows/active \\
  -H "X-N8N-API-KEY: YOUR_API_KEY"
\`\`\`

${apiRateLimiting ? `## Rate Limiting

API requests are limited to ${rateLimit} requests per ${rateLimitPeriodSeconds} seconds to prevent abuse.` : ''}

${apiKeyUsageLogging ? `## Usage Logging

All API key usage is logged and monitored for security purposes.` : ''}
`,
            },
        }, { parent: this });

        // Create a CronJob for key rotation if schedule is specified
        if (keyRotationSchedule) {
            this.rotationJob = new k8s.batch.v1.CronJob(`${name}-rotation`, {
                metadata: {
                    name: `${name}-key-rotation`,
                    namespace: namespace,
                    labels: {
                        "app.kubernetes.io/name": name,
                        "app.kubernetes.io/component": "api-keys",
                        "app.kubernetes.io/managed-by": "pulumi",
                    },
                },
                spec: {
                    schedule: keyRotationSchedule,
                    concurrencyPolicy: "Forbid",
                    successfulJobsHistoryLimit: 3,
                    failedJobsHistoryLimit: 1,
                    jobTemplate: {
                        spec: {
                            template: {
                                spec: {
                                    serviceAccountName: "n8n-api-key-rotation",
                                    containers: [{
                                        name: "key-rotation",
                                        image: "bitnami/kubectl:latest",
                                        command: ["/bin/bash", "-c"],
                                        args: [`
                                            # Get current keys
                                            echo "Starting API key rotation..."
                                            mkdir -p /tmp/keys

                                            # Create new keys
                                            ${Array.from({ length: keyCount }).map((_, i) => `
                                            NEW_KEY_${i + 1}=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w ${keyLength} | head -n 1)
                                            echo "Generated new key ${i + 1}"
                                            `).join('')}

                                            # Create new secret with updated keys and copy annotations/labels
                                            kubectl get secret ${name}-api-keys -n $NAMESPACE -o yaml | \\
                                              sed '/^data:/d;/^  api_key/d;/creationTimestamp/d;/resourceVersion/d;/uid:/d' > /tmp/keys/secret.yaml

                                            # Add updated data section with new keys
                                            echo "data:" >> /tmp/keys/secret.yaml
                                            ${Array.from({ length: keyCount }).map((_, i) => `
                                            echo "  api_key_${i + 1}: $(echo -n $NEW_KEY_${i + 1} | base64)" >> /tmp/keys/secret.yaml
                                            `).join('')}

                                            # Update last-rotated annotation
                                            sed -i '/annotations:/a\\    last-rotated: '$(date -u +"%Y-%m-%dT%H:%M:%SZ")'' /tmp/keys/secret.yaml

                                            # Apply the updated secret
                                            kubectl apply -f /tmp/keys/secret.yaml

                                            # Patch the n8n deployment to restart and pick up new keys
                                            kubectl patch deployment ${n8nDeploymentName} -n $NAMESPACE -p '{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"'$(date +%Y-%m-%dT%H:%M:%S%z)'"}}}}}' || true

                                            echo "API key rotation completed successfully"
                                        `],
                                        env: [
                                            {
                                                name: "NAMESPACE",
                                                valueFrom: {
                                                    fieldRef: {
                                                        fieldPath: "metadata.namespace",
                                                    },
                                                },
                                            },
                                        ],
                                    }],
                                    restartPolicy: "OnFailure",
                                    securityContext: {
                                        runAsNonRoot: true,
                                        runAsUser: 1000,
                                    },
                                },
                            },
                        },
                    },
                },
            }, { parent: this });

            // Create a ServiceAccount for the rotation job
            const serviceAccount = new k8s.core.v1.ServiceAccount(`${name}-rotation-sa`, {
                metadata: {
                    name: "n8n-api-key-rotation",
                    namespace: namespace,
                    labels: {
                        "app.kubernetes.io/name": name,
                        "app.kubernetes.io/component": "api-keys",
                        "app.kubernetes.io/managed-by": "pulumi",
                    },
                },
            }, { parent: this });

            // Create a Role for the rotation job
            const role = new k8s.rbac.v1.Role(`${name}-rotation-role`, {
                metadata: {
                    name: "n8n-api-key-rotation",
                    namespace: namespace,
                    labels: {
                        "app.kubernetes.io/name": name,
                        "app.kubernetes.io/component": "api-keys",
                        "app.kubernetes.io/managed-by": "pulumi",
                    },
                },
                rules: [
                    {
                        apiGroups: [""],
                        resources: ["secrets"],
                        resourceNames: [this.secret.metadata.name],
                        verbs: ["get", "update", "patch"],
                    },
                    {
                        apiGroups: ["apps"],
                        resources: ["deployments"],
                        resourceNames: [n8nDeploymentName],
                        verbs: ["get", "patch"],
                    },
                ],
            }, { parent: this });

            // Create a RoleBinding for the rotation job
            const roleBinding = new k8s.rbac.v1.RoleBinding(`${name}-rotation-rolebinding`, {
                metadata: {
                    name: "n8n-api-key-rotation",
                    namespace: namespace,
                    labels: {
                        "app.kubernetes.io/name": name,
                        "app.kubernetes.io/component": "api-keys",
                        "app.kubernetes.io/managed-by": "pulumi",
                    },
                },
                subjects: [
                    {
                        kind: "ServiceAccount",
                        name: serviceAccount.metadata.name,
                        namespace: namespace,
                    },
                ],
                roleRef: {
                    kind: "Role",
                    name: role.metadata.name,
                    apiGroup: "rbac.authorization.k8s.io",
                },
            }, { parent: this });
        }

        // Create a NetworkPolicy for secure API access
        this.networkPolicy = new k8s.networking.v1.NetworkPolicy(`${name}-network-policy`, {
            metadata: {
                name: `${name}-api-access`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "api-keys",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        "app.kubernetes.io/name": pulumi.output(n8nDeploymentName).apply(n => n.split('-')[0]),
                    },
                },
                policyTypes: ["Ingress"],
                ingress: [
                    // Allow access from within the same namespace
                    {
                        from: [{
                            podSelector: {},
                        }],
                        ports: [{
                            port: 5678,
                            protocol: "TCP",
                        }],
                    },
                    // Allow access from ingress-nginx namespace
                    {
                        from: [{
                            namespaceSelector: {
                                matchLabels: {
                                    "kubernetes.io/metadata.name": "ingress-nginx",
                                },
                            },
                        }],
                        ports: [{
                            port: 5678,
                            protocol: "TCP",
                        }],
                    },
                ],
            },
        }, { parent: this });

        // Create ConfigMap with environment variables to enable API features in n8n
        const n8nApiConfig = new k8s.core.v1.ConfigMap(`${name}-n8n-config`, {
            metadata: {
                name: `${name}-n8n-config`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "api-keys",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            data: {
                "N8N_API_ENABLED": "true",
                ...(apiKeyUsageLogging ? { "N8N_AUDIT_LOGS": "true" } : {}),
                ...(apiRateLimiting ? {
                    "N8N_SECURITY_RATE_LIMITER": "true",
                    "N8N_RATE_LIMITER_MAX": rateLimit.toString(),
                    "N8N_RATE_LIMITER_TIME_WINDOW": (rateLimitPeriodSeconds * 1000).toString(), // milliseconds
                } : {}),
            },
        }, { parent: this });

        this.registerOutputs({
            secretName: this.secret.metadata.name,
            configMapName: this.configMap.metadata.name,
            ...(this.rotationJob ? { rotationJobName: this.rotationJob.metadata.name } : {}),
            networkPolicyName: this.networkPolicy.metadata.name,
            n8nApiConfigName: n8nApiConfig.metadata.name,
            apiKeyEnvMapping: pulumi.all([...keyNames]).apply(names => {
                const mapping: Record<string, string> = {};
                names.forEach(name => {
                    // Convert api-key-1 to API_KEY_1 for environment variables
                    const envName = name.toUpperCase().replace(/-/g, '_');
                    mapping[envName] = `\${${name.replace(/-/g, '_')}}`;
                });
                return mapping;
            }),
        });
    }

    /**
     * Get environment variables to add to n8n deployment
     */
    public getApiKeyEnvironmentVariables(): pulumi.Output<{ name: string; valueFrom: { secretKeyRef: { name: string; key: string } } }[]> {
        return pulumi.all([this.secret.metadata.name]).apply(([secretName]) => {
            return Object.keys(this.secret.stringData || {}).map(key => ({
                name: `N8N_${key.toUpperCase()}`,
                valueFrom: {
                    secretKeyRef: {
                        name: secretName,
                        key,
                    },
                },
            }));
        });
    }

    /**
     * Get patch for n8n deployment to add API key configuration
     */
    public getPatchForDeployment(deploymentName: string): pulumi.Output<object> {
        return pulumi.all([
            this.secret.metadata.name,
            this.getApiKeyEnvironmentVariables(),
        ]).apply(([secretName, envVars]) => {
            return {
                spec: {
                    template: {
                        spec: {
                            containers: [{
                                name: "n8n",
                                env: [
                                    ...envVars,
                                    { name: "N8N_API_ENABLED", value: "true" },
                                ],
                                envFrom: [{
                                    configMapRef: {
                                        name: `${this.configMap.metadata.name}-n8n-config`,
                                    },
                                }],
                            }],
                        },
                    },
                },
            };
        });
    }
}
