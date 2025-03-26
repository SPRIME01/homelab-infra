import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Configuration for the Kubernetes provider
 */
const config = new pulumi.Config();
const kubeconfig = config.get("kubeconfig") || path.join(os.homedir(), ".kube", "config");
const context = config.get("context") || "";
const namespace = config.get("namespace") || "default";

/**
 * Create and export a Kubernetes provider that uses the local kubeconfig file
 */
let k8sProvider: k8s.Provider;

try {
    // Verify that the kubeconfig file exists
    if (!fs.existsSync(kubeconfig)) {
        throw new Error(`Kubeconfig file not found: ${kubeconfig}`);
    }

    // Create the Kubernetes provider
    k8sProvider = new k8s.Provider("k3s-provider", {
        kubeconfig: fs.readFileSync(kubeconfig).toString(),
        context: context || undefined,
        namespace: namespace || undefined,
    });

    console.log(`Successfully configured Kubernetes provider with kubeconfig: ${kubeconfig}`);
} catch (error) {
    if (error instanceof Error) {
        console.error(`Failed to configure Kubernetes provider: ${error.message}`);
    } else {
        console.error(`Failed to configure Kubernetes provider with unknown error`);
    }
    throw error;
}

// Export the provider for use in other modules
export const provider = k8sProvider;

// Export additional information that might be useful for other modules
export const defaultNamespace = namespace;
export const kubeconfigPath = kubeconfig;
