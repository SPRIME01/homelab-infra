import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface LokiArgs {
    /**
     * Namespace where Loki will be deployed
     */
    namespace: string;

    /**
     * Storage configuration
     */
    storage?: {
        size: string;
        storageClass?: string;
        retentionDays?: number;
    };

    /**
     * Resource limits
     */
    resources?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };

    /**
     * Ingestion configuration
     */
    ingestion?: {
        chunkSize?: string;
        maxChunkAge?: string;
        targetChunkSize?: string;
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class Loki extends pulumi.ComponentResource {
    /**
     * The StatefulSet running Loki
     */
    public readonly statefulSet: k8s.apps.v1.StatefulSet;

    /**
     * The Service exposing Loki
     */
    public readonly service: k8s.core.v1.Service;

    /**
     * ConfigMap containing Loki configuration
     */
    public readonly configMap: k8s.core.v1.ConfigMap;

    constructor(name: string, args: LokiArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:observability:Loki", name, args, opts);

        const prefix = args.namePrefix || "";

        // Default resource configuration for homelab scale
        const defaultResources = {
            requests: {
                cpu: "100m",
                memory: "256Mi"
            },
            limits: {
                cpu: "1",
                memory: "1Gi"
            }
        };

        const resources = args.resources || defaultResources;

        // Create ConfigMap with Loki configuration
        this.configMap = new k8s.core.v1.ConfigMap(`${prefix}loki-config`, {
            metadata: {
                name: `${prefix}loki-config`,
                namespace: args.namespace
            },
            data: {
                "loki.yaml": `
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9095

common:
  path_prefix: /data/loki
  storage:
    filesystem:
      chunks_directory: /data/loki/chunks
      rules_directory: /data/loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

compactor:
  working_directory: /data/loki/compactor
  retention_enabled: true
  retention_delete_delay: ${args.storage?.retentionDays || 14}d
  shared_store: filesystem

ingester:
  chunk_idle_period: ${args.ingestion?.maxChunkAge || "1h"}
  chunk_target_size: ${args.ingestion?.targetChunkSize || "1MB"}
  max_chunk_age: ${args.ingestion?.maxChunkAge || "1h"}
  lifecycler:
    ring:
      replication_factor: 1

schema_config:
  configs:
    - from: "2023-01-01"
      store: boltdb-shipper
      object_store: filesystem
      schema: v12
      index:
        prefix: index_
        period: 24h

analytics:
  reporting_enabled: false

limits_config:
  retention_period: ${args.storage?.retentionDays || 14}d
  max_global_streams_per_user: 10000
  ingestion_rate_mb: 8
  ingestion_burst_size_mb: 16

table_manager:
  retention_deletes_enabled: true
  retention_period: ${args.storage?.retentionDays || 14}d`
            }
        }, { provider, parent: this });

        // Create PVC for Loki storage
        const storage = new k8s.core.v1.PersistentVolumeClaim(`${prefix}loki-storage`, {
            metadata: {
                name: `${prefix}loki-storage`,
                namespace: args.namespace
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                    requests: {
                        storage: args.storage?.size || "10Gi"
                    }
                },
                storageClassName: args.storage?.storageClass
            }
        }, { provider, parent: this });

        // Create StatefulSet
        this.statefulSet = new k8s.apps.v1.StatefulSet(`${prefix}loki`, {
            metadata: {
                name: `${prefix}loki`,
                namespace: args.namespace,
                labels: {
                    app: "loki"
                }
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        app: "loki"
                    }
                },
                serviceName: `${prefix}loki`,
                template: {
                    metadata: {
                        labels: {
                            app: "loki"
                        },
                        annotations: {
                            "prometheus.io/scrape": "true",
                            "prometheus.io/port": "3100"
                        }
                    },
                    spec: {
                        containers: [{
                            name: "loki",
                            image: "grafana/loki:2.9.0",
                            ports: [
                                { containerPort: 3100, name: "http" },
                                { containerPort: 9095, name: "grpc" }
                            ],
                            args: [
                                "-config.file=/etc/loki/loki.yaml"
                            ],
                            volumeMounts: [
                                {
                                    name: "config",
                                    mountPath: "/etc/loki"
                                },
                                {
                                    name: "storage",
                                    mountPath: "/data"
                                }
                            ],
                            resources: resources,
                            readinessProbe: {
                                httpGet: {
                                    path: "/ready",
                                    port: 3100
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 10
                            },
                            livenessProbe: {
                                httpGet: {
                                    path: "/ready",
                                    port: 3100
                                },
                                initialDelaySeconds: 300,
                                periodSeconds: 30
                            }
                        }],
                        volumes: [
                            {
                                name: "config",
                                configMap: {
                                    name: this.configMap.metadata.name
                                }
                            }
                        ]
                    }
                },
                volumeClaimTemplates: [{
                    metadata: {
                        name: "storage"
                    },
                    spec: storage.spec
                }]
            }
        }, { provider, parent: this });

        // Create Service
        this.service = new k8s.core.v1.Service(`${prefix}loki`, {
            metadata: {
                name: `${prefix}loki`,
                namespace: args.namespace,
                labels: {
                    app: "loki"
                },
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "3100"
                }
            },
            spec: {
                ports: [
                    { port: 3100, name: "http", targetPort: 3100 },
                    { port: 9095, name: "grpc", targetPort: 9095 }
                ],
                selector: {
                    app: "loki"
                }
            }
        }, { provider, parent: this });

        this.registerOutputs({
            statefulSet: this.statefulSet,
            service: this.service,
            configMap: this.configMap
        });
    }
}

/** example usage
const loki = new Loki("logging", {
    namespace: "monitoring",
    storage: {
        size: "20Gi",
        storageClass: "local-path",
        retentionDays: 14
    },
    ingestion: {
        chunkSize: "512KB",
        maxChunkAge: "1h",
        targetChunkSize: "1MB"
    }
});
*/
