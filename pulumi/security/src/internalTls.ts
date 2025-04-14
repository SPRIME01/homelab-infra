import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

// Define the arguments for the InternalTls component
export interface InternalTlsArgs {
    /**
     * The namespace where cert-manager will be installed.
     * Defaults to "cert-manager".
     */
    certManagerNamespace?: pulumi.Input<string>;

    /**
     * The name for the self-signed ClusterIssuer.
     * Defaults to "selfsigned-ca-issuer".
     */
    caIssuerName?: pulumi.Input<string>;

    /**
     * The common name for the self-signed CA certificate.
     * Defaults to "homelab-internal-ca".
     */
    caCommonName?: pulumi.Input<string>;

    /**
     * The duration for the CA certificate validity (e.g., "87600h" for 10 years).
     * Defaults to "43800h" (5 years).
     */
    caDuration?: pulumi.Input<string>;

    /**
     * Optional Helm chart values for the cert-manager deployment.
     */
    certManagerHelmValues?: pulumi.Input<object>;
}

/**
 * Configures internal TLS for a Kubernetes homelab environment using cert-manager.
 *
 * This component:
 * 1. Installs cert-manager using its Helm chart.
 * 2. Creates a self-signed ClusterIssuer to act as a private Certificate Authority (CA).
 * 3. Provides the necessary foundation for issuing internal TLS certificates.
 *
 * Note: Mutual TLS (mTLS) enforcement and specific TLS policies (version, cipher suites)
 * are typically configured at the ingress controller level (e.g., Nginx, Traefik)
 * or within a service mesh (e.g., Istio, Linkerd), not directly by this component.
 * Cert-manager handles automatic certificate rotation based on the certificate's duration.
 */
export class InternalTls extends pulumi.ComponentResource {
    public readonly certManagerNamespace: pulumi.Output<string>;
    public readonly caIssuerName: pulumi.Output<string>;
    public readonly certManagerChart: k8s.helm.v3.Chart;
    public readonly caIssuer: k8s.apiextensions.CustomResource;
    public readonly caCertificateSecretName: pulumi.Output<string>;

    constructor(name: string, args: InternalTlsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:security:InternalTls", name, args, opts);

        const certManagerNamespaceName = args.certManagerNamespace ?? "cert-manager";
        const caIssuerName = args.caIssuerName ?? "selfsigned-ca-issuer";
        const caCommonName = args.caCommonName ?? "homelab-internal-ca";
        const caDuration = args.caDuration ?? "43800h"; // 5 years
        const caSecretName = `${caIssuerName}-root-ca`; // Secret where the CA cert/key will be stored

        this.certManagerNamespace = pulumi.output(certManagerNamespaceName);
        this.caIssuerName = pulumi.output(caIssuerName);
        this.caCertificateSecretName = pulumi.output(caSecretName);

        // Create the cert-manager namespace if it doesn't exist
        const ns = new k8s.core.v1.Namespace(certManagerNamespaceName, {
            metadata: { name: certManagerNamespaceName },
        }, { parent: this });

        // Install cert-manager using the Helm chart
        this.certManagerChart = new k8s.helm.v3.Chart("cert-manager", {
            chart: "cert-manager",
            version: "v1.14.5", // Use a specific, known-good version
            namespace: certManagerNamespaceName,
            fetchOpts: {
                repo: "https://charts.jetstack.io",
            },
            // CRDs are installed automatically by the chart if installCRDs is true
            values: pulumi.all([args.certManagerHelmValues ?? {}]).apply(([values]) => ({
                installCRDs: true,
                // Spread any additional user-provided values
                ...values,
            })),
        }, { parent: this, dependsOn: [ns] });

        // Create a self-signed ClusterIssuer to act as the internal CA
        // This depends on the cert-manager CRDs being available, which the Helm chart handles.
        this.caIssuer = new k8s.apiextensions.CustomResource(caIssuerName, {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
                name: caIssuerName,
            },
            spec: {
                selfSigned: {
                    // The CA certificate details
                    // This will generate a self-signed CA certificate stored in the specified secret
                    // It doesn't directly create a Certificate resource for the CA itself in this setup,
                    // but rather configures the issuer to use self-signing.
                    // The actual CA keypair is generated internally by cert-manager and stored.
                    // To make the CA cert easily accessible, we create a Certificate resource below.
                }
            }
        }, { parent: this, dependsOn: [this.certManagerChart] });

        // Create a Certificate resource specifically for the CA itself.
        // This makes the CA certificate easily retrievable from a Kubernetes Secret.
        const caCertificate = new k8s.apiextensions.CustomResource(`${caIssuerName}-ca-certificate`, {
            apiVersion: "cert-manager.io/v1",
            kind: "Certificate",
            metadata: {
                name: `${caIssuerName}-ca`,
                namespace: certManagerNamespaceName, // Store the CA cert secret in the cert-manager namespace
            },
            spec: {
                isCA: true,
                commonName: caCommonName,
                duration: caDuration,
                secretName: caSecretName, // Secret to store the CA cert and key
                privateKey: {
                    algorithm: "ECDSA",
                    size: 256,
                },
                issuerRef: {
                    name: caIssuerName,
                    kind: "ClusterIssuer",
                    group: "cert-manager.io",
                },
            }
        }, { parent: this, dependsOn: [this.caIssuer] });


        // Register outputs
        this.registerOutputs({
            certManagerNamespace: this.certManagerNamespace,
            caIssuerName: this.caIssuerName,
            certManagerChartResources: this.certManagerChart.resources,
            caIssuer: this.caIssuer,
            caCertificateSecretName: this.caCertificateSecretName,
        });
    }

    /**
     * Helper method to create a Certificate resource for a service.
     *
     * @param name The Pulumi resource name for the certificate.
     * @param args Arguments for the certificate.
     * @param opts Optional Pulumi resource options.
     * @returns A cert-manager Certificate resource.
     */
    public createCertificate(name: string, args: CertificateArgs, opts?: pulumi.CustomResourceOptions): k8s.apiextensions.CustomResource {
        return new k8s.apiextensions.CustomResource(name, {
            apiVersion: "cert-manager.io/v1",
            kind: "Certificate",
            metadata: {
                name: args.certificateName,
                namespace: args.namespace,
            },
            spec: {
                secretName: args.secretName,
                dnsNames: args.dnsNames,
                issuerRef: {
                    name: this.caIssuerName, // Use the internal CA Issuer created by this component
                    kind: "ClusterIssuer",
                    group: "cert-manager.io",
                },
                duration: args.duration ?? "2160h", // Default to 90 days
                renewBefore: args.renewBefore ?? "360h", // Default to 15 days before expiry
                privateKey: {
                    algorithm: "ECDSA",
                    size: 256,
                },
                // Add usages like 'server auth', 'client auth' if needed for mTLS
                usages: args.usages ?? ["server auth", "client auth"],
            }
        }, { parent: this, ...opts });
    }
}

// Arguments for the createCertificate helper method
export interface CertificateArgs {
    /**
     * The name of the Certificate resource itself.
     */
    certificateName: pulumi.Input<string>;
    /**
     * The namespace where the Certificate resource and the resulting Secret will be created.
     */
    namespace: pulumi.Input<string>;
    /**
     * The name of the Kubernetes Secret where the TLS certificate and key will be stored.
     */
    secretName: pulumi.Input<string>;
    /**
     * List of DNS names the certificate should be valid for.
     */
    dnsNames: pulumi.Input<pulumi.Input<string>[]>;
    /**
     * The duration for the certificate validity (e.g., "2160h" for 90 days).
     * Defaults to "2160h".
     */
    duration?: pulumi.Input<string>;
    /**
     * How long before expiration the certificate should be renewed (e.g., "360h" for 15 days).
     * Defaults to "360h".
     */
    renewBefore?: pulumi.Input<string>;
    /**
     * Key usages for the certificate. Defaults to ["server auth", "client auth"].
     * Useful for enabling mTLS.
     */
    usages?: pulumi.Input<pulumi.Input<string>[]>;
}

/*
Example Usage:

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { InternalTls } from "./internalTls"; // Assuming this file is saved as internalTls.ts

// 1. Create the Internal TLS infrastructure (cert-manager, CA Issuer)
const internalTls = new InternalTls("homelab-internal-tls", {
    certManagerNamespace: "cert-manager-system", // Optional: customize namespace
    caIssuerName: "homelab-ca",               // Optional: customize issuer name
    caCommonName: "My Homelab Internal CA",   // Optional: customize CA name
});

// 2. Example: Issue a certificate for a web service 'my-app' in namespace 'apps'
const myAppCert = internalTls.createCertificate("my-app-tls-cert", {
    certificateName: "my-app-tls",
    namespace: "apps", // Namespace of your application
    secretName: "my-app-tls-secret", // Secret to store the cert/key
    dnsNames: [
        "my-app.apps.svc.cluster.local", // Internal service DNS name
        "my-app.apps.svc",
        "my-app.apps",
        "my-app"
    ],
    duration: "8760h", // 1 year duration for this specific cert
});

// 3. Example: Issue a certificate for a gRPC service 'my-grpc-service' in namespace 'backend'
//    This might require specific usages if mTLS is strictly enforced by the gRPC server/client.
const myGrpcCert = internalTls.createCertificate("my-grpc-tls-cert", {
    certificateName: "my-grpc-service-tls",
    namespace: "backend",
    secretName: "my-grpc-service-tls-secret",
    dnsNames: ["my-grpc-service.backend.svc.cluster.local"],
    usages: ["server auth", "client auth"], // Explicitly define for potential mTLS
});

// Now you can use 'my-app-tls-secret' and 'my-grpc-service-tls-secret'
// in your Deployment's volumeMounts and configure your application or ingress
// controller to use these TLS certificates.

// Export the CA certificate secret name if needed elsewhere
export const caSecret = internalTls.caCertificateSecretName;
export const caIssuer = internalTls.caIssuerName;

*/
