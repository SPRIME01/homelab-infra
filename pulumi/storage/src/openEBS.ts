import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Input properties for the OpenEBS component
 */
export interface OpenEBSArgs {
    /**
     * The namespace to deploy OpenEBS into
     * @default "openebs"
     */
    namespace?: string;

    /**
     * The version of OpenEBS to deploy
     * @default "3.9.0"
     */
    version?: string;

    /**
     * Resource requests and limits for OpenEBS components
     * @default - see defaultResourceSettings
     */
    resources?: OpenEBSResourceSettings;

    /**
     * Whether to create custom storage classes
     * @default true
     */
    createStorageClasses?: boolean;

    /**
     * Node selectors for the storage nodes
     * If provided, LocalPV storage classes will use these node selectors
     */
    storageNodeSelectors?: Record<string, string>;

    /**
     * Base path for hostPath local volumes
     * @default "/var/openebs/local"
     */
    localStoragePath?: string;

    /**
     * Optional prefix for resources created by this component
     */
    namePrefix?: string;
}

/**
 * Resource settings for OpenEBS components
 */
export interface OpenEBSResourceSettings {
    ndm?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };
    provisioner?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };
    localProvisioner?: {
        requests?: {
            cpu?: string;
            memory?: string;
        };
        limits?: {
            cpu?: string;
            memory?: string;
        };
    };
}

/**
 * Default resource settings suitable for a homelab environment
 */
const defaultResourceSettings: OpenEBSResourceSettings = {
    ndm: {
        requests: {
            cpu: "50m",
            memory: "100Mi",
        },
        limits: {
            cpu: "100m",
            memory: "200Mi",
        },
    },
    provisioner: {
        requests: {
            cpu: "50m",
            memory: "100Mi",
        },
        limits: {
            cpu: "100m",
            memory: "200Mi",
        },
    },
    localProvisioner: {
        requests: {
            cpu: "50m",
            memory: "75Mi",
        },
        limits: {
            cpu: "100m",
            memory: "150Mi",
        },
    },
};

/**
 * OpenEBS is a component resource that deploys OpenEBS on a Kubernetes cluster
 * and configures it with different storage classes for various workload types.
 */
export class OpenEBS extends pulumi.ComponentResource {
    /**
     * The namespace where OpenEBS is deployed
     */
    public readonly namespace: k8s.core.v1.Namespace;

    /**
     * The OpenEBS operator deployment
     */
    public readonly operator: k8s.yaml.ConfigFile;

    /**
     * Custom storage classes created by this component
     */
    public readonly storageClasses: {
        general?: k8s.storage.v1.StorageClass;
        database?: k8s.storage.v1.StorageClass;
        cache?: k8s.storage.v1.StorageClass;
        backup?: k8s.storage.v1.StorageClass;
    } = {};

    constructor(name: string, args: OpenEBSArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k8s:OpenEBS", name, args, opts);

        const prefix = args.namePrefix || "";
        const namespace = args.namespace || "openebs";
        const version = args.version || "3.9.0";
        const resources = args.resources || defaultResourceSettings;
        const createStorageClasses = args.createStorageClasses !== false;
        const localStoragePath = args.localStoragePath || "/var/openebs/local";

        // Create namespace for OpenEBS
        this.namespace = new k8s.core.v1.Namespace(`${prefix}${name}-namespace`, {
            metadata: {
                name: namespace,
                labels: {
                    "homelab-managed": "true",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
        }, { parent: this });

        // Deploy OpenEBS operator
        this.operator = new k8s.yaml.ConfigFile(`${prefix}${name}-operator`, {
            file: `https://openebs.github.io/charts/openebs-operator-${version}.yaml`,
            transformations: [
                (obj: any, opts: pulumi.CustomResourceOptions) => {
                    if (obj.metadata) {
                        obj.metadata.namespace = namespace;
                    }
                    return undefined;
                }
            ],
        }, { parent: this, dependsOn: this.namespace });

        // Update resource limits for components
        if (resources.ndm) {
            new k8s.apps.v1.DaemonSet(`${prefix}${name}-ndm`, {
                metadata: {
                    name: "openebs-ndm",
                    namespace: namespace,
                },
                spec: {
                    selector: {
                        matchLabels: {
                            app: "openebs-ndm",
                        },
                    },
                    template: {
                        metadata: {
                            labels: {
                                app: "openebs-ndm",
                            },
                        },
                        spec: {
                            containers: [{
                                name: "ndm",
                                resources: resources.ndm,
                            }],
                        },
                    },
                },
            }, { parent: this, dependsOn: this.operator });
        }

        if (resources.provisioner) {
            new k8s.apps.v1.Deployment(`${prefix}${name}-provisioner`, {
                metadata: {
                    name: "openebs-provisioner",
                    namespace: namespace,
                },
                spec: {
                    selector: {
                        matchLabels: {
                            app: "openebs-provisioner",
                        },
                    },
        template: {
            metadata: {
                labels: {
                    app: "openebs-provisioner",
                },
            },
            spec: {
                containers: [{
                    name: "openebs-provisioner",
                    resources: resources.provisioner,
                }],
            },
        },
                },
            }, { parent: this, dependsOn: this.operator });
        }

        // Create custom storage classes if enabled
        if (createStorageClasses) {
            // Prepare node selector if provided
            const nodeSelector = args.storageNodeSelectors
                ? JSON.stringify(args.storageNodeSelectors)
                : undefined;

            // General purpose storage class (good for most workloads)
            this.storageClasses.general = new k8s.storage.v1.StorageClass(`${prefix}${name}-general`, {
                metadata: {
                    name: "openebs-hostpath-general",
                    annotations: {
                        "openebs.io/cas-type": "local",
                        "storageclass.kubernetes.io/is-default-class": "true",
                    },
                },
                provisioner: "openebs.io/local",
                reclaimPolicy: "Delete",
                volumeBindingMode: "WaitForFirstConsumer", // Better for single-node homelab
                allowVolumeExpansion: false, // LocalPV doesn't support expansion
                parameters: {
                    "openebs.io/cas-type": "local",
                    "openebs.io/cas-template": "local-hostpath-default",
                    "hostpath.openebs.io/basepath": `${localStoragePath}/general`,
                    ...(nodeSelector ? { "openebs.io/node-selector": nodeSelector } : {}),
                },
            }, { parent: this, dependsOn: this.operator });

            // Database-optimized storage class (for MySQL, PostgreSQL, etc.)
            this.storageClasses.database = new k8s.storage.v1.StorageClass(`${prefix}${name}-database`, {
                metadata: {
                    name: "openebs-hostpath-database",
                    annotations: {
                        "openebs.io/cas-type": "local",
                    },
                },
                provisioner: "openebs.io/local",
                reclaimPolicy: "Retain", // More conservative policy for databases
                volumeBindingMode: "WaitForFirstConsumer",
                allowVolumeExpansion: false,
                parameters: {
                    "openebs.io/cas-type": "local",
                    "openebs.io/cas-template": "local-hostpath-default",
                    "hostpath.openebs.io/basepath": `${localStoragePath}/database`,
                    ...(nodeSelector ? { "openebs.io/node-selector": nodeSelector } : {}),
                },
            }, { parent: this, dependsOn: this.operator });

            // Cache-optimized storage class (for Redis, Memcached, etc.)
            this.storageClasses.cache = new k8s.storage.v1.StorageClass(`${prefix}${name}-cache`, {
                metadata: {
                    name: "openebs-hostpath-cache",
                    annotations: {
                        "openebs.io/cas-type": "local",
                    },
                },
                provisioner: "openebs.io/local",
                reclaimPolicy: "Delete", // Cache data is typically ephemeral
                volumeBindingMode: "WaitForFirstConsumer",
                allowVolumeExpansion: false,
                parameters: {
                    "openebs.io/cas-type": "local",
                    "openebs.io/cas-template": "local-hostpath-default",
                    "hostpath.openebs.io/basepath": `${localStoragePath}/cache`,
                    ...(nodeSelector ? { "openebs.io/node-selector": nodeSelector } : {}),
                },
            }, { parent: this, dependsOn: this.operator });

            // Backup storage class (for backups, artifacts, etc.)
            this.storageClasses.backup = new k8s.storage.v1.StorageClass(`${prefix}${name}-backup`, {
                metadata: {
                    name: "openebs-hostpath-backup",
                    annotations: {
                        "openebs.io/cas-type": "local",
                    },
                },
                provisioner: "openebs.io/local",
                reclaimPolicy: "Retain", // Don't delete backup data
                volumeBindingMode: "WaitForFirstConsumer",
                allowVolumeExpansion: false,
                parameters: {
                    "openebs.io/cas-type": "local",
                    "openebs.io/cas-template": "local-hostpath-default",
                    "hostpath.openebs.io/basepath": `${localStoragePath}/backup`,
                    ...(nodeSelector ? { "openebs.io/node-selector": nodeSelector } : {}),
                },
            }, { parent: this, dependsOn: this.operator });
        }

        this.registerOutputs({
            namespace: this.namespace,
            operator: this.operator,
            storageClasses: this.storageClasses,
        });
    }
}
