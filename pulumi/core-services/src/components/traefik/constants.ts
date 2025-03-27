import { ResourceConfig } from './types';

/** Default namespace for Traefik deployment */
export const DEFAULT_NAMESPACE = "traefik-system";

/** Default resource requirements */
export const DEFAULT_RESOURCES: ResourceConfig = {
    requests: {
        cpu: "100m",
        memory: "128Mi"
    },
    limits: {
        cpu: "300m",
        memory: "256Mi"
    }
};

/** Default logging level */
export const DEFAULT_LOG_LEVEL = "INFO";

/** Default Traefik operator configuration */
export const OPERATOR_CONFIG = {
    channel: "alpha",
    source: "operatorhubio-catalog",
    sourceNamespace: "olm"
};

/** Default TLS cipher suites for secure configuration */
export const DEFAULT_TLS_CIPHER_SUITES = [
    "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
    "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305",
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256"
];

/** Standard Traefik arguments for secure configuration */
export const DEFAULT_ARGUMENTS = [
    "--api.dashboard=true",
    "--api.insecure=false",
    "--serverstransport.insecureskipverify=true",
    "--providers.kubernetesingress.ingressclass=traefik",
    "--entrypoints.web.http.redirections.entryPoint.to=websecure",
    "--entrypoints.web.http.redirections.entryPoint.scheme=https",
    "--entrypoints.web.http.redirections.entrypoint.permanent=true"
];
