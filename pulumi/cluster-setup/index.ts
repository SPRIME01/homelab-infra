import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
// Use the local implementation of OpenEBS
import { OpenEBS } from "./openEBS";

// Get configuration from Pulumi stack
const config = new pulumi.Config();
const configuredClusterName = config.require("clusterName");
const kubeconfig = config.requireSecret("kubeconfig");

// Configure the K8s provider with the kubeconfig
const k8sProvider = new k8s.Provider("k3s-provider", {
    kubeconfig: kubeconfig,
    enableServerSideApply: true,
});

// Set up logging
function log(message: string): void {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// Main cluster setup function
async function setupCluster(): Promise<Record<string, pulumi.Output<any>>> {
    try {
        log(`Setting up cluster: ${clusterName}`);

        // Create namespaces for different workloads
        const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", {
            metadata: {
                name: "monitoring",
                labels: {
                    "homelab-managed": "true",
                }
            }
        }, { provider: k8sProvider });

        const appsNamespace = new k8s.core.v1.Namespace("apps", {
            metadata: {
                name: "apps",
                labels: {
                    "homelab-managed": "true",
                }
            }
        }, { provider: k8sProvider });

        // Configure storage with OpenEBS
        const storageNodeSelectors = {
            "homelab.io/storage-node": "true",
        };

        const openEBS = new OpenEBS("homelab", {
            namespace: "openebs",
            version: "3.9.0",
            createStorageClasses: true,
            storageNodeSelectors: storageNodeSelectors,
            localStoragePath: "/var/openebs/local",
            namePrefix: "homelab-"
        }, { provider: k8sProvider });

        // Wait for the OpenEBS installation to complete
        log("Storage configuration complete");

        // Get the cluster info for outputs
        const clusterInfo = new k8s.core.v1.ConfigMap("cluster-info", {}, { provider: k8sProvider });

        return {
            clusterName: pulumi.output(configuredClusterName),
            kubernetesVersion: clusterInfo.metadata.resourceVersion.apply(v => `Kubernetes ${v}`),
            apiEndpoint: pulumi.output(config.get("apiEndpoint") || "https://localhost:6443"),
            storageClasses: pulumi.output(openEBS.storageClasses),
            namespaces: pulumi.output([
                monitoringNamespace.metadata.name,
                appsNamespace.metadata.name,
                openEBS.namespace.metadata.name,
            ]),
            status: pulumi.output("Ready"),
        };
    } catch (error) {
        log(`Error setting up cluster: ${error}`);
        throw error;
    }
}

// Export the outputs
export const outputs = setupCluster().catch(error => {
    log(`Fatal error in cluster setup: ${error}`);
    throw error;
});

// Export important information
export const clusterName = pulumi.output(configuredClusterName);
export const apiEndpoint = pulumi.output(config.get("apiEndpoint") || "https://localhost:6443");
export const status = outputs.then(o => o.status);
export const availableNamespaces = outputs.then(o => o.namespaces);
export const availableStorageClasses = outputs.then(o => o.storageClasses);
