import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { OpenEBSArgs, OpenEBSResourceSettings } from "./openEBSTypes";

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
     * The OpenEBS release
     */
    public readonly release: k8s.helm.v3.Release;

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

        // Deploy OpenEBS using Helm
        this.release = new k8s.helm.v3.Release(`${prefix}${name}`, {
            chart: "openebs",
            version: version,
            namespace: this.namespace.metadata.name,
            repositoryOpts: {
                repo: "https://openebs.github.io/charts",
            },
            values: {
                // Global settings
                analytics: {
                    enabled: false,
                },

                // Node Disk Manager (NDM) settings
                ndm: {
                    enabled: true,
                    sparse: {
                        enabled: false, // Disable sparse files for production use
                    },
                    resources: resources.ndm,
                },

                // CSI driver settings - disabled by default as we'll use LocalPV
                cstor: {
                    enabled: false,
                },

                // OpenEBS Local PV Provisioner
                localprovisioner: {
                    enabled: true,
                    resources: resources.localProvisioner,
                    basePath: localStoragePath,
                },

                // OpenEBS Provisioner
                provisioner: {
                    enabled: true,
                    resources: resources.provisioner,
                },

                // Helper components
                snapshotOperator: {
                    enabled: true, // Enable snapshot support
                    resources: {
                        limits: {
                            memory: "200Mi",
                            cpu: "100m",
                        },
                        requests: {
                            memory: "100Mi",
                            cpu: "50m",
                        },
                    },
                },

                // Default storage classes - we'll create our own optimized ones
                defaultStorageConfig: {
                    enabled: false,
                },
            },
        }, { parent: this, dependsOn: this.namespace });

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
            }, { parent: this, dependsOn: this.release });

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
            }, { parent: this, dependsOn: this.release });

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
            }, { parent: this, dependsOn: this.release });

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
            }, { parent: this, dependsOn: this.release });
        }

        this.registerOutputs({
            namespace: this.namespace,
            release: this.release,
            storageClasses: this.storageClasses,
        });
    }
}

// Default resource settings
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
