import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface StorageClassesArgs {
    localPathClass: boolean;
    jivaCsiClass: boolean;
}

export class StorageClasses extends pulumi.ComponentResource {
    public readonly defaultClass: pulumi.Output<string>;

    constructor(name: string, args: StorageClassesArgs, opts?: CommonResourceOptions) {
        super("homelab:storage:StorageClasses", name, {}, opts);

        let defaultClassName = "openebs-hostpath";

        // Create local-path storage class if requested
        if (args.localPathClass) {
            const localPath = new k8s.storage.v1.StorageClass("local-path", {
                metadata: {
                    name: "openebs-hostpath",
                    annotations: {
                        "storageclass.kubernetes.io/is-default-class": "true",
                    },
                },
                provisioner: "openebs.io/local",
                reclaimPolicy: "Delete",
                volumeBindingMode: "WaitForFirstConsumer",
            }, { provider: opts?.provider, parent: this });

            defaultClassName = "openebs-hostpath";
        }

        // Create Jiva CSI storage class if requested
        if (args.jivaCsiClass) {
            const jivaCsi = new k8s.storage.v1.StorageClass("jiva-csi", {
                metadata: {
                    name: "openebs-jiva-csi",
                },
                provisioner: "jiva.csi.openebs.io",
                reclaimPolicy: "Delete",
                allowVolumeExpansion: true,
                parameters: {
                    "cas-type": "jiva",
                    "replicaCount": "3",
                },
            }, { provider: opts?.provider, parent: this });
        }

        this.defaultClass = pulumi.output(defaultClassName);

        this.registerOutputs({
            defaultClass: this.defaultClass,
        });
    }
}
