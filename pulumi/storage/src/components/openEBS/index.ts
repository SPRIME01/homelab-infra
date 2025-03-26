import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface OpenEBSArgs {
    namespace: string;
    version: string;
    createNamespace: boolean;
}

export class OpenEBS extends pulumi.ComponentResource {
    public readonly status: pulumi.Output<string>;

    constructor(name: string, args: OpenEBSArgs, opts?: CommonResourceOptions) {
        super("homelab:storage:OpenEBS", name, {}, opts);

        // Create namespace if requested
        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("openebs-ns", {
                metadata: {
                    name: args.namespace,
                },
            }, { provider: opts?.provider, parent: this });
        }

        // Deploy OpenEBS Operator
        const operatorDeployment = new k8s.apps.v1.Deployment("openebs-operator", {
            metadata: {
                name: "openebs-operator",
                namespace: args.namespace,
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {
                        name: "openebs-operator",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            name: "openebs-operator",
                        },
                    },
                    spec: {
                        serviceAccountName: "openebs-maya-operator",
                        containers: [{
                            name: "openebs-provisioner",
                            image: `openebs/openebs-k8s-provisioner:${args.version}`,
                            env: [{
                                name: "NODE_NAME",
                                valueFrom: {
                                    fieldRef: {
                                        fieldPath: "spec.nodeName",
                                    },
                                },
                            }],
                        }],
                    },
                },
            },
        }, { provider: opts?.provider, parent: this });

        // Deploy NDM Operator
        const ndmOperator = new k8s.apps.v1.DaemonSet("openebs-ndm", {
            metadata: {
                name: "openebs-ndm",
                namespace: args.namespace,
            },
            spec: {
                selector: {
                    matchLabels: {
                        name: "openebs-ndm",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            name: "openebs-ndm",
                        },
                    },
                    spec: {
                        serviceAccountName: "openebs-maya-operator",
                        containers: [{
                            name: "ndm",
                            image: `openebs/node-disk-manager:${args.version}`,
                            securityContext: {
                                privileged: true,
                            },
                            volumeMounts: [{
                                name: "device",
                                mountPath: "/host/dev",
                            }, {
                                name: "udev",
                                mountPath: "/run/udev",
                            }],
                        }],
                        volumes: [{
                            name: "device",
                            hostPath: {
                                path: "/dev",
                                type: "DirectoryOrCreate",
                            },
                        }, {
                            name: "udev",
                            hostPath: {
                                path: "/run/udev",
                                type: "DirectoryOrCreate",
                            },
                        }],
                    },
                },
            },
        }, { provider: opts?.provider, parent: this });

        // Create default storage class
        const defaultStorageClass = new k8s.storage.v1.StorageClass("openebs-default", {
            metadata: {
                name: "openebs-jiva-default",
                annotations: {
                    "openebs.io/cas-type": "jiva",
                    "cas.openebs.io/config": "- name: StoragePool\n  value: default\n",
                },
            },
            provisioner: "openebs.io/provisioner-iscsi",
            reclaimPolicy: "Delete",
        }, { provider: opts?.provider, parent: this });

        this.status = pulumi.output("Deployed");

        this.registerOutputs({
            status: this.status,
        });
    }
}
