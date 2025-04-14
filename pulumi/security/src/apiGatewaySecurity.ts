import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// --- Configuration Interfaces ---

/**
 * Authentication configuration.
 */
export interface AuthConfig {
    /** Type of authentication (e.g., 'jwt', 'apiKey', 'oauth2-proxy', 'none'). */
    type: pulumi.Input<"jwt" | "apiKey" | "oauth2-proxy" | "none">;
    /** URL for external authentication service (e.g., oauth2-proxy auth endpoint). Required for 'oauth2-proxy'. */
    authUrl?: pulumi.Input<string>;
    /** URL for the sign-in page (e.g., oauth2-proxy sign-in endpoint). */
    signInUrl?: pulumi.Input<string>;
    /** Header name for API Key. Required for 'apiKey'. */
    apiKeyHeader?: pulumi.Input<string>;
    /** Realm for JWT validation. Optional for 'jwt'. */
    jwtRealm?: pulumi.Input<string>;
    /** Other provider-specific auth settings (e.g., required scopes, audience). */
    providerSpecific?: pulumi.Input<Record<string, any>>;
}

/**
 * Rate limiting configuration.
 */
export interface RateLimitConfig {
    /** Requests per period (e.g., 100). */
    requests: pulumi.Input<number>;
    /** Time period (e.g., 's', 'm', 'h'). */
    period: pulumi.Input<"s" | "m" | "h">;
    /** (Optional) Burst allowance. */
    burst?: pulumi.Input<number>;
    /** Key for rate limiting (e.g., 'remote_addr', 'header:X-Forwarded-For'). */
    key?: pulumi.Input<string>; // Implementation specific
}

/**
 * CORS configuration.
 */
export interface CorsConfig {
    /** List of allowed origins (e.g., ["https://frontend.example.com"]). Use ["*"] for any origin (less secure). */
    allowedOrigins: pulumi.Input<string[]>;
    /** List of allowed HTTP methods (e.g., ["GET", "POST", "OPTIONS"]). */
    allowedMethods?: pulumi.Input<string[]>;
    /** List of allowed headers. */
    allowedHeaders?: pulumi.Input<string[]>;
    /** Allow credentials (cookies, authorization headers). */
    allowCredentials?: pulumi.Input<boolean>;
    /** Max age for preflight requests in seconds. */
    maxAge?: pulumi.Input<number>;
}

/**
 * Content Security Policy (CSP) configuration.
 * Defines directives like 'default-src', 'script-src', etc.
 * Example: { "default-src": ["'self'"], "script-src": ["'self'", "https://apis.google.com"] }
 */
export type CspConfig = pulumi.Input<Record<string, pulumi.Input<string[] | string>>>;

/**
 * Security headers configuration.
 * Example: { "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin" }
 */
export type HeadersConfig = pulumi.Input<Record<string, pulumi.Input<string>>>;

/**
 * Defines a security profile with specific configurations.
 */
export interface SecurityProfile {
    /** Authentication settings. Set to { type: 'none' } to disable. */
    auth: pulumi.Input<AuthConfig>;
    /** Rate limiting settings. Set to undefined to disable. */
    rateLimit?: pulumi.Input<RateLimitConfig>;
    /** CORS settings. Set to undefined to disable. */
    cors?: pulumi.Input<CorsConfig>;
    /** Content Security Policy. Set to undefined to disable. */
    csp?: CspConfig;
    /** Custom security headers. */
    headers?: HeadersConfig;
    /** Request validation settings (highly implementation-specific, placeholder). */
    requestValidation?: pulumi.Input<Record<string, any>>; // e.g., OpenAPI spec validation
}

/**
 * Arguments for the ApiGatewaySecurity component.
 */
export interface ApiGatewaySecurityArgs {
    /** Default security profile applied if no specific profile matches. */
    defaultProfile: pulumi.Input<SecurityProfile>;
    /** Named security profiles for different levels of sensitivity (e.g., 'public', 'internal', 'admin'). */
    profiles?: pulumi.Input<Record<string, pulumi.Input<SecurityProfile>>>;
    /** Target gateway type to tailor generated configurations (optional). */
    gatewayType?: pulumi.Input<"nginx" | "traefik" | "generic">;
}

// --- ApiGatewaySecurity Component ---

/**
 * Manages security configurations for API Gateways in Kubernetes.
 *
 * This component generates configuration snippets (like annotations or middleware specs)
 * based on defined security profiles. These snippets should then be applied to the
 * actual gateway resources (e.g., Ingress, Traefik Middleware, Gateway API resources).
 */
export class ApiGatewaySecurity extends pulumi.ComponentResource {
    private readonly args: ApiGatewaySecurityArgs;

    constructor(name: string, args: ApiGatewaySecurityArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:security:ApiGatewaySecurity", name, args, opts);
        this.args = args;
        this.registerOutputs({}); // No direct resources created, outputs generated config
    }

    /**
     * Retrieves a security profile by name, falling back to the default profile.
     */
    private getProfile(profileName?: string): pulumi.Output<SecurityProfile> {
        return pulumi.output(this.args.profiles).apply(profiles => {
            if (profileName && profiles && profiles[profileName]) {
                return profiles[profileName];
            }
            return this.args.defaultProfile;
        });
    }

    /**
     * Generates Nginx Ingress annotations for a given security profile.
     * Note: This requires the Nginx Ingress Controller to be installed and configured
     * to understand these annotations (e.g., external auth, rate limiting).
     *
     * @param profileName Optional name of the profile to use (falls back to default).
     * @returns A Pulumi Output resolving to a map of annotation key-value pairs.
     */
    public generateNginxAnnotations(profileName?: string): pulumi.Output<Record<string, string>> {
        if (this.args.gatewayType && this.args.gatewayType !== "nginx") {
            pulumi.log.warn("Generating Nginx annotations, but gatewayType is not 'nginx'.", this);
        }

        return this.getProfile(profileName).apply(profile => {
            const annotations: Record<string, string> = {};

            // Authentication
            if (profile.auth?.type === "oauth2-proxy" && profile.auth.authUrl) {
                annotations["nginx.ingress.kubernetes.io/auth-url"] = profile.auth.authUrl;
                if (profile.auth.signInUrl) {
                    annotations["nginx.ingress.kubernetes.io/auth-signin"] = profile.auth.signInUrl;
                }
                // Add other auth annotations as needed (e.g., auth-response-headers)
            } else if (profile.auth?.type === "apiKey" && profile.auth.apiKeyHeader) {
                 // API Key auth often needs custom handling or external auth service
                 pulumi.log.warn("Nginx annotation generation for 'apiKey' requires custom setup or external auth.", this);
            }
            // Add JWT validation annotations if using a compatible Nginx module/plugin

            // Rate Limiting (Requires nginx.ingress.kubernetes.io/limit-rpm, etc.)
            if (profile.rateLimit) {
                const periodMultiplier = profile.rateLimit.period === 's' ? 60 : (profile.rateLimit.period === 'h' ? 1/60 : 1);
                annotations["nginx.ingress.kubernetes.io/limit-rpm"] = String(profile.rateLimit.requests * periodMultiplier);
                if (profile.rateLimit.burst) {
                    annotations["nginx.ingress.kubernetes.io/limit-burst-multiplier"] = String(Math.ceil(profile.rateLimit.burst / profile.rateLimit.requests));
                }
                 // Nginx rate limiting annotations are somewhat basic. More complex scenarios might need custom snippets or Lua.
                 // annotations["nginx.ingress.kubernetes.io/limit-connections"] = ...
                 // annotations["nginx.ingress.kubernetes.io/limit-rps"] = ...
            }

            // CORS
            if (profile.cors) {
                annotations["nginx.ingress.kubernetes.io/enable-cors"] = "true";
                annotations["nginx.ingress.kubernetes.io/cors-allow-origin"] = profile.cors.allowedOrigins.join(",");
                if (profile.cors.allowedMethods) {
                    annotations["nginx.ingress.kubernetes.io/cors-allow-methods"] = profile.cors.allowedMethods.join(",");
                }
                if (profile.cors.allowedHeaders) {
                    annotations["nginx.ingress.kubernetes.io/cors-allow-headers"] = profile.cors.allowedHeaders.join(",");
                }
                if (profile.cors.allowCredentials) {
                    annotations["nginx.ingress.kubernetes.io/cors-allow-credentials"] = "true";
                }
                if (profile.cors.maxAge) {
                    annotations["nginx.ingress.kubernetes.io/cors-max-age"] = String(profile.cors.maxAge);
                }
            }

            // Headers & CSP (using configuration snippets)
            let configSnippet = "";
            if (profile.headers) {
                for (const [key, value] of Object.entries(profile.headers)) {
                    configSnippet += `more_set_headers "${key}: ${value}";\n`;
                }
            }
            if (profile.csp) {
                 const cspDirectives = Object.entries(profile.csp)
                    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(" ") : value}`)
                    .join("; ");
                 configSnippet += `more_set_headers "Content-Security-Policy: ${cspDirectives}";\n`;
            }
            if (configSnippet) {
                // Requires 'more_set_headers' module available in Nginx
                annotations["nginx.ingress.kubernetes.io/configuration-snippet"] = configSnippet;
                 pulumi.log.warn("Using configuration-snippet for headers/CSP. Ensure Nginx has necessary modules (e.g., headers-more).", this);
            }

            // Request Validation (Placeholder - Nginx needs specific modules like ModSecurity or Lua)
            if (profile.requestValidation) {
                 pulumi.log.warn("Nginx request validation requires specific modules/configuration not generated automatically.", this);
            }

            return annotations;
        });
    }

    /**
     * Generates a structure suitable for the 'spec' of a Traefik Middleware CRD
     * for security headers and CSP.
     *
     * @param profileName Optional name of the profile to use (falls back to default).
     * @returns A Pulumi Output resolving to the Middleware spec object for headers.
     */
    public generateTraefikHeadersMiddlewareSpec(profileName?: string): pulumi.Output<object | undefined> {
         if (this.args.gatewayType && this.args.gatewayType !== "traefik") {
            pulumi.log.warn("Generating Traefik middleware spec, but gatewayType is not 'traefik'.", this);
        }
        return this.getProfile(profileName).apply(profile => {
            const headersSpec: any = {};
            let hasHeaders = false;

            if (profile.headers) {
                headersSpec.customResponseHeaders = profile.headers;
                hasHeaders = true;
            }
            if (profile.csp) {
                 const cspDirectives = Object.entries(profile.csp)
                    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(" ") : value}`)
                    .join("; ");
                 if (!headersSpec.customResponseHeaders) headersSpec.customResponseHeaders = {};
                 headersSpec.customResponseHeaders["Content-Security-Policy"] = cspDirectives;
                 hasHeaders = true;
            }
            // Add other Traefik header options like sslRedirect, stsHeaders etc. if needed

            return hasHeaders ? { headers: headersSpec } : undefined;
        });
    }

     /**
     * Generates a structure suitable for the 'spec' of a Traefik Middleware CRD
     * for CORS.
     *
     * @param profileName Optional name of the profile to use (falls back to default).
     * @returns A Pulumi Output resolving to the Middleware spec object for CORS.
     */
    public generateTraefikCorsMiddlewareSpec(profileName?: string): pulumi.Output<object | undefined> {
         if (this.args.gatewayType && this.args.gatewayType !== "traefik") {
            pulumi.log.warn("Generating Traefik middleware spec, but gatewayType is not 'traefik'.", this);
        }
        return this.getProfile(profileName).apply(profile => {
            if (!profile.cors) return undefined;

            const corsSpec: any = {
                allowOrigins: profile.cors.allowedOrigins, // Traefik might need specific format like origin-list-regexp
                allowCredentials: profile.cors.allowCredentials ?? false,
                allowMethods: profile.cors.allowedMethods,
                allowHeaders: profile.cors.allowedHeaders,
                maxAge: profile.cors.maxAge,
            };
             // Adjust based on exact Traefik CORS middleware options
             // e.g. allowOrigins -> allowOrigins.static or allowOrigins.regexp
             pulumi.log.warn("Traefik CORS 'allowOrigins' might need adjustment (static vs regexp).", this);


            return { cors: corsSpec }; // Structure depends on exact middleware type (e.g., Headers or dedicated CORS)
                                       // Assuming it's part of the Headers middleware for simplicity here.
                                       // A dedicated CORS middleware might have a different top-level key.
                                       // Let's refine to assume it's part of the 'headers' middleware spec
            return {
                headers: {
                    accessControlAllowOriginList: profile.cors.allowedOrigins, // Or accessControlAllowOriginListRegex
                    accessControlAllowMethods: profile.cors.allowedMethods,
                    accessControlAllowHeaders: profile.cors.allowedHeaders,
                    accessControlMaxAge: profile.cors.maxAge,
                    accessControlAllowCredentials: profile.cors.allowCredentials,
                }
            };
        });
    }


    /**
     * Generates a structure suitable for the 'spec' of a Traefik Middleware CRD
     * for Rate Limiting.
     *
     * @param profileName Optional name of the profile to use (falls back to default).
     * @returns A Pulumi Output resolving to the Middleware spec object for rate limiting.
     */
    public generateTraefikRateLimitMiddlewareSpec(profileName?: string): pulumi.Output<object | undefined> {
         if (this.args.gatewayType && this.args.gatewayType !== "traefik") {
            pulumi.log.warn("Generating Traefik middleware spec, but gatewayType is not 'traefik'.", this);
        }
        return this.getProfile(profileName).apply(profile => {
            if (!profile.rateLimit) return undefined;

            const periodSeconds = profile.rateLimit.period === 's' ? 1 : (profile.rateLimit.period === 'm' ? 60 : 3600);
            const rateLimitSpec = {
                average: profile.rateLimit.requests,
                period: `${periodSeconds}s`, // Traefik expects period as duration string
                burst: profile.rateLimit.burst ?? profile.rateLimit.requests, // Default burst to average if not set
                // sourceCriterion: profile.rateLimit.key ? { ipStrategy: { ... } } : undefined // Needs mapping from key to Traefik sourceCriterion
            };
            if (profile.rateLimit.key) {
                 pulumi.log.warn("Traefik rate limit 'sourceCriterion' mapping from key is not fully implemented.", this);
            }

            return { rateLimit: rateLimitSpec };
        });
    }

     /**
     * Generates a structure suitable for the 'spec' of a Traefik Middleware CRD
     * for Forward Authentication (e.g., using oauth2-proxy).
     *
     * @param profileName Optional name of the profile to use (falls back to default).
     * @returns A Pulumi Output resolving to the Middleware spec object for forward auth.
     */
    public generateTraefikForwardAuthMiddlewareSpec(profileName?: string): pulumi.Output<object | undefined> {
         if (this.args.gatewayType && this.args.gatewayType !== "traefik") {
            pulumi.log.warn("Generating Traefik middleware spec, but gatewayType is not 'traefik'.", this);
        }
        return this.getProfile(profileName).apply(profile => {
            if (profile.auth?.type !== "oauth2-proxy" || !profile.auth.authUrl) {
                return undefined;
            }

            const forwardAuthSpec = {
                address: profile.auth.authUrl,
                trustForwardHeader: true, // Common setting, adjust as needed
                authResponseHeaders: ["X-Auth-Request-User", "X-Auth-Request-Email"], // Common headers from oauth2-proxy
                // Add other options like tls, authRequestHeaders etc.
            };

            return { forwardAuth: forwardAuthSpec };
        });
    }

    // Add methods for other gateway types (Kong, etc.) or other middleware types as needed.
}

/*
Example Usage:

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ApiGatewaySecurity, SecurityProfile } from "./apiGatewaySecurity"; // Adjust path

// Define Security Profiles
const publicProfile: SecurityProfile = {
    auth: { type: "none" },
    rateLimit: { requests: 100, period: "m", burst: 150 },
    cors: { allowedOrigins: ["https://my-frontend.com"] },
    headers: {
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    csp: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://trusted-scripts.com"],
        "style-src": ["'self'", "'unsafe-inline'"], // Example: allow inline styles
        "img-src": ["'self'", "data:"],
    }
};

const internalProfile: SecurityProfile = {
    auth: {
        type: "oauth2-proxy",
        authUrl: "http://oauth2-proxy.security.svc.cluster.local/oauth2/auth",
        signInUrl: "https://auth.homelab.local/oauth2/start?rd=$escaped_request_uri"
    },
    rateLimit: { requests: 1000, period: "m" },
    cors: { allowedOrigins: ["*"] }, // More permissive internally
    headers: { "X-Frame-Options": "DENY" },
    // Less strict CSP for internal services if needed
};

// Create the Security Configuration Manager
const apiSecurity = new ApiGatewaySecurity("homelab-gw-security", {
    defaultProfile: publicProfile, // Public access by default
    profiles: {
        internal: internalProfile,
        admin: { // Example admin profile - stricter auth maybe?
            ...internalProfile, // Inherit from internal
            // Potentially add RBAC checks via auth provider or specific headers
        }
    },
    gatewayType: "nginx", // Or "traefik"
});

// --- Applying the configuration ---

// Example 1: Apply to an Nginx Ingress
const myAppIngress = new k8s.networking.v1.Ingress("my-app-ingress", {
    metadata: {
        name: "my-app",
        namespace: "apps",
        // Generate annotations for the 'internal' profile
        annotations: apiSecurity.generateNginxAnnotations("internal"),
    },
    spec: {
        // ... other ingress spec details (rules, tls, etc.)
        rules: [{
            host: "my-app.homelab.local",
            http: {
                paths: [{
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                        service: {
                            name: "my-app-service",
                            port: { number: 80 },
                        }
                    }
                }]
            }
        }],
        ingressClassName: "nginx", // Make sure this matches your Nginx Ingress controller
    }
});


// Example 2: Generate Specs for Traefik Middlewares (requires Traefik CRDs)
const internalHeadersSpec = apiSecurity.generateTraefikHeadersMiddlewareSpec("internal");
const internalRateLimitSpec = apiSecurity.generateTraefikRateLimitMiddlewareSpec("internal");
const internalForwardAuthSpec = apiSecurity.generateTraefikForwardAuthMiddlewareSpec("internal");

// You would then create Traefik Middleware resources using these specs:
// const internalHeadersMw = new k8s.apiextensions.CustomResource("internal-headers-mw", {
//     apiVersion: "traefik.containo.us/v1alpha1", // Or traefik.io/v1alpha1
//     kind: "Middleware",
//     metadata: { name: "internal-headers", namespace: "apps" },
//     spec: internalHeadersSpec, // Apply the generated spec
// }, { dependsOn: [traefik] }); // Ensure Traefik is set up

// const internalRateLimitMw = ...
// const internalForwardAuthMw = ...

// Then reference these middlewares in a Traefik IngressRoute:
// const myAppIngressRoute = new k8s.apiextensions.CustomResource("my-app-ingressroute", {
//     apiVersion: "traefik.containo.us/v1alpha1",
//     kind: "IngressRoute",
//     metadata: { name: "my-app-route", namespace: "apps" },
//     spec: {
//         entryPoints: ["websecure"],
//         routes: [{
//             match: "Host(`my-app.homelab.local`)",
//             kind: "Rule",
//             services: [{ name: "my-app-service", port: 80 }],
//             middlewares: [
//                 { name: "internal-headers", namespace: "apps" }, // Reference created middlewares
//                 { name: "internal-ratelimit", namespace: "apps" },
//                 { name: "internal-forwardauth", namespace: "apps" },
//             ]
//         }],
//         tls: { secretName: "my-app-tls-secret" } // Assuming TLS is handled
//     }
// });

*/
