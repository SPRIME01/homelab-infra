import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

export interface CloudflareTunnelOptions {
    namespace: pulumi.Input<string>;
    accountId: pulumi.Input<string>;
    apiToken: pulumi.Input<string>;
    zoneId: pulumi.Input<string>;
    domain: string;
    services: {
        name: string;
        service: string;
        port: number;
        path?: string;
        authentication?: "none" | "basic" | "oidc";
        allowedGroups?: string[];
    }[];
    monitoring?: {
        enabled: boolean;
        prometheusNamespace?: string;
    };
}

export class CloudflareTunnels extends pulumi.ComponentResource {
    public readonly secret: k8s.core.v1.Secret;
    public readonly serviceAccount: k8s.core.v1.ServiceAccount;
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly configMap: k8s.core.v1.ConfigMap;
    public readonly tunnelId: pulumi.Output<string>;

    constructor(
        name: string,
        options: CloudflareTunnelOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:CloudflareTunnels", name, {}, opts);

        const {
            namespace,
            accountId,
            apiToken,
            zoneId,
            domain,
            services,
            monitoring = { enabled: true },
        } = options;

        // Generate a unique tunnel ID
        const tunnelId = new random.RandomId(`${name}-tunnel-id`, {
            byteLength: 8,
            prefix: "homelab-",
        }, { parent: this });

        // Create secret for Cloudflare credentials
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-credentials`,
                namespace: namespace,
            },
            stringData: {
                "credentials.json": pulumi.interpolate`{
                    "AccountTag": "${accountId}",
                    "TunnelID": "${tunnelId.hex}",
                    "TunnelSecret": "${new random.RandomPassword(`${name}-tunnel-secret`, {
                        length: 32,
                        special: true,
                    }).result}",
                    "APIToken": "${apiToken}"
                }`,
            },
        }, { parent: this });

        // Create ConfigMap for cloudflared configuration
        this.configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: `${name}-config`,
                namespace: namespace,
            },
            data: {
                "config.yaml": pulumi.all([tunnelId.hex, services]).apply(([tid, svcs]) => `
tunnel: ${tid}
credentials-file: /etc/cloudflared/creds/credentials.json
metrics: 0.0.0.0:2000
no-autoupdate: true

ingress:
${svcs.map(svc => `
  - hostname: ${svc.name}.${domain}
    service: http://${svc.service}:${svc.port}${svc.path || ""}
    originRequest:
      noTLSVerify: true
    authn: ${this.generateAuthConfig(svc)}
`).join("")}
  - service: http_status:404
`),
            },
        }, { parent: this });

        // Create ServiceAccount for cloudflared
        this.serviceAccount = new k8s.core.v1.ServiceAccount(`${name}-sa`, {
            metadata: {
                name: `${name}-cloudflared`,
                namespace: namespace,
            },
        }, { parent: this });

        // Create deployment for cloudflared
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: `${name}-cloudflared`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": "cloudflared",
                    "app.kubernetes.io/instance": name,
                },
            },
            spec: {
                replicas: 2,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cloudflared",
                        "app.kubernetes.io/instance": name,
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "cloudflared",
                            "app.kubernetes.io/instance": name,
                        },
                    },
                    spec: {
                        serviceAccountName: this.serviceAccount.metadata.name,
                        containers: [{
                            name: "cloudflared",
                            image: "cloudflare/cloudflared:latest",
                            args: [
                                "tunnel",
                                "--config",
                                "/etc/cloudflared/config/config.yaml",
                                "run",
                            ],
                            resources: {
                                requests: {
                                    cpu: "100m",
                                    memory: "128Mi",
                                },
                                limits: {
                                    cpu: "200m",
                                    memory: "256Mi",
                                },
                            },
                            volumeMounts: [
                                {
                                    name: "config",
                                    mountPath: "/etc/cloudflared/config",
                                    readOnly: true,
                                },
                                {
                                    name: "creds",
                                    mountPath: "/etc/cloudflared/creds",
                                    readOnly: true,
                                },
                            ],
                            livenessProbe: {
                                httpGet: {
                                    path: "/ready",
                                    port: 2000,
                                },
                                initialDelaySeconds: 10,
                                periodSeconds: 10,
                            },
                            readinessProbe: {
                                httpGet: {
                                    path: "/ready",
                                    port: 2000,
                                },
                                initialDelaySeconds: 5,
                                periodSeconds: 5,
                            },
                        }],
                        volumes: [
                            {
                                name: "config",
                                configMap: {
                                    name: this.configMap.metadata.name,
                                },
                            },
                            {
                                name: "creds",
                                secret: {
                                    secretName: this.secret.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        // If monitoring is enabled, create ServiceMonitor for Prometheus
        if (monitoring.enabled) {
            const serviceMonitor = new k8s.apiextensions.CustomResource(`${name}-monitor`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: `${name}-cloudflared`,
                    namespace: monitoring.prometheusNamespace || namespace,
                    labels: {
                        "app.kubernetes.io/name": "cloudflared",
                        "app.kubernetes.io/instance": name,
                    },
                },
                spec: {
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "cloudflared",
                            "app.kubernetes.io/instance": name,
                        },
                    },
                    endpoints: [{
                        port: "metrics",
                        path: "/metrics",
                        interval: "30s",
                    }],
                },
            }, { parent: this });
        }

        // Create network policies
        const networkPolicy = new k8s.networking.v1.NetworkPolicy(`${name}-network-policy`, {
            metadata: {
                name: `${name}-cloudflared`,
                namespace: namespace,
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cloudflared",
                        "app.kubernetes.io/instance": name,
                    },
                },
                policyTypes: ["Ingress", "Egress"],
                ingress: [{
                    ports: [{
                        port: 2000,
                        protocol: "TCP",
                    }],
                }],
                egress: [
                    {
                        to: [{
                            ipBlock: {
                                cidr: "0.0.0.0/0",
                                except: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
                            },
                        }],
                        ports: [{
                            port: 443,
                            protocol: "TCP",
                        }],
                    },
                    {
                        to: [{
                            namespaceSelector: {},
                        }],
                        ports: [{
                            port: 80,
                            protocol: "TCP",
                        }],
                    },
                ],
            },
        }, { parent: this });

        this.tunnelId = tunnelId.hex;

        this.registerOutputs({
            tunnelId: this.tunnelId,
            deploymentName: this.deployment.metadata.name,
            secretName: this.secret.metadata.name,
            configMapName: this.configMap.metadata.name,
        });
    }

    private generateAuthConfig(service: CloudflareTunnelOptions["services"][0]): string {
        if (!service.authentication || service.authentication === "none") {
            return "off";
        }

        let authConfig = "";
        if (service.authentication === "basic") {
            authConfig = "basic";
        } else if (service.authentication === "oidc") {
            authConfig = `oidc:
      provider: generic-oidc
      allowed_groups: ${JSON.stringify(service.allowedGroups || [])}`;
        }

        return authConfig;
    }

    public getDnsRecords(): pulumi.Output<{ name: string; content: string }[]> {
        return pulumi.all([this.tunnelId, options.services]).apply(([tid, svcs]) =>
            svcs.map(svc => ({
                name: `${svc.name}.${options.domain}`,
                content: tid,
            }))
        );
    }
}
