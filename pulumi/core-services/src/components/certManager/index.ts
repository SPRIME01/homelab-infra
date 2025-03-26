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

        // Add the Jetstack Helm repository
        const certManagerRepo = new k8s.helm.v3.Release("cert-manager", {
            chart: "cert-manager",
            version: args.version,
            repositoryOpts: {
                repo: "https://charts.jetstack.io",
            },
            namespace: args.namespace,
            values: {
                installCRDs: true,
                prometheus: {
                    enabled: true,
                },
            },
        }, { provider: opts?.provider, parent: this });

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
                    email: "admin@example.com", // This should be configurable
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
            dependsOn: [certManagerRepo],
        });

        this.status = pulumi.output("Deployed");

        this.registerOutputs({
            status: this.status,
        });
    }
}
