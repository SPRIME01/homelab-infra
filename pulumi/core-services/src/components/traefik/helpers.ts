import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { MiddlewareConfig, ResourceConfig } from "./types";
import { DEFAULT_RESOURCES, DEFAULT_LOG_LEVEL } from "./constants";

/**
 * Creates middlewares based on provided configuration
 */
export function createMiddlewares(
    namespace: string,
    config: MiddlewareConfig = {},
    opts?: pulumi.ComponentResourceOptions
): { [key: string]: k8s.apiextensions.CustomResource } {
    const middlewares: { [key: string]: k8s.apiextensions.CustomResource } = {};

    if (config.headers?.enabled) {
        middlewares["headers"] = new k8s.apiextensions.CustomResource("secure-headers", {
            apiVersion: "traefik.io/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: "secure-headers",
                namespace: namespace,
            },
            spec: {
                headers: {
                    sslRedirect: config.headers.sslRedirect,
                    stsSeconds: config.headers.stsSeconds,
                    stsIncludeSubdomains: true,
                    stsPreload: true,
                    forceSTSHeader: true,
                },
            },
        }, opts);
    }

    if (config.rateLimit?.enabled) {
        middlewares["rateLimit"] = new k8s.apiextensions.CustomResource("rate-limit", {
            apiVersion: "traefik.io/v1alpha1",
            kind: "Middleware",
            metadata: {
                name: "rate-limit",
                namespace: namespace,
            },
            spec: {
                rateLimit: {
                    average: config.rateLimit.average,
                    burst: config.rateLimit.burst,
                },
            },
        }, opts);
    }

    return middlewares;
}

/**
 * Validates and merges resource configuration with defaults
 */
export function mergeResourceConfig(resources?: ResourceConfig): ResourceConfig {
    return {
        requests: {
            cpu: resources?.requests?.cpu || DEFAULT_RESOURCES.requests?.cpu,
            memory: resources?.requests?.memory || DEFAULT_RESOURCES.requests?.memory,
        },
        limits: {
            cpu: resources?.limits?.cpu || DEFAULT_RESOURCES.limits?.cpu,
            memory: resources?.limits?.memory || DEFAULT_RESOURCES.limits?.memory,
        },
    };
}

/**
 * Creates authentication middleware if enabled
 */
export function createAuthMiddleware(
    namespace: string,
    username?: string,
    passwordHash?: string,
    opts?: pulumi.ComponentResourceOptions
): k8s.apiextensions.CustomResource | undefined {
    if (!username || !passwordHash) {
        return undefined;
    }

    return new k8s.apiextensions.CustomResource("traefik-auth", {
        apiVersion: "traefik.io/v1alpha1",
        kind: "Middleware",
        metadata: {
            name: "traefik-auth",
            namespace: namespace,
        },
        spec: {
            basicAuth: {
                users: [`${username}:${passwordHash}`],
            },
        },
    }, opts);
}

/**
 * Validates logging configuration
 */
export function validateLogging(level?: string): { level: string } {
    const validLevels = ["DEBUG", "INFO", "WARN", "ERROR"];
    const normalizedLevel = level?.toUpperCase() || DEFAULT_LOG_LEVEL;

    if (!validLevels.includes(normalizedLevel)) {
        throw new Error(`Invalid log level: ${level}. Must be one of: ${validLevels.join(', ')}`);
    }

    return { level: normalizedLevel };
}
