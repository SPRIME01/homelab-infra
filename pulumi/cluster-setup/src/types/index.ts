import * as k8s from "@pulumi/kubernetes";

/**
 * Common resource options
 */
export interface CommonResourceOptions {
    provider?: k8s.Provider;
    dependsOn?: pulumi.Resource[];
    namespace?: string;
    tags?: {[key: string]: string};
}

/**
 * Component output interface
 */
export interface ComponentOutput {
    name: string;
    status?: pulumi.Output<string>;
    endpoint?: pulumi.Output<string>;
}
