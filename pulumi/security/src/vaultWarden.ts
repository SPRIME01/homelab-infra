import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

export interface VaultWardenOptions {
    namespace: pulumi.Input<string>;
    domain: string;
    storageClassName?: pulumi.Input<string>;
    storageSize?: pulumi.Input<string>;
    smtp?: {
        host: string;
        port: number;
        username: string;
        password: pulumi.Input<string>;
        from: string;
    };
    resources?: {
        limits?: {
            cpu: string;
            memory: string;
        };
        requests?: {
            cpu: string;
            memory: string;
        };
    };
    backupConfig?: {
        enabled: boolean;
        schedule: string;
        retention: number;
        backupPath: string;
    };
    adminToken?: pulumi.Input<string>;
}

export class VaultWarden extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly persistentVolumeClaim: k8s.core.v1.PersistentVolumeClaim;
    public readonly secret: k8s.core.v1.Secret;
    public readonly ingress: k8s.networking.v1.Ingress;
    public readonly configMap: k8s.core.v1.ConfigMap;
    public readonly backupCronJob?: k8s.batch.v1.CronJob;

    constructor(
        name: string,
        options: VaultWardenOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:VaultWarden", name, {}, opts);

        const {
            namespace,
            domain,
            storageClassName = "longhorn",
            storageSize = "10Gi",
            resources = {
                limits: {
                    cpu: "1",
                    memory: "1Gi",
                },
                requests: {
                    cpu: "100m",
                    memory: "256Mi",
                },
            },
        } = options;

        // Generate admin token if not provided
        const adminToken = options.adminToken ?? new random.RandomPassword(`${name}-admin-token`, {
            length: 32,
            special: true,
        }).result;

        // Create Secret for sensitive data
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-secret`,
                namespace: namespace,
            },
            stringData: {
                ADMIN_TOKEN: adminToken,
                ...(options.smtp ? {
                    SMTP_HOST: options.smtp.host,
                    SMTP_PORT: options.smtp.port.toString(),
                    SMTP_USERNAME: options.smtp.username,
                    SMTP_PASSWORD: options.smtp.password,
                    SMTP_FROM: options.smtp.from,
                } : {}),
            },
        }, { parent: this });

        // Create ConfigMap for VaultWarden configuration
        this.configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: `${name}-config`,
                namespace: namespace,
            },
            data: {
                "config.json": JSON.stringify({
                    domain: `https://${domain}`,
                    signupsAllowed: false,
                    invitationsAllowed: true,
                    showPasswordHint: false,
                    passwordHintDisplayCount: 3,
                    failedLoginAttempts: 5,
                    rateLimitSeconds: 300,
                    tokenValidityHours: 12,
                    emergencyAccessAllowed: true,
                    requireDeviceEmail: true,
                    enableWebVault: true,
                    disableIconDownload: false,
                    disableFaviconDownload: true,
                    enableDatabaseCleanup: true,
                    databaseCleanupDays: 30,
                    log: {
                        level: "warn",
                        file: "/data/vaultwarden.log",
                    },
                }),
            },
        }, { parent: this });

        // Create PVC for data storage
        this.persistentVolumeClaim = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: {
                name: `${name}-data`,
                namespace: namespace,
                annotations: options.backupConfig?.enabled ? {
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

        // Create Deployment
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: name,
                namespace: namespace,
            },
            spec: {
                selector: {
                    matchLabels: {
                        app: name,
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            app: name,
                        },
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 1000,
                            runAsUser: 1000,
                            runAsNonRoot: true,
                        },
                        containers: [{
                            name: "vaultwarden",
                            image: "vaultwarden/server:latest",
                            resources: resources,
                            ports: [{
                                containerPort: 80,
                                name: "http",
                            }, {
                                containerPort: 3012,
                                name: "websocket",
                            }],
                            envFrom: [{
                                secretRef: {
                                    name: this.secret.metadata.name,
                                },
                            }],
                            env: [{
                                name: "DOMAIN",
                                value: `https://${domain}`,
                            }, {
                                name: "WEBSOCKET_ENABLED",
                                value: "true",
                            }, {
                                name: "LOG_FILE",
                                value: "/data/vaultwarden.log",
                            }, {
                                name: "SMTP_SSL",
                                value: "true",
                            }],
                            volumeMounts: [{
                                name: "data",
                                mountPath: "/data",
                            }, {
                                name: "config",
                                mountPath: "/etc/vaultwarden",
                                readOnly: true,
                            }],
                            livenessProbe: {
                                httpGet: {
                                    path: "/alive",
                                    port: "http",
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 10,
                            },
                            readinessProbe: {
                                httpGet: {
                                    path: "/alive",
                                    port: "http",
                                },
                                initialDelaySeconds: 5,
                                periodSeconds: 5,
                            },
                        }],
                        volumes: [{
                            name: "data",
                            persistentVolumeClaim: {
                                claimName: this.persistentVolumeClaim.metadata.name,
                            },
                        }, {
                            name: "config",
                            configMap: {
                                name: this.configMap.metadata.name,
                            },
                        }],
                    },
                },
            },
        }, { parent: this });

        // Create Service
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                name: name,
                namespace: namespace,
            },
            spec: {
                selector: {
                    app: name,
                },
                ports: [{
                    port: 80,
                    targetPort: "http",
                    name: "http",
                }, {
                    port: 3012,
                    targetPort: "websocket",
                    name: "websocket",
                }],
            },
        }, { parent: this });

        // Create Ingress
        this.ingress = new k8s.networking.v1.Ingress(`${name}-ingress`, {
            metadata: {
                name: name,
                namespace: namespace,
                annotations: {
                    "kubernetes.io/ingress.class": "traefik",
                    "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
                    "traefik.ingress.kubernetes.io/router.middlewares":
                        `${namespace}-authelia@kubernetescrd`,
                },
            },
            spec: {
                rules: [{
                    host: domain,
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
                        }, {
                            path: "/notifications/hub",
                            pathType: "Prefix",
                            backend: {
                                service: {
                                    name: this.service.metadata.name,
                                    port: {
                                        name: "websocket",
                                    },
                                },
                            },
                        }],
                    },
                }],
                tls: [{
                    hosts: [domain],
                    secretName: `${name}-tls`,
                }],
            },
        }, { parent: this });

        // Create backup CronJob if enabled
        if (options.backupConfig?.enabled) {
            this.backupCronJob = new k8s.batch.v1.CronJob(`${name}-backup`, {
                metadata: {
                    name: `${name}-backup`,
                    namespace: namespace,
                },
                spec: {
                    schedule: options.backupConfig.schedule,
                    successfulJobsHistoryLimit: 3,
                    failedJobsHistoryLimit: 1,
                    jobTemplate: {
                        spec: {
                            template: {
                                spec: {
                                    containers: [{
                                        name: "backup",
                                        image: "alpine:latest",
                                        command: ["/bin/sh", "-c"],
                                        args: [`
                                            apk add --no-cache tar gzip
                                            cd /data
                                            tar czf /backup/vaultwarden-backup-$(date +%Y%m%d-%H%M%S).tar.gz .
                                            find /backup -type f -mtime +${options.backupConfig.retention} -delete
                                        `],
                                        volumeMounts: [{
                                            name: "data",
                                            mountPath: "/data",
                                            readOnly: true,
                                        }, {
                                            name: "backup",
                                            mountPath: "/backup",
                                        }],
                                    }],
                                    volumes: [{
                                        name: "data",
                                        persistentVolumeClaim: {
                                            claimName: this.persistentVolumeClaim.metadata.name,
                                        },
                                    }, {
                                        name: "backup",
                                        persistentVolumeClaim: {
                                            claimName: `${name}-backup-data`,
                                        },
                                    }],
                                    restartPolicy: "OnFailure",
                                },
                            },
                        },
                    },
                },
            }, { parent: this });
        }

        // Register outputs
        this.registerOutputs({
            url: `https://${domain}`,
            serviceName: this.service.metadata.name,
            deploymentName: this.deployment.metadata.name,
            secretName: this.secret.metadata.name,
        });
    }
}
