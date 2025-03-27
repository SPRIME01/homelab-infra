import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Configuration for Traefik dashboard
 */
export interface DashboardConfig {
    /** Whether to enable the dashboard */
    enabled?: boolean;
    /** Domain name for the dashboard */
    domain?: string;
    /** Authentication configuration */
    auth?: {
        /** Whether to enable basic auth */
        enabled?: boolean;
        /** Username for basic auth */
        username?: string;
        /** BCrypt hash of the password */
        passwordHash?: string;
    };
}

/**
 * Configuration for Traefik middlewares
 */
export interface MiddlewareConfig {
    /** HTTP headers middleware configuration */
    headers?: {
        enabled?: boolean;
        sslRedirect?: boolean;
        stsSeconds?: number;
    };
    /** Rate limiting middleware configuration */
    rateLimit?: {
        enabled?: boolean;
        average?: number;
        burst?: number;
    };
}

/**
 * TLS configuration options
 */
export interface TLSConfig {
    /** TLS version and cipher configuration */
    options?: {
        minVersion?: string;
        maxVersion?: string;
        cipherSuites?: string[];
    };
}

/**
 * Resource requirements configuration
 */
export interface ResourceConfig {
    requests?: {
        cpu?: string;
        memory?: string;
    };
    limits?: {
        cpu?: string;
        memory?: string;
    };
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
    level?: string;
}

/**
 * Main configuration interface for Traefik
 */
export interface TraefikArgs {
    /** Namespace to deploy Traefik into */
    namespace?: string;
    /** Whether to create the namespace if it doesn't exist */
    createNamespace?: boolean;
    /** Dashboard configuration */
    dashboard?: DashboardConfig;
    /** Middleware configurations */
    middlewares?: MiddlewareConfig;
    /** TLS configuration */
    tls?: TLSConfig;
    /** Number of Traefik replicas */
    replicas?: number;
    /** Logging configuration */
    logging?: LoggingConfig;
    /** Resource requirements */
    resources?: ResourceConfig;
}

/**
 * Output interface for Traefik status
 */
export interface TraefikStatus {
    namespace: string;
    subscription: k8s.apiextensions.CustomResource;
    controller: k8s.apiextensions.CustomResource;
    middlewares: {[key: string]: k8s.apiextensions.CustomResource};
}
