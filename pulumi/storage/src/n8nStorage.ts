import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface N8nStorageOptions {
    namespace: pulumi.Input<string>;
    storageClassName?: pulumi.Input<string>;
    storageSize?: pulumi.Input<string>;
    accessModes?: pulumi.Input<string>[];
    backupEnabled?: boolean;
}

export class N8nStorage extends pulumi.ComponentResource {
    public readonly pvc: k8s.core.v1.PersistentVolumeClaim;

    constructor(
        name: string,
        options: N8nStorageOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:storage:N8nStorage", name, {}, opts);

        const {
            namespace,
            storageClassName = "longhorn",
            storageSize = "10Gi",
            accessModes = ["ReadWriteOnce"],
            backupEnabled = true,
        } = options;

        // Create annotations based on configuration
        const annotations: {[key: string]: pulumi.Input<string>} = {};

        if (backupEnabled) {
            annotations["backup.velero.io/backup-volumes"] = "n8n-data";
            annotations["backup.velero.io/backup-strategy"] = "snapshot";
        }

        // Create PersistentVolumeClaim for n8n data
        this.pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: {
                name: `${name}-data`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": "n8n",
                    "app.kubernetes.io/component": "database",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
                annotations: annotations,
            },
            spec: {
                accessModes: accessModes,
                storageClassName: storageClassName,
                resources: {
                    requests: {
                        storage: storageSize,
                    },
                },
            },
        }, { parent: this });

        // Register outputs
        this.registerOutputs({
            pvcName: this.pvc.metadata.name,
            pvcNamespace: this.pvc.metadata.namespace,
        });
    }
}
