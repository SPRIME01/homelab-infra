import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface TraefikAutheliaOptions {
    namespace: pulumi.Input<string>;
    autheliaNamespace: pulumi.Input<string>;
    baseDomain: string;
    autheliaServiceName?: string;
    autheliaPort?: number;
    cookieSecure?: boolean;
    cookieDomain?: string;
    sessionDuration?: string;
    defaultRedirectUrl?: string;
}

export enum SecurityLevel {
    Public = "public",
    BasicAuth = "basic-auth",
    TwoFactor = "two-factor"
}

export class TraefikAuthelia extends pulumi.ComponentResource {
    public readonly forwardAuthMiddleware: k8s.apiextensions.CustomResource;
    public readonly securityChains: { [key in SecurityLevel]: k8s.apiextensions.CustomResource };
    public readonly headerMiddleware: k8s.apiextensions.CustomResource;
    public readonly cookieMiddleware: k8s.apiextensions.CustomResource;
    public readonly redirectMiddleware: k8s.apiextensions.CustomResource;

    constructor(
        name: string,
        options: TraefikAutheliaOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:TraefikAuthelia", name, {}, opts);

        const {
            namespace,
            autheliaNamespace,
            baseDomain,
            autheliaServiceName = "authelia",
            autheliaPort = 9091,
            cookieSecure = true,
            cookieDomain = baseDomain,
            sessionDuration = "1h",
            defaultRedirectUrl = `https://auth.${baseDomain}`,
        } = options;

        // Create ForwardAuth middleware for Authelia
        this.forwardAuthMiddleware = new k8s.apiextensions.CustomResource(`${name}-forward-auth`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${name}-forward-auth`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "auth",
                },
            },
            spec: {
                forwardAuth: {
                    address: pulumi.interpolate`http://${autheliaServiceName}.${autheliaNamespace}.svc.cluster.local:${autheliaPort}/api/verify?rd=${defaultRedirectUrl}`,
                    trustForwardHeader: true,
                    authResponseHeaders: [
                        "Remote-User",
                        "Remote-Name",
                        "Remote-Email",
                        "Remote-Groups",
                    ],
                },
            },
        }, { parent: this });

        // Create secure cookie handling middleware
        this.cookieMiddleware = new k8s.apiextensions.CustomResource(`${name}-cookies`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${name}-cookies`,
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
                    customResponseHeaders: {
                        "Set-Cookie": `authelia_session; Path=/; Domain=${cookieDomain}; Max-Age=${sessionDuration}; ${cookieSecure ? 'Secure; ' : ''}HttpOnly; SameSite=Lax`,
                    },
                },
            },
        }, { parent: this });

        // Create headers middleware for authentication information
        this.headerMiddleware = new k8s.apiextensions.CustomResource(`${name}-headers`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${name}-headers`,
                namespace: namespace,
            },
            spec: {
                headers: {
                    customRequestHeaders: {
                        "X-Forwarded-User": "{{ .Request.Headers.Remote-User }}",
                        "X-Forwarded-Groups": "{{ .Request.Headers.Remote-Groups }}",
                        "X-Forwarded-Email": "{{ .Request.Headers.Remote-Email }}",
                        "X-Forwarded-Name": "{{ .Request.Headers.Remote-Name }}",
                    },
                },
            },
        }, { parent: this });

        // Create redirect middleware
        this.redirectMiddleware = new k8s.apiextensions.CustomResource(`${name}-redirect`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${name}-redirect`,
                namespace: namespace,
            },
            spec: {
                redirectScheme: {
                    scheme: "https",
                    permanent: true,
                },
            },
        }, { parent: this });

        // Create security chains for different security levels
        this.securityChains = {
            [SecurityLevel.Public]: new k8s.apiextensions.CustomResource(`${name}-chain-public`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: `${name}-chain-public`,
                    namespace: namespace,
                },
                spec: {
                    chain: {
                        middlewares: [
                            {
                                name: this.cookieMiddleware.metadata.name,
                            },
                            {
                                name: this.redirectMiddleware.metadata.name,
                            },
                        ],
                    },
                },
            }, { parent: this }),

            [SecurityLevel.BasicAuth]: new k8s.apiextensions.CustomResource(`${name}-chain-basic`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: `${name}-chain-basic`,
                    namespace: namespace,
                },
                spec: {
                    chain: {
                        middlewares: [
                            {
                                name: this.forwardAuthMiddleware.metadata.name,
                            },
                            {
                                name: this.headerMiddleware.metadata.name,
                            },
                            {
                                name: this.cookieMiddleware.metadata.name,
                            },
                            {
                                name: this.redirectMiddleware.metadata.name,
                            },
                        ],
                    },
                },
            }, { parent: this }),

            [SecurityLevel.TwoFactor]: new k8s.apiextensions.CustomResource(`${name}-chain-2fa`, {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: `${name}-chain-2fa`,
                    namespace: namespace,
                },
                spec: {
                    chain: {
                        middlewares: [
                            {
                                name: this.forwardAuthMiddleware.metadata.name,
                            },
                            {
                                name: this.headerMiddleware.metadata.name,
                            },
                            {
                                name: this.cookieMiddleware.metadata.name,
                            },
                            {
                                name: this.redirectMiddleware.metadata.name,
                            },
                        ],
                    },
                },
            }, { parent: this }),
        };

        this.registerOutputs({
            forwardAuthMiddlewareName: this.forwardAuthMiddleware.metadata.name,
            cookieMiddlewareName: this.cookieMiddleware.metadata.name,
            headerMiddlewareName: this.headerMiddleware.metadata.name,
            redirectMiddlewareName: this.redirectMiddleware.metadata.name,
            securityChainNames: Object.entries(this.securityChains).reduce((acc, [level, chain]) => ({
                ...acc,
                [level]: chain.metadata.name,
            }), {}),
        });
    }

    // Helper method to get middleware annotations for ingress routes
    public getIngressAnnotations(securityLevel: SecurityLevel): pulumi.Output<{[key: string]: string}> {
        const chain = this.securityChains[securityLevel];
        return pulumi.all([this.namespace, chain.metadata.name]).apply(
            ([ns, chainName]) => ({
                "traefik.ingress.kubernetes.io/router.middlewares": `${ns}-${chainName}@kubernetescrd`,
                "traefik.ingress.kubernetes.io/router.tls": "true",
                "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
            })
        );
    }

    // Helper method to create a new IngressRoute with authentication
    public createSecureIngressRoute(
        name: string,
        domain: string,
        service: string,
        port: number,
        securityLevel: SecurityLevel,
        namespace: string
    ): k8s.apiextensions.CustomResource {
        return new k8s.apiextensions.CustomResource(
            `${name}-ingress`,
            {
                apiVersion: "traefik.containo.us/v1alpha1",
                kind: "IngressRoute",
                metadata: {
                    name: name,
                    namespace: namespace,
                },
                spec: {
                    entryPoints: ["websecure"],
                    routes: [{
                        match: `Host(\`${domain}\`)`,
                        kind: "Rule",
                        services: [{
                            name: service,
                            port: port,
                        }],
                        middlewares: [{
                            name: this.securityChains[securityLevel].metadata.name,
                            namespace: namespace,
                        }],
                    }],
                    tls: {
                        certResolver: "letsencrypt",
                    },
                },
            },
            { parent: this }
        );
    }
}
