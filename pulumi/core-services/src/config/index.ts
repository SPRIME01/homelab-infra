import * as pulumi from "@pulumi/pulumi";

// Configuration for the core-services stack
export const config = new pulumi.Config();

// Common configuration values
export const environment = config.require("environment");
export const namespace = config.get("namespace") || "core-services";

// Resource tags
export const tags = {
    "environment": environment,
    "managedBy": "pulumi",
    "project": "core-services"
};
