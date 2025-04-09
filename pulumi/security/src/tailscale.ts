import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

export interface TailscaleOptions {
    namespace: pulumi.Input<string>;
    authKey: pulumi.Input<string>;
    hostname?: string;
    tags?: string[];
    advertiseRoutes?: string[];
    exitNode?: boolean;
    acceptDns?: boolean;
    advertiseDefaultRoute?: boolean;
    resources?: {
        limits?: {
            cpu: string;
            memory: string;
        };
        requests?: {
            cpu: string;
            memory: string;
        };
    };
}

export class Tailscale extends pulumi.ComponentResource {
    public readonly secret: k8s.core.v1.Secret;
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly configMap: k8s.core.v1.ConfigMap;
    public readonly serviceAccount: k8s.core.v1.ServiceAccount;
    public readonly networkPolicy: k8s.networking.v1.NetworkPolicy;

    constructor(
        name: string,
        options: TailscaleOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:Tailscale", name, {}, opts);

        const {
            namespace,
            authKey,
            hostname = `tailscale-${name}`,
            tags = ["tag:k8s", "tag:homelab"],
            advertiseRoutes = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
            exitNode = false,
            acceptDns = true,
            advertiseDefaultRoute = false,
            resources = {
                limits: {
                    cpu: "200m",
                    memory: "256Mi",
                },
                requests: {
                    cpu: "100m",
                    memory: "128Mi",
                },
            },
        } = options;

        // Create Secret for Tailscale auth key
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-auth`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "vpn",
                },
            },
            stringData: {
                "AUTH_KEY": authKey,
            },
        }, { parent: this });

        // Create ConfigMap for Tailscale configuration
        this.configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: `${name}-config`,
                namespace: namespace,
            },
            data: {
                "TS_HOSTNAME": hostname,
                "TS_USERSPACE": "true",
                "TS_KUBE_SECRET": "true",
                "TS_ACCEPT_DNS": acceptDns.toString(),
                "TS_ROUTES": advertiseRoutes.join(","),
                "TS_AUTH_ONCE": "true",
                "TS_EXTRA_ARGS": pulumi.interpolate`--advertise-tags=${tags.join(",")} ${exitNode ? "--advertise-exit-node" : ""} ${advertiseDefaultRoute ? "--advertise-default-route" : ""}`,
            },
        }, { parent: this });

        // Create ServiceAccount for Tailscale
        this.serviceAccount = new k8s.core.v1.ServiceAccount(`${name}-sa`, {
            metadata: {
                name: `${name}-sa`,
                namespace: namespace,
            },
        }, { parent: this });

        // Create Role for Tailscale
        const role = new k8s.rbac.v1.Role(`${name}-role`, {
            metadata: {
                name: `${name}-role`,
                namespace: namespace,
            },
            rules: [
                {
                    apiGroups: [""],
                    resources: ["secrets"],
                    resourceNames: [this.secret.metadata.name],
                    verbs: ["get", "update"],
                },
            ],
        }, { parent: this });

        // Create RoleBinding for Tailscale
        const roleBinding = new k8s.rbac.v1.RoleBinding(`${name}-rolebinding`, {
            metadata: {
                name: `${name}-rolebinding`,
                namespace: namespace,
            },
            subjects: [{
                kind: "ServiceAccount",
                name: this.serviceAccount.metadata.name,
                namespace: namespace,
            }],
            roleRef: {
                kind: "Role",
                name: role.metadata.name,
                apiGroup: "rbac.authorization.k8s.io",
            },
        }, { parent: this });

        // Create Deployment for Tailscale
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "vpn",
                },
            },
            spec: {
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": name,
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": name,
                        },
                    },
                    spec: {
                        serviceAccountName: this.serviceAccount.metadata.name,
                        containers: [{
                            name: "tailscale",
                            image: "tailscale/tailscale:latest",
                            imagePullPolicy: "Always",
                            securityContext: {
                                capabilities: {
                                    add: ["NET_ADMIN"],
                                },
                            },
                            envFrom: [
                                {
                                    secretRef: {
                                        name: this.secret.metadata.name,
                                    },
                                },
                                {
                                    configMapRef: {
                                        name: this.configMap.metadata.name,
                                    },
                                },
                            ],
                            resources: resources,
                            volumeMounts: [
                                {
                                    name: "tmp",
                                    mountPath: "/tmp",
                                },
                                {
                                    name: "dev-net-tun",
                                    mountPath: "/dev/net/tun",
                                },
                            ],
                            livenessProbe: {
                                exec: {
                                    command: ["tailscale", "status"],
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 30,
                            },
                            readinessProbe: {
                                exec: {
                                    command: ["tailscale", "status"],
                                },
                                initialDelaySeconds: 10,
                                periodSeconds: 10,
                            },
                        }],
                        volumes: [
                            {
                                name: "tmp",
                                emptyDir: {},
                            },
                            {
                                name: "dev-net-tun",
                                hostPath: {
                                    path: "/dev/net/tun",
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        // Create NetworkPolicy for Tailscale
        this.networkPolicy = new k8s.networking.v1.NetworkPolicy(`${name}-network-policy`, {
            metadata: {
                name: `${name}-network-policy`,
                namespace: namespace,
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        "app.kubernetes.io/name": name,
                    },
                },
                policyTypes: ["Ingress", "Egress"],
                ingress: [{
                    from: [{
                        namespaceSelector: {},
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
                            port: 41641,
                            protocol: "UDP",
                        }],
                    },
                    {
                        to: [{
                            namespaceSelector: {},
                        }],
                    },
                ],
            },
        }, { parent: this });

        this.registerOutputs({
            deploymentName: this.deployment.metadata.name,
            serviceName: this.service?.metadata.name,
            secretName: this.secret.metadata.name,
            configMapName: this.configMap.metadata.name,
            serviceAccountName: this.serviceAccount.metadata.name,
        });
    }
}
