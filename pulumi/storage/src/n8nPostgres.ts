import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

export interface N8nPostgresOptions {
    namespace: pulumi.Input<string>;
    storageClassName?: pulumi.Input<string>;
    storageSize?: pulumi.Input<string>;
    postgresVersion?: string;
    cpuLimit?: string;
    memoryLimit?: string;
    cpuRequest?: string;
    memoryRequest?: string;
    backupEnabled?: boolean;
    dbName?: string;
    dbUser?: string;
    dbPassword?: pulumi.Input<string>;
}

export class N8nPostgres extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly pvc: k8s.core.v1.PersistentVolumeClaim;
    public readonly secret: k8s.core.v1.Secret;
    public readonly connectionString: pulumi.Output<string>;

    constructor(
        name: string,
        options: N8nPostgresOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:postgres:N8nPostgres", name, {}, opts);

        // Extract and set default options
        const {
            namespace,
            storageClassName = "longhorn",
            storageSize = "10Gi",
            postgresVersion = "14",
            cpuLimit = "1",
            memoryLimit = "1Gi",
            cpuRequest = "200m",
            memoryRequest = "512Mi",
            backupEnabled = true,
            dbName = "n8n",
            dbUser = "n8n",
            dbPassword,
        } = options;

        // Generate a password if not provided
        const password = dbPassword ?? new random.RandomPassword(`${name}-password`, {
            length: 20,
            special: false,
        }).result;

        // Create a Kubernetes secret for database credentials
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-credentials`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "database",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            type: "Opaque",
            stringData: {
                POSTGRES_USER: dbUser,
                POSTGRES_PASSWORD: password,
                POSTGRES_DB: dbName,
            },
        }, { parent: this });

        // Create PersistentVolumeClaim for postgres data
        this.pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: {
                name: `${name}-data`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "database",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
                annotations: backupEnabled ? {
                    "backup.velero.io/backup-volumes": "data",
                    "backup.velero.io/backup-strategy": "snapshot",
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

        // Create configMap for initialization scripts
        const initConfigMap = new k8s.core.v1.ConfigMap(`${name}-init-scripts`, {
            metadata: {
                name: `${name}-init-scripts`,
                namespace: namespace,
            },
            data: {
                "01-init-n8n-db.sh": `#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA IF NOT EXISTS public;
    GRANT ALL ON SCHEMA public TO "$POSTGRES_USER";
EOSQL`,
            },
        }, { parent: this });

        // Deploy PostgreSQL
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "database",
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
                    type: "Recreate", // Ensure we don't run multiple Postgres instances with the same data
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": name,
                            "app.kubernetes.io/component": "database",
                        },
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 999, // postgres group
                            runAsUser: 999, // postgres user
                            runAsNonRoot: true,
                        },
                        containers: [{
                            name: "postgres",
                            image: `postgres:${postgresVersion}-alpine`,
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
                            ports: [{
                                containerPort: 5432,
                                name: "postgres",
                            }],
                            volumeMounts: [
                                {
                                    name: "data",
                                    mountPath: "/var/lib/postgresql/data",
                                    subPath: "postgres",
                                },
                                {
                                    name: "init-scripts",
                                    mountPath: "/docker-entrypoint-initdb.d",
                                    readOnly: true,
                                },
                            ],
                            livenessProbe: {
                                exec: {
                                    command: ["pg_isready", "-U", dbUser],
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 10,
                                timeoutSeconds: 5,
                                failureThreshold: 3,
                            },
                            readinessProbe: {
                                exec: {
                                    command: ["pg_isready", "-U", dbUser],
                                },
                                initialDelaySeconds: 5,
                                periodSeconds: 5,
                                timeoutSeconds: 3,
                                failureThreshold: 1,
                            },
                        }],
                        volumes: [
                            {
                                name: "data",
                                persistentVolumeClaim: {
                                    claimName: this.pvc.metadata.name,
                                },
                            },
                            {
                                name: "init-scripts",
                                configMap: {
                                    name: initConfigMap.metadata.name,
                                    defaultMode: 0o755,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        // Create a service for the PostgreSQL instance
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "database",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": name,
                },
                ports: [{
                    port: 5432,
                    targetPort: 5432,
                    name: "postgres",
                }],
                type: "ClusterIP",
            },
        }, { parent: this });

        // Create the connection string output
        this.connectionString = pulumi.all([
            namespace,
            this.service.metadata.name,
            dbUser,
            password,
            dbName
        ]).apply(([ns, serviceName, user, pass, db]) =>
            `postgresql://${user}:${pass}@${serviceName}.${ns}.svc.cluster.local:5432/${db}`
        );

        this.registerOutputs({
            deploymentName: this.deployment.metadata.name,
            serviceName: this.service.metadata.name,
            pvcName: this.pvc.metadata.name,
            secretName: this.secret.metadata.name,
            connectionString: this.connectionString,
        });
    }
}
