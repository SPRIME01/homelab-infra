import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { OpenEBS } from "./components/openEBS";
import { StorageClasses } from "./components/storageClasses";
import { config } from "./config";

/**
 * Main setup function for storage
 */
export function setup() {
    // Create Kubernetes provider using the kubeconfig from cluster-setup
    const k8sProvider = new k8s.Provider("k8s-provider", {
        kubeconfig: config.requireSecret("kubeconfig"),
    });

    // Install OpenEBS
    const openEBS = new OpenEBS("openebs", {
        namespace: "openebs",
        version: config.get("openEBSVersion") || "3.3.0",
        createNamespace: true,
    }, { provider: k8sProvider });

    // Setup storage classes
    const storageClasses = new StorageClasses("storage-classes", {
        localPathClass: config.getBoolean("enableLocalPath") || true,
        jivaCsiClass: config.getBoolean("enableJivaCsi") || true,
    }, {
        provider: k8sProvider,
        dependsOn: [openEBS],
    });

    return {
        openEBSStatus: openEBS.status,
        defaultStorageClass: storageClasses.defaultClass,
    };
}
