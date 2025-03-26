import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { CertManager } from "./components/certManager";
import { Traefik } from "./components/traefik";
import { config } from "./config";

/**
 * Main setup function for core services
 */
export function setup() {
    // Create Kubernetes provider using the kubeconfig from cluster-setup
    const k8sProvider = new k8s.Provider("k8s-provider", {
        kubeconfig: config.requireSecret("kubeconfig"),
    });

    // Install cert-manager
    const certManager = new CertManager("cert-manager", {
        namespace: "cert-manager",
        version: config.get("certManagerVersion") || "v1.12.0",
        createNamespace: true,
    }, { provider: k8sProvider });

    // Install Traefik
    const traefik = new Traefik("traefik", {
        namespace: "traefik",
        version: config.get("traefikVersion") || "23.0.0",
        createNamespace: true,
        email: config.requireSecret("letsencryptEmail"),
    }, {
        provider: k8sProvider,
        dependsOn: [certManager],
    });

    return {
        certManagerStatus: certManager.status,
        traefikEndpoint: traefik.endpoint,
    };
}
