import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface HeimdallOptions {
    namespace: pulumi.Input<string>;
    domain: string;
    storageClassName?: pulumi.Input<string>;
    storageSize?: pulumi.Input<string>;
    autheliaNamespace?: string;
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
    homelabServices?: Array<{
        name: string;
        url: string;
        icon?: string;
        description?: string;
        tags?: string[];
    }>;
    allowedNetworks?: string[];
}

export class Heimdall extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly ingress: k8s.networking.v1.Ingress;
    public readonly pvc: k8s.core.v1.PersistentVolumeClaim;
    public readonly configMap: k8s.core.v1.ConfigMap;
    public readonly networkPolicy: k8s.networking.v1.NetworkPolicy;

    constructor(
        name: string,
        options: HeimdallOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:Heimdall", name, {}, opts);

        const {
            namespace,
            domain,
            storageClassName = "longhorn",
            storageSize = "1Gi",
            autheliaNamespace = "auth",
            resources = {
                limits: {
                    cpu: "500m",
                    memory: "512Mi",
                },
                requests: {
                    cpu: "100m",
                    memory: "128Mi",
                },
            },
            homelabServices = [],
            allowedNetworks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
        } = options;

        // Create PVC for Heimdall data
        this.pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: {
                name: `${name}-data`,
                namespace: namespace,
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                storageClassName: storageClassName,
                resources: {
                    requests: {
                        storage: storageSize,
                    },
                },
            },
        }, { parent: this });

        // Create ConfigMap for service entries
        this.configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: `${name}-config`,
                namespace: namespace,
            },
            data: {
                "homelab-services.json": JSON.stringify({
                    services: homelabServices.map((service, index) => ({
                        id: index + 1,
                        title: service.name,
                        url: service.url,
                        icon: service.icon || "fas fa-cube",
                        description: service.description || "",
                        tags: service.tags || [],
                        appid: this.generateAppId(service.name),
                    })),
                }),
            },
        }, { parent: this });

        // Create Deployment
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: name,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "portal",
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
                        containers: [{
                            name: "heimdall",
                            image: "linuxserver/heimdall:latest",
                            resources: resources,
                            ports: [{
                                containerPort: 80,
                                name: "http",
                            }],
                            env: [
                                {
                                    name: "PUID",
                                    value: "1000",
                                },
                                {
                                    name: "PGID",
                                    value: "1000",
                                },
                                {
                                    name: "TZ",
                                    value: "UTC",
                                },
                            ],
                            volumeMounts: [
                                {
                                    name: "data",
                                    mountPath: "/config",
                                },
                                {
                                    name: "services",
                                    mountPath: "/config/www/app/services.json",
                                    subPath: "homelab-services.json",
                                },
                            ],
                            livenessProbe: {
                                httpGet: {
                                    path: "/",
                                    port: "http",
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 10,
                            },
                            readinessProbe: {
                                httpGet: {
                                    path: "/",
                                    port: "http",
                                },
                                initialDelaySeconds: 5,
                                periodSeconds: 5,
                            },
                        }],
                        volumes: [
                            {
                                name: "data",
                                persistentVolumeClaim: {
                                    claimName: this.pvc.metadata.name,
                                },
                            },
                            {
                                name: "services",
                                configMap: {
                                    name: this.configMap.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        // Create Service
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                name: name,
                namespace: namespace,
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": name,
                },
                ports: [{
                    port: 80,
                    targetPort: "http",
                    name: "http",
                }],
            },
        }, { parent: this });

        // Create Ingress with Authelia authentication
        this.ingress = new k8s.networking.v1.Ingress(`${name}-ingress`, {
            metadata: {
                name: name,
                namespace: namespace,
                annotations: {
                    "kubernetes.io/ingress.class": "traefik",
                    "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
                    "traefik.ingress.kubernetes.io/router.tls": "true",
                    "traefik.ingress.kubernetes.io/router.middlewares":
                        `${autheliaNamespace}-authelia@kubernetescrd`,
                },
            },
            spec: {
                rules: [{
                    host: domain,
                    http: {
                        paths: [{
                            path: "/",
                            pathType: "Prefix",
                            backend: {
                                service: {
                                    name: this.service.metadata.name,
                                    port: {
                                        name: "http",
                                    },
                                },
                            },
                        }],
                    },
                }],
                tls: [{
                    hosts: [domain],
                    secretName: `${name}-tls`,
                }],
            },
        }, { parent: this });

        // Create NetworkPolicy
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
                ingress: [
                    {
                        from: [
                            {
                                namespaceSelector: {
                                    matchLabels: {
                                        "kubernetes.io/metadata.name": "ingress-nginx",
                                    },
                                },
                            },
                        ],
                        ports: [{
                            port: 80,
                            protocol: "TCP",
                        }],
                    },
                    ...allowedNetworks.map(cidr => ({
                        from: [{
                            ipBlock: {
                                cidr: cidr,
                            },
                        }],
                        ports: [{
                            port: 80,
                            protocol: "TCP",
                        }],
                    })),
                ],
                egress: [{
                    to: [{
                        namespaceSelector: {},
                    }],
                    ports: [{
                        port: 80,
                        protocol: "TCP",
                    }],
                }],
            },
        }, { parent: this });

        this.registerOutputs({
            deploymentName: this.deployment.metadata.name,
            serviceName: this.service.metadata.name,
            ingressName: this.ingress.metadata.name,
            url: `https://${domain}`,
        });
    }

    private generateAppId(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 16);
    }

    // Helper method to add a new service
    public addService(
        service: {
            name: string;
            url: string;
            icon?: string;
            description?: string;
            tags?: string[];
        }
    ): pulumi.Output<void> {
        return pulumi.all([this.configMap.data["homelab-services.json"]]).apply(
            ([servicesJson]) => {
                const services = JSON.parse(servicesJson).services;
                services.push({
                    id: services.length + 1,
                    title: service.name,
                    url: service.url,
                    icon: service.icon || "fas fa-cube",
                    description: service.description || "",
                    tags: service.tags || [],
                    appid: this.generateAppId(service.name),
                });

                this.configMap.data["homelab-services.json"] = JSON.stringify({ services });
            }
        );
    }
}
