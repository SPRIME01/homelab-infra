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

        // Create ServiceAccount
        const serviceAccount = new k8s.core.v1.ServiceAccount("traefik-account", {
            metadata: {
                name: "traefik",
                namespace: args.namespace,
            },
        }, { provider: opts?.provider, parent: this });

        // Create ClusterRole
        const clusterRole = new k8s.rbac.v1.ClusterRole("traefik-role", {
            metadata: {
                name: "traefik",
            },
            rules: [
                {
                    apiGroups: [""],
                    resources: ["services", "endpoints", "secrets"],
                    verbs: ["get", "list", "watch"],
                },
                {
                    apiGroups: ["extensions", "networking.k8s.io"],
                    resources: ["ingresses", "ingressclasses"],
                    verbs: ["get", "list", "watch"],
                },
            ],
        }, { provider: opts?.provider, parent: this });

        // Create ClusterRoleBinding
        const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("traefik-role-binding", {
            metadata: {
                name: "traefik",
            },
            roleRef: {
                apiGroup: "rbac.authorization.k8s.io",
                kind: "ClusterRole",
                name: clusterRole.metadata.name,
            },
            subjects: [{
                kind: "ServiceAccount",
                name: serviceAccount.metadata.name,
                namespace: args.namespace,
            }],
        }, { provider: opts?.provider, parent: this });

        // Create Deployment
        const deployment = new k8s.apps.v1.Deployment("traefik", {
            metadata: {
                name: "traefik",
                namespace: args.namespace,
            },
            spec: {
                replicas: 2,
                selector: {
                    matchLabels: {
                        app: "traefik",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            app: "traefik",
                        },
                    },
                    spec: {
                        serviceAccountName: serviceAccount.metadata.name,
                        containers: [{
                            name: "traefik",
                            image: pulumi.interpolate`traefik:${args.version}`,
                            args: [
                                "--log.level=INFO",
                                "--providers.kubernetesingress.ingressclass=traefik",
                                "--entrypoints.web.http.redirections.entryPoint.to=websecure",
                                "--entrypoints.web.http.redirections.entryPoint.scheme=https",
                            ],
                            ports: [
                                { name: "web", containerPort: 80 },
                                { name: "websecure", containerPort: 443 },
                                { name: "admin", containerPort: 8080 },
                            ],
                        }],
                    },
                },
            },
        }, { provider: opts?.provider, parent: this });

        // Create Service
        const service = new k8s.core.v1.Service("traefik", {
            metadata: {
                name: "traefik",
                namespace: args.namespace,
            },
            spec: {
                type: "LoadBalancer",
                selector: {
                    app: "traefik",
                },
                ports: [
                    { port: 80, name: "web", targetPort: "web" },
                    { port: 443, name: "websecure", targetPort: "websecure" },
                    { port: 8080, name: "admin", targetPort: "admin" },
                ],
            },
        }, { provider: opts?.provider, parent: this });

        // Extract the endpoint
        this.endpoint = service.status.loadBalancer.ingress[0].ip;

        this.registerOutputs({
            endpoint: this.endpoint,
        });
    }
}
