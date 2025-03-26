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
     * The OpenEBS operator deployment
     */
    public readonly operatorDeployment: k8s.apps.v1.Deployment;

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
        this.operatorDeployment = new k8s.apps.v1.Deployment(`${prefix}${name}-operator`, {
            metadata: {
                name: "openebs-operator",
                namespace: namespace,
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        "name": "openebs-operator",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "name": "openebs-operator",
                        },
                    },
                    spec: {
                        serviceAccountName: "openebs-maya-operator",
                        containers: [{
                            name: "openebs-provisioner",
                            image: `openebs/provisioner-localpv:${version}`,
                            env: [{
                                name: "NODE_NAME",
                                valueFrom: {
                                    fieldRef: {
                                        fieldPath: "spec.nodeName",
                                    },
                                },
                            }],
                            resources: resources.provisioner,
                        }, {
                            name: "localprovisioner",
                            image: `openebs/provisioner-localpv:${version}`,
                            env: [{
                                name: "NODE_NAME",
                                valueFrom: {
                                    fieldRef: {
                                        fieldPath: "spec.nodeName",
                                    },
                                },
                            }],
                            resources: resources.localProvisioner,
                        }],
                    },
                },
            },
        }, { parent: this, dependsOn: this.namespace });

        // Create NDM daemon set
        const ndmDaemonSet = new k8s.apps.v1.DaemonSet(`${prefix}${name}-ndm`, {
            metadata: {
                name: "openebs-ndm",
                namespace: namespace,
            },
            spec: {
                selector: {
                    matchLabels: {
                        "name": "openebs-ndm",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "name": "openebs-ndm",
                        },
                    },
                    spec: {
                        serviceAccountName: "openebs-maya-operator",
                        containers: [{
                            name: "node-disk-manager",
                            image: `openebs/node-disk-manager:${version}`,
                            resources: resources.ndm,
                            securityContext: {
                                privileged: true,
                            },
                            volumeMounts: [{
                                name: "procmount",
                                mountPath: "/host/proc",
                                readOnly: true,
                            }, {
                                name: "basepath",
                                mountPath: localStoragePath,
                            }],
                        }],
                        volumes: [{
                            name: "procmount",
                            hostPath: {
                                path: "/proc",
                            },
                        }, {
                            name: "basepath",
                            hostPath: {
                                path: localStoragePath,
                            },
                        }],
                    },
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
            }, { parent: this, dependsOn: this.operatorDeployment });

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
            }, { parent: this, dependsOn: this.operatorDeployment });

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
            }, { parent: this, dependsOn: this.operatorDeployment });

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
            }, { parent: this, dependsOn: this.operatorDeployment });
        }

        this.registerOutputs({
            namespace: this.namespace,
            operatorDeployment: this.operatorDeployment,
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
