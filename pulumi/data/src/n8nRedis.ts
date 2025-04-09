import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

export interface N8nRedisOptions {
    namespace: pulumi.Input<string>;
    persistence?: boolean;
    storageClassName?: pulumi.Input<string>;
    storageSize?: pulumi.Input<string>;
    cpuLimit?: string;
    memoryLimit?: string;
    cpuRequest?: string;
    memoryRequest?: string;
    maxMemoryPolicy?: string;
    password?: pulumi.Input<string>;
    redisConfig?: { [key: string]: string };
    backupEnabled?: boolean;
}

export class N8nRedis extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly pvc?: k8s.core.v1.PersistentVolumeClaim;
    public readonly secret: k8s.core.v1.Secret;
    public readonly connectionString: pulumi.Output<string>;

    constructor(
        name: string,
        options: N8nRedisOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:redis:N8nRedis", name, {}, opts);

        // Extract and set default options
        const {
            namespace,
            persistence = true,
            storageClassName = "longhorn",
            storageSize = "1Gi",
            cpuLimit = "500m",
            memoryLimit = "512Mi",
            cpuRequest = "100m",
            memoryRequest = "256Mi",
            maxMemoryPolicy = "allkeys-lru",
            password,
            redisConfig = {},
            backupEnabled = true,
        } = options;

        // Generate a password if not provided
        const redisPassword = password ?? new random.RandomPassword(`${name}-password`, {
            length: 20,
            special: false,
        }).result;

        // Create a Kubernetes secret for Redis credentials
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-credentials`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "cache",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            type: "Opaque",
            stringData: {
                REDIS_PASSWORD: redisPassword,
            },
        }, { parent: this });

        // Create ConfigMap for Redis configuration
        const defaultRedisConfig = {
            "maxmemory-policy": maxMemoryPolicy,
            "maxmemory": "80%",
            "tcp-keepalive": "60",
            "timeout": "300",
            "databases": "16",
            "appendonly": persistence ? "yes" : "no",
            "appendfsync": "everysec",
            "save": persistence ? "900 1 300 10 60 10000" : "",
            ...redisConfig,
        };

        // Convert configuration to Redis format
        const redisConfContent = Object.entries(defaultRedisConfig)
            .map(([key, value]) => value ? `${key} ${value}` : `#${key}`)
            .join("\n");

        const configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: `${name}-config`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "cache",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            data: {
                "redis.conf": redisConfContent,
            },
        }, { parent: this });

        // Create PersistentVolumeClaim for Redis data if persistence is enabled
        if (persistence) {
            this.pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
                metadata: {
                    name: `${name}-data`,
                    namespace: namespace,
                    labels: {
                        "app.kubernetes.io/name": name,
                        "app.kubernetes.io/component": "cache",
                        "app.kubernetes.io/managed-by": "pulumi",
                    },
                    annotations: backupEnabled ? {
                        "backup.velero.io/backup-volumes": "data",
                    } : {},
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
        }

        // Deploy Redis
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "cache",
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
                    type: "Recreate",
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": name,
                            "app.kubernetes.io/component": "cache",
                        },
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 999,
                            runAsUser: 999,
                            runAsNonRoot: true,
                        },
                        containers: [{
                            name: "redis",
                            image: "redis:7-alpine",
                            command: ["redis-server", "/etc/redis/redis.conf", "--requirepass", "$(REDIS_PASSWORD)"],
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
                            env: [{
                                name: "REDIS_PASSWORD",
                                valueFrom: {
                                    secretKeyRef: {
                                        name: this.secret.metadata.name,
                                        key: "REDIS_PASSWORD",
                                    },
                                },
                            }],
                            ports: [{
                                containerPort: 6379,
                                name: "redis",
                            }],
                            volumeMounts: [
                                {
                                    name: "config",
                                    mountPath: "/etc/redis",
                                    readOnly: true,
                                },
                                ...(persistence ? [{
                                    name: "data",
                                    mountPath: "/data",
                                }] : []),
                            ],
                            livenessProbe: {
                                exec: {
                                    command: [
                                        "sh",
                                        "-c",
                                        "redis-cli -a $REDIS_PASSWORD ping | grep PONG"
                                    ],
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 10,
                                timeoutSeconds: 5,
                                failureThreshold: 3,
                            },
                            readinessProbe: {
                                exec: {
                                    command: [
                                        "sh",
                                        "-c",
                                        "redis-cli -a $REDIS_PASSWORD ping | grep PONG"
                                    ],
                                },
                                initialDelaySeconds: 5,
                                periodSeconds: 5,
                                timeoutSeconds: 2,
                                failureThreshold: 1,
                            },
                        }],
                        volumes: [
                            {
                                name: "config",
                                configMap: {
                                    name: configMap.metadata.name,
                                },
                            },
                            ...(persistence ? [{
                                name: "data",
                                persistentVolumeClaim: {
                                    claimName: this.pvc!.metadata.name,
                                },
                            }] : []),
                        ],
                    },
                },
            },
        }, { parent: this });

        // Create a service for Redis
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "cache",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": name,
                },
                ports: [{
                    port: 6379,
                    targetPort: 6379,
                    name: "redis",
                }],
                type: "ClusterIP",
            },
        }, { parent: this });

        // Create the connection string output
        this.connectionString = pulumi.all([
            namespace,
            this.service.metadata.name,
            redisPassword,
        ]).apply(([ns, serviceName, pass]) =>
            `redis://:${pass}@${serviceName}.${ns}.svc.cluster.local:6379/0`
        );

        this.registerOutputs({
            deploymentName: this.deployment.metadata.name,
            serviceName: this.service.metadata.name,
            ...(persistence ? { pvcName: this.pvc!.metadata.name } : {}),
            secretName: this.secret.metadata.name,
            connectionString: this.connectionString,
        });
    }
}
