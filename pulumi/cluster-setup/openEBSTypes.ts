import * as k8s from "@pulumi/kubernetes";

/**
 * Input properties for the OpenEBS component
 */
export interface OpenEBSArgs {
    /**
     * The namespace to deploy OpenEBS into
     * @default "openebs"
     */
    namespace?: string;

    /**
     * The version of OpenEBS to deploy
     * @default "3.9.0"
     */
    version?: string;

    /**
     * Resource requests and limits for OpenEBS components
     * @default - see defaultResourceSettings
     */
    resources?: OpenEBSResourceSettings;

    /**
     * Whether to create custom storage classes
     * @default true
     */
    createStorageClasses?: boolean;

    /**
     * Node selectors for the storage nodes
     * If provided, LocalPV storage classes will use these node selectors
     */
    storageNodeSelectors?: Record<string, string>;

    /**
     * Base path for hostPath local volumes
     * @default "/var/openebs/local"
     */
    localStoragePath?: string;

    /**
     * Optional prefix for resources created by this component
     */
    namePrefix?: string;
}

/**
 * Resource settings for OpenEBS components
 */
export interface OpenEBSResourceSettings {
    ndm: k8s.types.input.core.v1.ResourceRequirements;
    provisioner: k8s.types.input.core.v1.ResourceRequirements;
    localProvisioner: k8s.types.input.core.v1.ResourceRequirements;
}

/**
 * Default resource settings suitable for a homelab environment
 */
export const defaultResourceSettings: OpenEBSResourceSettings = {
    ndm: {
        requests: {
            cpu: "50m",
            memory: "100Mi",
        },
        limits: {
            cpu: "100m",
            memory: "200Mi",
        },
    },
    provisioner: {
        requests: {
            cpu: "50m",
            memory: "100Mi",
        },
        limits: {
            cpu: "100m",
            memory: "200Mi",
        },
    },
    localProvisioner: {
        requests: {
            cpu: "50m",
            memory: "75Mi",
        },
        limits: {
            cpu: "100m",
            memory: "150Mi",
        },
    },
}
