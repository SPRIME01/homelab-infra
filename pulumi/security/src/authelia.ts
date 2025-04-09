import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

export interface AutheliaOptions {
    namespace: pulumi.Input<string>;
    storageClassName?: pulumi.Input<string>;
    domain: string;
    persistentStorageSize?: pulumi.Input<string>;
    redisStorageSize?: pulumi.Input<string>;
    smtpHost?: string;
    smtpPort?: number;
    smtpSender?: string;
    smtpUsername?: string;
    smtpPassword?: pulumi.Input<string>;
    smtpTls?: boolean;
    jwtSecret?: pulumi.Input<string>;
    sessionSecret?: pulumi.Input<string>;
    storageEncryptionKey?: pulumi.Input<string>;
    adminUser?: {
        username: string;
        displayName: string;
        email: string;
        password: pulumi.Input<string>;
    };
    resourceLimits?: {
        cpu: string;
        memory: string;
    };
    resourceRequests?: {
        cpu: string;
        memory: string;
    };
    sessionDuration?: string;
    inactivityDuration?: string;
    defaultRedirectionUrl?: string;
    logLevel?: string;
    accessControl?: {
        defaultPolicy: string;
        rules: Array<{
            domain: string;
            policy: string;
            subject?: string[];
            resources?: string[];
        }>;
    };
}

export class Authelia extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly configMap: k8s.core.v1.ConfigMap;
    public readonly secret: k8s.core.v1.Secret;
    public readonly middleware: k8s.apiextensions.CustomResource;
    public readonly ingress: k8s.networking.v1.Ingress;
    public readonly persistentVolumeClaim: k8s.core.v1.PersistentVolumeClaim;
    public readonly redisPersistentVolumeClaim: k8s.core.v1.PersistentVolumeClaim;
    public readonly redisDeployment: k8s.apps.v1.Deployment;
    public readonly redisService: k8s.core.v1.Service;

    constructor(name: string, opts: AutheliaOptions, resourceOpts?: pulumi.ComponentResourceOptions) {
        super("homelab:security:Authelia", name, {}, resourceOpts);

        const namespace = opts.namespace;
        const storageClassName = opts.storageClassName || "longhorn";
        const persistentStorageSize = opts.persistentStorageSize || "1Gi";
        const redisStorageSize = opts.redisStorageSize || "1Gi";
        const domain = opts.domain;
        const defaultRedirectionUrl = opts.defaultRedirectionUrl || `https://auth.${domain}`;
        const logLevel = opts.logLevel || "info";
        const sessionDuration = opts.sessionDuration || "12h";
        const inactivityDuration = opts.inactivityDuration || "45m";

        // Generate secrets if not provided
        const jwtSecret = opts.jwtSecret || new random.RandomPassword(`${name}-jwt-secret`, {
            length: 32,
            special: true,
        }).result;

        const sessionSecret = opts.sessionSecret || new random.RandomPassword(`${name}-session-secret`, {
            length: 64,
            special: true,
        }).result;

        const storageEncryptionKey = opts.storageEncryptionKey || new random.RandomPassword(`${name}-storage-encryption-key`, {
            length: 64,
            special: true,
        }).result;

        // Create PersistentVolumeClaim for Authelia data
        this.persistentVolumeClaim = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: {
                name: `${name}-data`,
                namespace: namespace,
                labels: {
                    app: name,
                    component: "data",
                },
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                storageClassName: storageClassName,
                resources: {
                    requests: {
                        storage: persistentStorageSize,
                    },
                },
            },
        }, { parent: this });

        // Create PersistentVolumeClaim for Redis data
        this.redisPersistentVolumeClaim = new k8s.core.v1.PersistentVolumeClaim(`${name}-redis-pvc`, {
            metadata: {
                name: `${name}-redis-data`,
                namespace: namespace,
                labels: {
                    app: name,
                    component: "redis",
                },
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                storageClassName: storageClassName,
                resources: {
                    requests: {
                        storage: redisStorageSize,
                    },
                },
            },
        }, { parent: this });

        // Deploy Redis for Authelia
        this.redisDeployment = new k8s.apps.v1.Deployment(`${name}-redis`, {
            metadata: {
                name: `${name}-redis`,
                namespace: namespace,
                labels: {
                    app: name,
                    component: "redis",
                },
            },
            spec: {
                selector: {
                    matchLabels: {
                        app: name,
                        component: "redis",
                    },
                },
                replicas: 1,
                template: {
                    metadata: {
                        labels: {
                            app: name,
                            component: "redis",
                        },
                    },
                    spec: {
                        containers: [
                            {
                                name: "redis",
                                image: "redis:7-alpine",
                                resources: {
                                    limits: {
                                        cpu: "200m",
                                        memory: "256Mi",
                                    },
                                    requests: {
                                        cpu: "100m",
                                        memory: "128Mi",
                                    },
                                },
                                ports: [
                                    {
                                        containerPort: 6379,
                                        name: "redis",
                                    },
                                ],
                                volumeMounts: [
                                    {
                                        name: "redis-data",
                                        mountPath: "/data",
                                    },
                                ],
                                args: ["--appendonly", "yes"],
                                livenessProbe: {
                                    tcpSocket: {
                                        port: 6379,
                                    },
                                    initialDelaySeconds: 10,
                                    periodSeconds: 10,
                                },
                                readinessProbe: {
                                    tcpSocket: {
                                        port: 6379,
                                    },
                                    initialDelaySeconds: 5,
                                    periodSeconds: 5,
                                },
                            },
                        ],
                        volumes: [
                            {
                                name: "redis-data",
                                persistentVolumeClaim: {
                                    claimName: this.redisPersistentVolumeClaim.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        this.redisService = new k8s.core.v1.Service(`${name}-redis-svc`, {
            metadata: {
                name: `${name}-redis`,
                namespace: namespace,
                labels: {
                    app: name,
                    component: "redis",
                },
            },
            spec: {
                selector: {
                    app: name,
                    component: "redis",
                },
                ports: [
                    {
                        port: 6379,
                        targetPort: 6379,
                        name: "redis",
                    },
                ],
            },
        }, { parent: this });

        // Create Authelia configuration
        const autheliaConfig = {
            theme: "light",
            default_redirection_url: defaultRedirectionUrl,
            server: {
                host: "0.0.0.0",
                port: 9091,
                path: "",
                disable_healthcheck: false,
                tls: {
                    key: "",
                    certificate: "",
                },
                headers: {
                    csp: "frame-ancestors 'self'",
                },
                log_level: logLevel,
            },
            log: {
                level: logLevel,
                format: "text",
                file_path: "",
            },
            telemetry: {
                metrics: {
                    enabled: true,
                    address: "tcp://0.0.0.0:9959",
                },
            },
            totp: {
                issuer: `Homelab - ${domain}`,
                algorithm: "sha1",
                digits: 6,
                period: 30,
                skew: 1,
            },
            authentication_backend: {
                disable_reset_password: false,
                refresh_interval: "5m",
                file: {
                    path: "/config/users_database.yml",
                    password: {
                        algorithm: "argon2id",
                        iterations: 1,
                        key_length: 32,
                        salt_length: 16,
                        memory: 64,
                        parallelism: 4,
                    },
                },
            },
            password_policy: {
                standard: {
                    min_length: 8,
                    max_length: 64,
                    require_uppercase: true,
                    require_lowercase: true,
                    require_number: true,
                    require_special: true,
                },
            },
            session: {
                name: "authelia_session",
                domain: domain,
                same_site: "lax",
                secret: "__SESSION_SECRET__", // Replaced in secret, not ConfigMap
                expiration: sessionDuration,
                inactivity: inactivityDuration,
                remember_me_duration: "1M",
                redis: {
                    host: `${name}-redis.${namespace}.svc.cluster.local`,
                    port: 6379,
                    timeout: 5,
                    maximum_active_connections: 10,
                    minimum_idle_connections: 0,
                },
            },
            regulation: {
                max_retries: 3,
                find_time: "2m",
                ban_time: "5m",
            },
            storage: {
                encryption_key: "__STORAGE_ENCRYPTION_KEY__", // Replaced in secret, not ConfigMap
                local: {
                    path: "/config/db.sqlite3",
                },
            },
            notifier: {
                disable_startup_check: false,
                filesystem: {
                    filename: "/config/notification.txt",
                },
            },
            identity_providers: {
                oidc: {
                    hmac_secret: "__JWT_SECRET__", // Replaced in secret, not ConfigMap
                    enable_client_debug_messages: false,
                    cors: {
                        endpoints: ["authorization", "token", "revocation", "introspection"],
                        allowed_origins: ["*"],
                        allowed_origins_from_client_redirect_uris: true,
                    },
                },
            },
        };

        // Add SMTP configuration if provided
        if (opts.smtpHost) {
            autheliaConfig.notifier = {
                ...autheliaConfig.notifier,
                smtp: {
                    host: opts.smtpHost,
                    port: opts.smtpPort || 587,
                    username: opts.smtpUsername || "",
                    password: "__SMTP_PASSWORD__", // Replaced in secret, not ConfigMap
                    sender: opts.smtpSender || `auth@${domain}`,
                    subject: "[Authelia] {title}",
                    startup_check_address: opts.smtpSender || `auth@${domain}`,
                    disable_require_tls: !opts.smtpTls,
                    disable_html_emails: false,
                    tls: {
                        skip_verify: false,
                    },
                },
            };
        }

        // Create users database
        const usersDatabase: any = {};
        if (opts.adminUser) {
            usersDatabase[opts.adminUser.username] = {
                displayname: opts.adminUser.displayName,
                password: "__ADMIN_PASSWORD__", // Replaced by Authelia on startup
                email: opts.adminUser.email,
                groups: ["admins"],
            };
        }

        // Create ConfigMap for Authelia configuration
        this.configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: `${name}-config`,
                namespace: namespace,
                labels: {
                    app: name,
                },
            },
            data: {
                "configuration.yml": yaml.dump(autheliaConfig),
                "users_database.yml": yaml.dump(usersDatabase),
            },
        }, { parent: this });

        // Create Secret for sensitive data
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-secret`,
                namespace: namespace,
                labels: {
                    app: name,
                },
            },
            type: "Opaque",
            stringData: {
                JWT_SECRET: jwtSecret,
                SESSION_SECRET: sessionSecret,
                STORAGE_ENCRYPTION_KEY: storageEncryptionKey,
                ...(opts.smtpPassword ? { SMTP_PASSWORD: opts.smtpPassword } : {}),
                ...(opts.adminUser?.password ? { ADMIN_PASSWORD: opts.adminUser.password } : {}),
            },
        }, { parent: this });

        // Create Deployment for Authelia
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    app: name,
                },
            },
            spec: {
                selector: {
                    matchLabels: {
                        app: name,
                    },
                },
                replicas: 1,
                template: {
                    metadata: {
                        labels: {
                            app: name,
                        },
                    },
                    spec: {
                        containers: [
                            {
                                name: "authelia",
                                image: "authelia/authelia:latest",
                                args: ["--config", "/config/configuration.yml"],
                                ports: [
                                    {
                                        containerPort: 9091,
                                        name: "http",
                                    },
                                    {
                                        containerPort: 9959,
                                        name: "metrics",
                                    },
                                ],
                                resources: {
                                    limits: opts.resourceLimits || {
                                        cpu: "500m",
                                        memory: "512Mi",
                                    },
                                    requests: opts.resourceRequests || {
                                        cpu: "100m",
                                        memory: "128Mi",
                                    },
                                },
                                env: [
                                    {
                                        name: "JWT_SECRET",
                                        valueFrom: {
                                            secretKeyRef: {
                                                name: this.secret.metadata.name,
                                                key: "JWT_SECRET",
                                            },
                                        },
                                    },
                                    {
                                        name: "SESSION_SECRET",
                                        valueFrom: {
                                            secretKeyRef: {
                                                name: this.secret.metadata.name,
                                                key: "SESSION_SECRET",
                                            },
                                        },
                                    },
                                    {
                                        name: "STORAGE_ENCRYPTION_KEY",
                                        valueFrom: {
                                            secretKeyRef: {
                                                name: this.secret.metadata.name,
                                                key: "STORAGE_ENCRYPTION_KEY",
                                            },
                                        },
                                    },
                                    ...(opts.smtpPassword ? [
                                        {
                                            name: "SMTP_PASSWORD",
                                            valueFrom: {
                                                secretKeyRef: {
                                                    name: this.secret.metadata.name,
                                                    key: "SMTP_PASSWORD",
                                                },
                                            },
                                        },
                                    ] : []),
                                    ...(opts.adminUser?.password ? [
                                        {
                                            name: "ADMIN_PASSWORD",
                                            valueFrom: {
                                                secretKeyRef: {
                                                    name: this.secret.metadata.name,
                                                    key: "ADMIN_PASSWORD",
                                                },
                                            },
                                        },
                                    ] : []),
                                ],
                                volumeMounts: [
                                    {
                                        name: "config",
                                        mountPath: "/config",
                                        readOnly: false,
                                    },
                                    {
                                        name: "data",
                                        mountPath: "/data",
                                    },
                                ],
                                livenessProbe: {
                                    httpGet: {
                                        path: "/api/health",
                                        port: 9091,
                                    },
                                    initialDelaySeconds: 30,
                                    periodSeconds: 10,
                                    timeoutSeconds: 5,
                                },
                                readinessProbe: {
                                    httpGet: {
                                        path: "/api/health",
                                        port: 9091,
                                    },
                                    initialDelaySeconds: 10,
                                    periodSeconds: 5,
                                    timeoutSeconds: 3,
                                },
                            },
                        ],
                        volumes: [
                            {
                                name: "config",
                                configMap: {
                                    name: this.configMap.metadata.name,
                                },
                            },
                            {
                                name: "data",
                                persistentVolumeClaim: {
                                    claimName: this.persistentVolumeClaim.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        // Create Service for Authelia
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    app: name,
                },
            },
            spec: {
                selector: {
                    app: name,
                },
                ports: [
                    {
                        port: 9091,
                        targetPort: 9091,
                        name: "http",
                    },
                    {
                        port: 9959,
                        targetPort: 9959,
                        name: "metrics",
                    },
                ],
            },
        }, { parent: this });

        // Create Traefik middleware for Authelia
        this.middleware = new k8s.apiextensions.CustomResource(`${name}-middleware`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${name}-auth`,
                namespace: namespace,
                labels: {
                    app: name,
                },
            },
            spec: {
                forwardAuth: {
                    address: `http://${name}.${namespace}.svc.cluster.local:9091/api/verify?rd=https://auth.${domain}`,
                    trustForwardHeader: true,
                    authResponseHeaders: [
                        "Remote-User",
                        "Remote-Name",
                        "Remote-Email",
                        "Remote-Groups",
                    ],
                },
            },
        }, { parent: this });

        // Create Ingress for Authelia
        this.ingress = new k8s.networking.v1.Ingress(`${name}-ingress`, {
            metadata: {
                name: `${name}-ingress`,
                namespace: namespace,
                labels: {
                    app: name,
                },
                annotations: {
                    "kubernetes.io/ingress.class": "traefik",
                    "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
                    "traefik.ingress.kubernetes.io/router.tls": "true",
                },
            },
            spec: {
                rules: [
                    {
                        host: `auth.${domain}`,
                        http: {
                            paths: [
                                {
                                    path: "/",
                                    pathType: "Prefix",
                                    backend: {
                                        service: {
                                            name: this.service.metadata.name,
                                            port: {
                                                number: 9091,
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
                tls: [
                    {
                        hosts: [`auth.${domain}`],
                        secretName: `auth-${domain.replace(/\./g, "-")}-tls`,
                    },
                ],
            },
        }, { parent: this });

        // Create ConfigMap for access control rules if provided
        if (opts.accessControl) {
            const accessControlConfigMap = new k8s.core.v1.ConfigMap(`${name}-access-control`, {
                metadata: {
                    name: `${name}-access-control`,
                    namespace: namespace,
                    labels: {
                        app: name,
                        component: "access-control",
                    },
                },
                data: {
                    "access-control.yml": yaml.dump({
                        access_control: {
                            default_policy: opts.accessControl.defaultPolicy,
                            rules: opts.accessControl.rules,
                        },
                    }),
                },
            }, { parent: this });
        }

        // Register outputs
        this.registerOutputs({
            deploymentName: this.deployment.metadata.name,
            serviceName: this.service.metadata.name,
            configMapName: this.configMap.metadata.name,
            secretName: this.secret.metadata.name,
            middlewareName: this.middleware.metadata.name,
            ingressName: this.ingress.metadata.name,
            persistentVolumeClaimName: this.persistentVolumeClaim.metadata.name,
        });
    }

    // Helper method to get the middleware name with namespace
    public getMiddlewareName(): pulumi.Output<string> {
        return pulumi.interpolate`${this.middleware.metadata.namespace}-${this.middleware.metadata.name}@kubernetescrd`;
    }

    // Helper method to get middleware annotations for other ingress resources
    public getIngressMiddlewareAnnotation(): pulumi.Output<string> {
        return pulumi.interpolate`${this.middleware.metadata.namespace}-${this.middleware.metadata.name}@kubernetescrd`;
    }
}
