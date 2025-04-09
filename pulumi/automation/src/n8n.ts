import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface N8nOptions {
    namespace: pulumi.Input<string>;
    hostName: string;
    storageClassName?: pulumi.Input<string>;
    storageSize?: pulumi.Input<string>;
    postgresConnectionString: pulumi.Input<string>;
    redisConnectionString?: pulumi.Input<string>;
    cpuLimit?: string;
    memoryLimit?: string;
    cpuRequest?: string;
    memoryRequest?: string;
    autheliaEnabled?: boolean;
    autheliaNamespace?: pulumi.Input<string>;
    tlsSecretName?: string;
    n8nVersion?: string;
    encryptionKey?: pulumi.Input<string>;
    webhookUrl?: string;
    extraEnv?: Record<string, pulumi.Input<string>>;
}

export class N8n extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly ingress: k8s.networking.v1.Ingress;
    public readonly pvc: k8s.core.v1.PersistentVolumeClaim;
    public readonly secret: k8s.core.v1.Secret;
    public readonly url: pulumi.Output<string>;

    constructor(
        name: string,
        options: N8nOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:automation:N8n", name, {}, opts);

        // Extract and set default options
        const {
            namespace,
            hostName,
            storageClassName = "longhorn",
            storageSize = "5Gi",
            postgresConnectionString,
            redisConnectionString,
            cpuLimit = "1",
            memoryLimit = "2Gi",
            cpuRequest = "200m",
            memoryRequest = "512Mi",
            autheliaEnabled = true,
            autheliaNamespace = "authentication",
            tlsSecretName,
            n8nVersion = "1.11",
            encryptionKey,
            webhookUrl,
            extraEnv = {},
        } = options;

        // Generate a random encryption key if not provided
        const encKey = encryptionKey ?? new pulumi.random.RandomPassword(`${name}-key`, {
            length: 32,
            special: false,
        }).result;

        // Create a Kubernetes secret for n8n configuration
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-config`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/part-of": "n8n",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            type: "Opaque",
            stringData: {
                "ENCRYPTION_KEY": encKey,
                "DB_TYPE": "postgresdb",
                "DB_POSTGRESDB_DATABASE": pulumi.interpolate`${postgresConnectionString}`.apply(cs => {
                    const match = cs.match(/\/([^/]+)$/);
                    return match ? match[1] : "n8n";
                }),
                "DB_POSTGRESDB_HOST": pulumi.interpolate`${postgresConnectionString}`.apply(cs => {
                    const match = cs.match(/@([^:]+):/);
                    return match ? match[1] : "postgres";
                }),
                "DB_POSTGRESDB_PORT": "5432",
                "DB_POSTGRESDB_USER": pulumi.interpolate`${postgresConnectionString}`.apply(cs => {
                    const match = cs.match(/^[^:]+:\/\/([^:]+):/);
                    return match ? match[1] : "n8n";
                }),
                "DB_POSTGRESDB_PASSWORD": pulumi.interpolate`${postgresConnectionString}`.apply(cs => {
                    const match = cs.match(/:\/\/[^:]+:([^@]+)@/);
                    return match ? match[1] : "";
                }),
                ...(redisConnectionString ? {
                    "QUEUE_BULL_REDIS_HOST": pulumi.interpolate`${redisConnectionString}`.apply(cs => {
                        const match = cs.match(/@([^:]+):/);
                        return match ? match[1] : "redis";
                    }),
                    "QUEUE_BULL_REDIS_PORT": "6379",
                    "QUEUE_BULL_REDIS_PASSWORD": pulumi.interpolate`${redisConnectionString}`.apply(cs => {
                        const match = cs.match(/:\/\/:(.*?)@/);
                        return match ? match[1] : "";
                    }),
                    "QUEUE_BULL_REDIS_DB": "0",
                    "CACHE_REDIS_HOST": pulumi.interpolate`${redisConnectionString}`.apply(cs => {
                        const match = cs.match(/@([^:]+):/);
                        return match ? match[1] : "redis";
                    }),
                    "CACHE_REDIS_PORT": "6379",
                    "CACHE_REDIS_PASSWORD": pulumi.interpolate`${redisConnectionString}`.apply(cs => {
                        const match = cs.match(/:\/\/:(.*?)@/);
                        return match ? match[1] : "";
                    }),
                    "CACHE_REDIS_DB": "1",
                } : {}),
                ...(webhookUrl ? {
                    "WEBHOOK_URL": webhookUrl,
                    "WEBHOOK_TUNNEL_URL": webhookUrl,
                } : {}),
                ...(Object.entries(extraEnv).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})),
            },
        }, { parent: this });

        // Create PersistentVolumeClaim for n8n data
        this.pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: {
                name: `${name}-data`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/part-of": "n8n",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
                annotations: {
                    "backup.velero.io/backup-volumes": "data",
                    "backup.velero.io/backup-strategy": "snapshot",
                },
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                storageClassName: storageClassName,
                resources: {
                    requests: {
                        storage: storageSize,
                    },
                },
            },
        }, { parent: this });

        // Deploy n8n
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/part-of": "n8n",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            spec: {
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": name,
                    },
                },
                strategy: {
                    type: "RollingUpdate",
                    rollingUpdate: {
                        maxSurge: 1,
                        maxUnavailable: 0,
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": name,
                            "app.kubernetes.io/part-of": "n8n",
                        },
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 1000,
                            runAsUser: 1000,
                            runAsNonRoot: true,
                        },
                        containers: [{
                            name: "n8n",
                            image: `n8nio/n8n:${n8nVersion}`,
                            resources: {
                                limits: {
                                    cpu: cpuLimit,
                                    memory: memoryLimit,
                                },
                                requests: {
                                    cpu: cpuRequest,
                                    memory: memoryRequest,
                                },
                            },
                            envFrom: [{
                                secretRef: {
                                    name: this.secret.metadata.name,
                                },
                            }],
                            env: [
                                {
                                    name: "N8N_HOST",
                                    value: hostName,
                                },
                                {
                                    name: "N8N_PROTOCOL",
                                    value: "https",
                                },
                                {
                                    name: "N8N_PORT",
                                    value: "5678",
                                },
                                {
                                    name: "NODE_ENV",
                                    value: "production",
                                },
                                {
                                    name: "EXECUTIONS_MODE",
                                    value: "queue",
                                },
                                {
                                    name: "QUEUE_BULL_REDIS_STALLEDINTERVAL",
                                    value: "30000",
                                },
                                {
                                    name: "GENERIC_TIMEZONE",
                                    value: "UTC",
                                },
                                {
                                    name: "N8N_LOG_LEVEL",
                                    value: "info",
                                },
                                {
                                    name: "N8N_AUTH_EXCLUDE_ENDPOINTS",
                                    value: "health,webhook",
                                },
                                {
                                    name: "N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN",
                                    value: "true",
                                },
                                {
                                    name: "DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED",
                                    value: "false",
                                },
                            ],
                            ports: [{
                                containerPort: 5678,
                                name: "http",
                            }],
                            volumeMounts: [
                                {
                                    name: "data",
                                    mountPath: "/home/node/.n8n",
                                },
                            ],
                            livenessProbe: {
                                httpGet: {
                                    path: "/metrics",
                                    port: 5678,
                                },
                                initialDelaySeconds: 60,
                                periodSeconds: 10,
                                timeoutSeconds: 5,
                                failureThreshold: 3,
                            },
                            readinessProbe: {
                                httpGet: {
                                    path: "/metrics",
                                    port: 5678,
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 5,
                                timeoutSeconds: 3,
                                failureThreshold: 1,
                            },
                            startupProbe: {
                                httpGet: {
                                    path: "/metrics",
                                    port: 5678,
                                },
                                initialDelaySeconds: 10,
                                periodSeconds: 5,
                                timeoutSeconds: 3,
                                failureThreshold: 30,
                            },
                        }],
                        volumes: [
                            {
                                name: "data",
                                persistentVolumeClaim: {
                                    claimName: this.pvc.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        // Create a service for n8n
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/part-of": "n8n",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": name,
                },
                ports: [{
                    port: 80,
                    targetPort: 5678,
                    name: "http",
                }],
                type: "ClusterIP",
            },
        }, { parent: this });

        // Create Ingress with optional TLS and Authelia configuration
        const annotations: Record<string, string> = {
            "nginx.ingress.kubernetes.io/proxy-body-size": "10m",
            "nginx.ingress.kubernetes.io/proxy-buffer-size": "128k",
        };

        if (autheliaEnabled) {
            Object.assign(annotations, {
                "nginx.ingress.kubernetes.io/auth-url": `https://auth.${pulumi.interpolate`${hostName}`.apply(h => h.split('.').slice(1).join('.'))}/${autheliaNamespace}_verify`,
                "nginx.ingress.kubernetes.io/auth-signin": `https://auth.${pulumi.interpolate`${hostName}`.apply(h => h.split('.').slice(1).join('.'))}`,
                "nginx.ingress.kubernetes.io/auth-response-headers": "Remote-User,Remote-Name,Remote-Email,Remote-Groups",
                "nginx.ingress.kubernetes.io/auth-snippet": `
                    proxy_set_header X-Forwarded-Method $request_method;
                    proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
                    proxy_set_header X-Original-Method $request_method;
                `,
            });
        }

        this.ingress = new k8s.networking.v1.Ingress(`${name}-ingress`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/part-of": "n8n",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
                annotations: annotations,
            },
            spec: {
                ingressClassName: "nginx",
                ...(tlsSecretName ? {
                    tls: [{
                        hosts: [hostName],
                        secretName: tlsSecretName,
                    }],
                } : {}),
                rules: [{
                    host: hostName,
                    http: {
                        paths: [{
                            path: "/",
                            pathType: "Prefix",
                            backend: {
                                service: {
                                    name: this.service.metadata.name,
                                    port: {
                                        name: "http",
                                    },
                                },
                            },
                        }],
                    },
                }],
            },
        }, { parent: this });

        // Set outputs
        this.url = pulumi.interpolate`https://${hostName}`;

        this.registerOutputs({
            deploymentName: this.deployment.metadata.name,
            serviceName: this.service.metadata.name,
            pvcName: this.pvc.metadata.name,
            secretName: this.secret.metadata.name,
            url: this.url,
        });
    }
}
