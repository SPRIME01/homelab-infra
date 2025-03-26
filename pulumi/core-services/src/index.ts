import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { CertManager } from "./components/certManager";
import { Traefik } from "./components/traefik";
import { config } from "./config";

/**
 * Main setup function for core services
 */
export async function setup(): Promise<Record<string, pulumi.Output<string>>> {
    try {
        pulumi.log.info("Starting core services deployment...");

        // Create Kubernetes provider using the kubeconfig from cluster-setup
        const k8sProvider = new k8s.Provider("k8s-provider", {
            kubeconfig: config.requireSecret("kubeconfig"),
        });
        pulumi.log.info("Kubernetes provider initialized");

        // Install cert-manager
        const certManagerVersion = config.get("certManagerVersion") || "v1.12.0";
        pulumi.log.info(`Deploying cert-manager version ${certManagerVersion}...`);
        const certManager = new CertManager("cert-manager", {
            namespace: "cert-manager",
            version: certManagerVersion,
            createNamespace: true,
        }, { provider: k8sProvider });

        // Install Traefik
        const traefikVersion = config.get("traefikVersion") || "23.0.0";
        pulumi.log.info(`Deploying Traefik version ${traefikVersion}...`);
        const traefik = new Traefik("traefik", {
            namespace: "traefik",
            version: traefikVersion,
            createNamespace: true,
            email: config.requireSecret("letsencryptEmail"),
        }, {
            provider: k8sProvider,
            dependsOn: [certManager],
        });

        // Define stack outputs
        const outputs = {
            certManagerStatus: certManager.status,
            traefikEndpoint: traefik.endpoint,
            kubernetesCluster: pulumi.interpolate`Connected to cluster via kubeconfig`,
            deploymentTimestamp: pulumi.output(new Date().toISOString()),
        };

        pulumi.log.info("Core services deployment completed successfully");
        return outputs;
    } catch (error) {
        pulumi.log.error(`Failed to deploy core services: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

// Export the outputs from setup
export const coreServices = setup();
