import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as fs from "fs";
import * as path from "path";

// Get configuration
const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "homelab";
const domainName = config.get("domainName") || "home.lab";

// Create a k8s provider instance to interact with the cluster
const k8sProvider = new k8s.Provider("k3s", {
    kubeconfig: config.requireSecret("kubeconfig"),
});

// Create namespaces
const certManagerNamespace = new k8s.core.v1.Namespace("cert-manager", {
    metadata: {
        name: "cert-manager",
    },
}, { provider: k8sProvider });

const traefikNamespace = new k8s.core.v1.Namespace("traefik", {
    metadata: {
        name: "traefik",
    },
}, { provider: k8sProvider });

// Deploy Cert Manager CRDs
const certManagerCrds = new k8s.yaml.ConfigFile("cert-manager-crds", {
    file: "https://github.com/cert-manager/cert-manager/releases/download/v1.13.1/cert-manager.crds.yaml",
}, { provider: k8sProvider });

// Deploy Cert Manager
const certManager = new k8s.yaml.ConfigFile("cert-manager", {
    file: "https://github.com/cert-manager/cert-manager/releases/download/v1.13.1/cert-manager.yaml",
    transformations: [(obj: any) => {
        // Make sure all resources are in the cert-manager namespace
        if (obj.metadata) {
            obj.metadata.namespace = "cert-manager";
        }
    }],
}, { provider: k8sProvider, dependsOn: [certManagerNamespace, certManagerCrds] });

// Create ClusterIssuer for Let's Encrypt
const clusterIssuer = new k8s.apiextensions.CustomResource("letsencrypt-prod", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: "letsencrypt-prod",
    },
    spec: {
        acme: {
            server: "https://acme-v02.api.letsencrypt.org/directory",
            email: config.require("email"),
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
}, { provider: k8sProvider, dependsOn: certManager });

// Deploy Traefik CRDs
const traefikCrds = new k8s.yaml.ConfigFile("traefik-crds", {
    file: "https://raw.githubusercontent.com/traefik/traefik/v2.10.4/docs/content/reference/dynamic-configuration/kubernetes-crd-definition-v1.yml",
}, { provider: k8sProvider });

// Deploy Traefik
const traefik = new k8s.apps.v1.Deployment("traefik", {
    metadata: {
        name: "traefik",
        namespace: traefikNamespace.metadata.name,
        labels: {
            app: "traefik",
        },
    },
    spec: {
        replicas: 1,
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
                serviceAccountName: "traefik-account",
                containers: [{
                    name: "traefik",
                    image: "traefik:v2.10.4",
                    args: [
                        "--api.insecure=true",
                        "--providers.kubernetesingress",
                        "--providers.kubernetescrd",
                        "--entrypoints.web.address=:80",
                        "--entrypoints.websecure.address=:443",
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
}, { provider: k8sProvider, dependsOn: [traefikNamespace, traefikCrds] });

// Create Traefik service account
const traefikServiceAccount = new k8s.core.v1.ServiceAccount("traefik-account", {
    metadata: {
        name: "traefik-account",
        namespace: traefikNamespace.metadata.name,
    },
}, { provider: k8sProvider });

// Create Traefik ClusterRole
const traefikClusterRole = new k8s.rbac.v1.ClusterRole("traefik-role", {
    metadata: {
        name: "traefik-role",
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
        {
            apiGroups: ["extensions", "networking.k8s.io"],
            resources: ["ingresses/status"],
            verbs: ["update"],
        },
        {
            apiGroups: ["traefik.containo.us", "traefik.io"],
            resources: ["middlewares", "ingressroutes", "traefikservices", "ingressroutetcps", "ingressrouteudps", "tlsoptions", "tlsstores"],
            verbs: ["get", "list", "watch"],
        },
    ],
}, { provider: k8sProvider });

// Create Traefik ClusterRoleBinding
const traefikClusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("traefik-role-binding", {
    metadata: {
        name: "traefik-role-binding",
    },
    roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: traefikClusterRole.metadata.name,
    },
    subjects: [{
        kind: "ServiceAccount",
        name: traefikServiceAccount.metadata.name,
        namespace: traefikNamespace.metadata.name,
    }],
}, { provider: k8sProvider });

// Create Traefik service
const traefikService = new k8s.core.v1.Service("traefik", {
    metadata: {
        name: "traefik",
        namespace: traefikNamespace.metadata.name,
    },
    spec: {
        type: "LoadBalancer",
        ports: [
            { port: 80, name: "web", targetPort: "web" },
            { port: 443, name: "websecure", targetPort: "websecure" },
            { port: 8080, name: "admin", targetPort: "admin" },
        ],
        selector: {
            app: "traefik",
        },
    },
}, { provider: k8sProvider });

// Export endpoints and information
export const traefikEndpoint = pulumi.interpolate`http://${traefikService.status.loadBalancer.ingress[0].ip || traefikService.status.loadBalancer.ingress[0].hostname}`;
export const certManagerStatus = certManager.ready;
export const traefikDashboard = pulumi.interpolate`${traefikEndpoint}:8080/dashboard/`;
export const apiGatewayDomain = pulumi.interpolate`https://api.${domainName}`;
export const dashboardDomain = pulumi.interpolate`https://dashboard.${domainName}`;
export const clusterIssuerStatus = clusterIssuer.id;
