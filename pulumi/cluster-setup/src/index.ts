import * as pulumi from "@pulumi/pulumi";
import { K3sCluster } from "./components/k3sCluster";
import { KubeConfig } from "./components/kubeConfig";
import { config } from "./config";

/**
 * Main setup function for the K3s cluster
 */
export function setup() {
    // Create the K3s cluster
    const cluster = new K3sCluster("k3s", {
        nodeCount: config.getNumber("nodeCount") || 3,
        version: config.get("k3sVersion") || "v1.27.1+k3s1",
        networkCidr: config.get("networkCidr") || "10.42.0.0/16",
    });

    // Generate and export kubeconfig
    const kubeConfig = new KubeConfig("kubeconfig", {
        clusterId: cluster.id,
        endpoint: cluster.endpoint,
    });

    return {
        kubeconfig: kubeConfig.path,
        clusterEndpoint: cluster.endpoint,
        clusterName: cluster.name,
    };
}
