import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Input properties for the Traefik component
 */
export interface TraefikArgs {
    /**
     * The namespace to deploy Traefik into
     * @default "traefik"
     */
    namespace?: string;

    /**
     * The version of Traefik to deploy
     * @default "v2.10.4"
     */
    version?: string;

    /**
     * Resource requests and limits for Traefik
     * @default - see defaultResourceSettings
     */
    resources?: TraefikResourceSettings;

    /**
     * Enable dashboard with secure access
     * @default true
     */
    enableDashboard?: boolean;

    /**
     * Domain for the Traefik dashboard
     * @default "traefik.local"
     */
    dashboardDomain?: string;

    /**
     * ClusterIssuer to use for dashboard TLS
     * @default "letsencrypt-production"
     */
    dashboardClusterIssuer?: string;

    /**
     * NodePort to use for HTTP traffic (port 80)
     * @default 30080
     */
    httpNodePort?: number;

    /**
     * NodePort to use for HTTPS traffic (port 443)
     * @default 30443
     */
    httpsNodePort?: number;

    /**
     * Whether to create common middleware resources
     * @default true
     */
    createMiddlewares?: boolean;

    /**
     * Number of Traefik replicas
     * @default 1
     */
    replicas?: number;

    /**
     * Optional prefix for resources created by this component
     */
    namePrefix?: string;
}

/**
 * Resource settings for Traefik
 */
export interface TraefikResourceSettings {
    requests?: {
        cpu?: string;
        memory?: string;
    };
    limits?: {
        cpu?: string;
        memory?: string;
    };
}

/**
 * Default resource settings suitable for a homelab environment
 */
const defaultResourceSettings: TraefikResourceSettings = {
    requests: {
        cpu: "100m",
        memory: "128Mi",
    },
    limits: {
        cpu: "300m",
        memory: "256Mi",
    },
};

/**
 * Traefik is a component resource that deploys Traefik as an ingress controller
 * on a Kubernetes cluster with proper configuration for a homelab environment.
 */
export class Traefik extends pulumi.ComponentResource {
    /**
     * The namespace where Traefik is deployed
     */
    public readonly namespace: k8s.core.v1.Namespace;

    /**
     * The Traefik helm release
     */
    public readonly release: k8s.helm.v3.Release;

    /**
     * The Traefik dashboard ingress if enabled
     */
    public readonly dashboardIngress?: k8s.networking.v1.Ingress;

    /**
     * Common middleware resources
     */
    public readonly middlewares: {
        secureHeaders?: k8s.apiextensions.CustomResource;
        redirectToHttps?: k8s.apiextensions.CustomResource;
        basicAuth?: k8s.apiextensions.CustomResource;
    } = {};

    constructor(name: string, args: TraefikArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k8s:Traefik", name, args, opts);

        const prefix = args.namePrefix || "";
        const namespace = args.namespace || "traefik";
        const version = args.version || "v2.10.4";
        const resources = args.resources || defaultResourceSettings;
        const enableDashboard = args.enableDashboard !== false;
        const dashboardDomain = args.dashboardDomain || "traefik.local";
        const dashboardClusterIssuer = args.dashboardClusterIssuer || "letsencrypt-production";
        const httpNodePort = args.httpNodePort || 30080;
        const httpsNodePort = args.httpsNodePort || 30443;
        const createMiddlewares = args.createMiddlewares !== false;
        const replicas = args.replicas || 1;

        // Create namespace for Traefik
        this.namespace = new k8s.core.v1.Namespace(`${prefix}${name}-namespace`, {
            metadata: {
                name: namespace,
                labels: {
                    "homelab-managed": "true",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
        }, { parent: this });

        // Create CRDs for Traefik (these would usually be included in the Helm chart,
        // but we're creating them explicitly for better visibility)
        const crds = [
            this.createCRD(`${prefix}${name}-middleware-crd`, {
                apiVersion: "apiextensions.k8s.io/v1",
                kind: "CustomResourceDefinition",
                metadata: {
                    name: "middlewares.traefik.containo.us",
                },
                spec: {
                    group: "traefik.containo.us",
                    names: {
                        kind: "Middleware",
                        plural: "middlewares",
                        singular: "middleware",
                    },
                    scope: "Namespaced",
                    versions: [{
                        name: "v1alpha1",
                        served: true,
                        storage: true,
                        schema: {
                            openAPIV3Schema: {
                                type: "object",
                                properties: {
                                    spec: {
                                        type: "object",
                                    },
                                },
                            },
                        },
                    }],
                },
            }),
            this.createCRD(`${prefix}${name}-ingressroute-crd`, {
                apiVersion: "apiextensions.k8s.io/v1",
                kind: "CustomResourceDefinition",
                metadata: {
                    name: "ingressroutes.traefik.containo.us",
                },
                spec: {
                    group: "traefik.containo.us",
                    names: {
                        kind: "IngressRoute",
                        plural: "ingressroutes",
                        singular: "ingressroute",
                    },
                    scope: "Namespaced",
                    versions: [{
                        name: "v1alpha1",
                        served: true,
                        storage: true,
                        schema: {
                            openAPIV3Schema: {
                                type: "object",
                                properties: {
                                    spec: {
                                        type: "object",
                                    },
                                },
                            },
                        },
                    }],
                },
            }),
            this.createCRD(`${prefix}${name}-tlsoption-crd`, {
                apiVersion: "apiextensions.k8s.io/v1",
                kind: "CustomResourceDefinition",
                metadata: {
                    name: "tlsoptions.traefik.containo.us",
                },
                spec: {
                    group: "traefik.containo.us",
                    names: {
                        kind: "TLSOption",
                        plural: "tlsoptions",
                        singular: "tlsoption",
                    },
                    scope: "Namespaced",
                    versions: [{
                        name: "v1alpha1",
                        served: true,
                        storage: true,
                        schema: {
                            openAPIV3Schema: {
                                type: "object",
                                properties: {
                                    spec: {
                                        type: "object",
                                    },
                                },
                            },
                        },
                    }],
                },
            }),
        ];

        // Deploy Traefik using Helm
        this.release = new k8s.helm.v3.Release(`${prefix}${name}`, {
            chart: "traefik",
            version: version,
            namespace: this.namespace.metadata.name,
            repositoryOpts: {
                repo: "https://traefik.github.io/charts",
            },
            values: {
                deployment: {
                    replicas: replicas,
                },
                ingressClass: {
                    enabled: true,
                    isDefaultClass: true,
                },
                ingressRoute: {
                    dashboard: {
                        enabled: false, // We'll create our own secure dashboard ingress
                    },
                },
                ports: {
                    web: {
                        nodePort: httpNodePort,
                    },
                    websecure: {
                        nodePort: httpsNodePort,
                    },
                },
                service: {
                    type: "NodePort",
                },
                resources: resources,
                providers: {
                    kubernetesCRD: {
                        enabled: true,
                    },
                    kubernetesIngress: {
                        enabled: true,
                        publishedService: {
                            enabled: true,
                        },
                    },
                },
                additionalArguments: [
                    "--log.level=INFO",
                    "--api.dashboard=true",
                    "--api.insecure=false",
                    "--serverstransport.insecureskipverify=true",
                    "--providers.kubernetesingress.ingressclass=traefik",
                    "--entrypoints.web.http.redirections.entryPoint.to=websecure",
                    "--entrypoints.web.http.redirections.entryPoint.scheme=https",
                    "--entrypoints.web.http.redirections.entrypoint.permanent=true",
                ],
                logs: {
                    general: {
                        level: "INFO",
                    },
                    access: {
                        enabled: true,
                    },
                },
                persistence: {
                    enabled: true,
                    path: "/data",
                    size: "128Mi",
                },
                podAnnotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "9100",
                },
                securityContext: {
                    capabilities: {
                        drop: ["ALL"],
                    },
                    readOnlyRootFilesystem: true,
                    runAsGroup: 65532,
                    runAsNonRoot: true,
                    runAsUser: 65532,
                },
            },
        }, { parent: this, dependsOn: [...crds, this.namespace] });

        // Create TLS Option for secure defaults
        const tlsOption = new k8s.apiextensions.CustomResource(`${prefix}${name}-tls-option`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "TLSOption",
            metadata: {
                name: "default",
                namespace: namespace,
            },
            spec: {
                minVersion: "VersionTLS12",
                cipherSuites: [
                    "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
                    "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
                    "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305",
                    "TLS_AES_128_GCM_SHA256",
                    "TLS_AES_256_GCM_SHA384",
                    "TLS_CHACHA20_POLY1305_SHA256",
                ],
                curvePreferences: ["CurveP521", "CurveP384"],
                sniStrict: true,
            },
        }, { parent: this, dependsOn: this.release });

        // Create common middlewares if enabled
        if (createMiddlewares) {
            // Secure headers middleware
            this.middlewares.secureHeaders = new k8s.apiextensions.CustomResource(`${prefix}${name}-secure-headers`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: "secure-headers",
                    namespace: namespace,
                },
                spec: {
                    headers: {
                        browserXssFilter: true,
                        contentTypeNosniff: true,
                        forceSTSHeader: true,
                        stsIncludeSubdomains: true,
                        stsPreload: true,
                        stsSeconds: 31536000,
                        customFrameOptionsValue: "SAMEORIGIN",
                        customRequestHeaders: {
                            "X-Forwarded-Proto": "https",
                        },
                    },
                },
            }, { parent: this, dependsOn: this.release });

            // Redirect to HTTPS middleware
            this.middlewares.redirectToHttps = new k8s.apiextensions.CustomResource(`${prefix}${name}-redirect-to-https`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: "redirect-to-https",
                    namespace: namespace,
                },
                spec: {
                    redirectScheme: {
                        scheme: "https",
                        permanent: true,
                    },
                },
            }, { parent: this, dependsOn: this.release });

            // Basic Auth middleware (placeholder - requires actual auth generation)
            this.middlewares.basicAuth = new k8s.apiextensions.CustomResource(`${prefix}${name}-basic-auth`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: "basic-auth",
                    namespace: namespace,
                },
                spec: {
                    basicAuth: {
                        secret: "traefik-auth", // This secret needs to be created separately
                    },
                },
            }, { parent: this, dependsOn: this.release });
        }

        // Create dashboard ingress if enabled
        if (enableDashboard) {
            // Create dashboard ingress with TLS
            this.dashboardIngress = new k8s.networking.v1.Ingress(`${prefix}${name}-dashboard-ingress`, {
                metadata: {
                    name: "traefik-dashboard",
                    namespace: namespace,
                    annotations: {
                        "kubernetes.io/ingress.class": "traefik",
                        "cert-manager.io/cluster-issuer": dashboardClusterIssuer,
                        "traefik.ingress.kubernetes.io/router.middlewares": `${namespace}/secure-headers`,
                    },
                },
                spec: {
                    tls: [{
                        hosts: [dashboardDomain],
                        secretName: "traefik-dashboard-tls",
                    }],
                    rules: [{
                        host: dashboardDomain,
                        http: {
                            paths: [{
                                path: "/",
                                pathType: "Prefix",
                                backend: {
                                    service: {
                                        name: `${this.release.status.name}`,
                                        port: {
                                            number: 9000,
                                        },
                                    },
                                },
                            }],
                        },
                    }],
                },
            }, { parent: this, dependsOn: [this.release, ...(this.middlewares.secureHeaders ? [this.middlewares.secureHeaders] : [])] });
        }

        this.registerOutputs({
            namespace: this.namespace,
            release: this.release,
            dashboardIngress: this.dashboardIngress,
            middlewares: this.middlewares,
        });
    }

    // Helper method to create CRDs
    private createCRD(name: string, crd: any): k8s.apiextensions.CustomResource {
        return new k8s.apiextensions.CustomResource(name, crd, { parent: this });
    }
}
