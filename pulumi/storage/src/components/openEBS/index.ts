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

        // Deploy OpenEBS via Helm
        const openebsRelease = new k8s.helm.v3.Release("openebs", {
            chart: "openebs",
            version: args.version,
            repositoryOpts: {
                repo: "https://openebs.github.io/charts",
            },
            namespace: args.namespace,
            values: {
                ndm: {
                    enabled: true,
                },
                localprovisioner: {
                    enabled: true,
                },
                jiva: {
                    enabled: true,
                },
            },
        }, { provider: opts?.provider, parent: this });

        this.status = pulumi.output("Deployed");

        this.registerOutputs({
            status: this.status,
        });
    }
}
