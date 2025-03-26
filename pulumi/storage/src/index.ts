import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { OpenEBS } from "./components/openEBS";
import { StorageClasses } from "./components/storageClasses";
import { config } from "./config";

/**
 * Main setup function for storage infrastructure on K3s homelab cluster
 * Deploys and configures OpenEBS and related storage classes
 */
export async function setup(): Promise<Record<string, pulumi.Output<string>>> {
    try {
        pulumi.log.info("Starting storage infrastructure deployment...");

        // Create Kubernetes provider using the kubeconfig from cluster-setup
        const k8sProvider = new k8s.Provider("k8s-provider", {
            kubeconfig: config.requireSecret("kubeconfig"),
        });
        pulumi.log.info("Kubernetes provider initialized for storage deployment");

        // Install OpenEBS
        const openEBSVersion = config.get("openEBSVersion") || "3.3.0";
        pulumi.log.info(`Deploying OpenEBS version ${openEBSVersion}...`);
        const openEBS = new OpenEBS("openebs", {
            namespace: "openebs",
            version: openEBSVersion,
            createNamespace: true,
        }, { provider: k8sProvider });

        // Setup storage classes
        pulumi.log.info("Configuring storage classes...");
        const storageClasses = new StorageClasses("storage-classes", {
            localPathClass: config.getBoolean("enableLocalPath") ?? true,
            jivaCsiClass: config.getBoolean("enableJivaCsi") ?? true,
        }, {
            provider: k8sProvider,
            dependsOn: [openEBS],
        });

        // Define stack outputs
        const outputs = {
            openEBSStatus: openEBS.status,
            defaultStorageClass: storageClasses.defaultClass,
            kubernetesCluster: pulumi.interpolate`Connected to K3s cluster via kubeconfig`,
            storageDeploymentTimestamp: pulumi.output(new Date().toISOString()),
        };

        pulumi.log.info("Storage infrastructure deployment completed successfully");
        return outputs;
    } catch (error) {
        pulumi.log.error(`Failed to deploy storage infrastructure: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

// Export the outputs from setup
export const storageInfrastructure = setup();
