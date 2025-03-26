import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface TraefikArgs {
    namespace: string;
    version: string;
    createNamespace: boolean;
    email: pulumi.Input<string>;
}

export class Traefik extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;

    constructor(name: string, args: TraefikArgs, opts?: CommonResourceOptions) {
        super("homelab:core:Traefik", name, {}, opts);

        // Create namespace if requested
        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("traefik-ns", {
                metadata: {
                    name: args.namespace,
                },
            }, { provider: opts?.provider, parent: this });
        }

        // Deploy Traefik via Helm
        const traefikRelease = new k8s.helm.v3.Release("traefik", {
            chart: "traefik",
            version: args.version,
            repositoryOpts: {
                repo: "https://helm.traefik.io/traefik",
            },
            namespace: args.namespace,
            values: {
                deployment: {
                    replicas: 2,
                },
                ingressRoute: {
                    dashboard: {
                        enabled: true,
                    },
                },
                service: {
                    type: "LoadBalancer",
                },
                additionalArguments: [
                    "--log.level=INFO",
                    "--providers.kubernetesingress.ingressclass=traefik",
                    "--entrypoints.web.http.redirections.entryPoint.to=websecure",
                    "--entrypoints.web.http.redirections.entryPoint.scheme=https",
                ],
            },
        }, { provider: opts?.provider, parent: this });

        // Get the Traefik service to extract the endpoint
        const traefikService = traefikRelease.status.apply(_ => {
            return k8s.core.v1.Service.get("traefik-service",
                pulumi.interpolate`${args.namespace}/traefik`,
                { provider: opts?.provider }
            );
        });

        // Extract the endpoint
        this.endpoint = traefikService.status.loadBalancer.ingress[0].ip.apply(ip =>
            
        );

        this.registerOutputs({
            endpoint: this.endpoint,
        });
    }
}
