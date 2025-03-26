import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface CertManagerArgs {
    namespace: string;
    version: string;
    createNamespace: boolean;
}

export class CertManager extends pulumi.ComponentResource {
    public readonly status: pulumi.Output<string>;

    constructor(name: string, args: CertManagerArgs, opts?: CommonResourceOptions) {
        super("homelab:core:CertManager", name, {}, opts);

        // Create namespace if requested
        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("cert-manager-ns", {
                metadata: {
                    name: args.namespace,
                },
            }, { provider: opts?.provider, parent: this });
        }

        // Deploy cert-manager CRDs
        const certManagerCrds = new k8s.yaml.ConfigGroup("cert-manager-crds", {
            files: [`https://github.com/cert-manager/cert-manager/releases/download/${args.version}/cert-manager.crds.yaml`],
        }, { provider: opts?.provider, parent: this });

        // Deploy cert-manager operator
        const certManagerOperator = new k8s.yaml.ConfigGroup("cert-manager-operator", {
            files: [`https://github.com/cert-manager/cert-manager/releases/download/${args.version}/cert-manager.yaml`],
        }, {
            provider: opts?.provider,
            parent: this,
            dependsOn: [certManagerCrds]
        });

        // Create a ClusterIssuer for Let's Encrypt
        const issuer = new k8s.apiextensions.CustomResource("letsencrypt-issuer", {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
                name: "letsencrypt-prod",
                namespace: args.namespace,
            },
            spec: {
                acme: {
                    server: "https://acme-v02.api.letsencrypt.org/directory",
                    email: "admin@example.com",
                    privateKeySecretRef: {
                        name: "letsencrypt-prod-account-key",
                    },
                    solvers: [{
                        http01: {
                            ingress: {
                                class: "traefik",
                            },
                        },
                    }],
                },
            },
        }, {
            provider: opts?.provider,
            parent: this,
            dependsOn: [certManagerOperator]
        });

        this.status = certManagerOperator.ready.apply(r => r ? "Deployed" : "Pending");

        this.registerOutputs({
            status: this.status,
        });
    }
}
