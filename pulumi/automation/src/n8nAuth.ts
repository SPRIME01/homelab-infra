import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface N8nAuthOptions {
    namespace: pulumi.Input<string>;
    autheliaNamespace: pulumi.Input<string>;
    baseDomain: string;
    n8nServiceName: pulumi.Input<string>;
    ingressClassName?: string;
    sessionDuration?: string;
    accessControlPolicy?: AccessControlPolicy;
}

export enum AccessControlPolicy {
    OneFactorRequired = "one_factor",
    TwoFactorRequired = "two_factor",
}

export class N8nAuth extends pulumi.ComponentResource {
    public readonly middleware: k8s.apiextensions.CustomResource;
    public readonly ingressMiddleware: k8s.apiextensions.CustomResource;

    constructor(
        name: string,
        options: N8nAuthOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:automation:N8nAuth", name, {}, opts);

        const {
            namespace,
            autheliaNamespace,
            baseDomain,
            n8nServiceName,
            ingressClassName = "traefik",
            sessionDuration = "12h",
            accessControlPolicy = AccessControlPolicy.OneFactorRequired,
        } = options;

        // Create a Traefik middleware for Authelia authentication
        this.middleware = new k8s.apiextensions.CustomResource(`${name}-authelia-middleware`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${name}-authelia`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "auth",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            spec: {
                forwardAuth: {
                    address: `http://authelia.${autheliaNamespace}.svc.cluster.local:9091/api/verify?rd=https://auth.${baseDomain}`,
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

        // Create a Traefik middleware for handling Authelia headers in n8n
        this.ingressMiddleware = new k8s.apiextensions.CustomResource(`${name}-header-middleware`, {
            apiVersion: "traefik.containo.us/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: `${name}-headers`,
                namespace: namespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "auth",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            spec: {
                headers: {
                    customRequestHeaders: {
                        "X-N8N-USER-EMAIL": "{{ .Request.Headers.Remote-Email }}",
                        "X-N8N-USER-ID": "{{ .Request.Headers.Remote-User }}",
                        "X-N8N-USER-NAME": "{{ .Request.Headers.Remote-Name }}",
                    },
                },
            },
        }, { parent: this });

        // Create Authelia configuration for n8n access control
        const accessControlConfig = new k8s.core.v1.ConfigMap(`${name}-authelia-config`, {
            metadata: {
                name: `${name}-authelia-access-control`,
                namespace: autheliaNamespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "auth",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            data: {
                [`access_control_n8n.yml`]: pulumi.interpolate`
# Access control rules for n8n
access_control:
  rules:
    # Admin access to n8n (typically for admin users)
    - domain: n8n.${baseDomain}
      policy: ${accessControlPolicy}
      subject:
        - "group:admins"
      resources:
        - "^/.*$"

    # Allow webhook endpoints without authentication
    - domain: n8n.${baseDomain}
      policy: bypass
      resources:
        - "^/webhook/.*$"
        - "^/api/v1/webhook/.*$"
        - "^/healthz$"
        - "^/metrics$"

    # Regular user access (for authorized workflow users)
    - domain: n8n.${baseDomain}
      policy: ${accessControlPolicy}
      subject:
        - "group:n8n-users"
        - "group:admins"
      resources:
        - "^/.*$"

    # Deny all other access by default
    - domain: n8n.${baseDomain}
      policy: deny
`,
            },
        }, { parent: this });

        // Create Authelia session configuration for n8n
        const sessionConfig = new k8s.core.v1.ConfigMap(`${name}-authelia-session`, {
            metadata: {
                name: `${name}-authelia-session`,
                namespace: autheliaNamespace,
                labels: {
                    "app.kubernetes.io/name": name,
                    "app.kubernetes.io/component": "auth",
                    "app.kubernetes.io/managed-by": "pulumi",
                },
            },
            data: {
                [`session_n8n.yml`]: pulumi.interpolate`
# Session configuration for n8n
session:
  cookies:
    - domain: ${baseDomain}
      name: n8n_session
      expiration: ${sessionDuration}
      inactivity: 1h
      same_site: lax
`,
            },
        }, { parent: this });

        // Create Ingress annotations helper function for use with n8n Ingress
        this.registerOutputs({
            getIngressAnnotations: () => ({
                "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
                "traefik.ingress.kubernetes.io/router.middlewares":
                    `${namespace}-${this.middleware.metadata.name}@kubernetescrd,${namespace}-${this.ingressMiddleware.metadata.name}@kubernetescrd`,
                "traefik.ingress.kubernetes.io/router.tls": "true",
            }),
            middlewareName: this.middleware.metadata.name,
            headerMiddlewareName: this.ingressMiddleware.metadata.name,
            accessControlConfigName: accessControlConfig.metadata.name,
            sessionConfigName: sessionConfig.metadata.name,
        });
    }

    // Helper method to get all ingress annotations needed for n8n
    public getIngressAnnotations(): Record<string, string> {
        return {
            "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
            "traefik.ingress.kubernetes.io/router.middlewares":
                `${this.middleware.metadata.namespace}-${this.middleware.metadata.name}@kubernetescrd,` +
                `${this.ingressMiddleware.metadata.namespace}-${this.ingressMiddleware.metadata.name}@kubernetescrd`,
            "traefik.ingress.kubernetes.io/router.tls": "true",
        };
    }
}
