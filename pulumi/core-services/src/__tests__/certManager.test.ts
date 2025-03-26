import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { CertManager } from "../components/certManager";
import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';
import { Input } from "@pulumi/pulumi";

// Define interfaces for the mock call arguments
interface CustomResourceArgs {
    kind: string;
    apiVersion: string;
    metadata: {
        name?: string;
        namespace?: string;
    };
    spec?: any;
    file?: string;  // For ConfigFile type
}

interface K8sResourceArgs {
    apiVersion?: Input<string>;
    kind?: string;
    metadata?: {
        name?: string;
        namespace?: string;
    };
    spec?: any;
}

interface ConfigFileArgs {
    file?: string;
}

type MockCall = [string, CustomResourceArgs, any];

// Mock the K8s provider and resources
pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs): { id: string, state: any } => {
        return {
            id: `${args.name}-id`,
            state: args.inputs,
        };
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
        return args.inputs;
    },
});

describe("CertManager", () => {
    let provider: k8s.Provider;

    beforeAll(() => {
        provider = new k8s.Provider("test-provider", {
            kubeconfig: "test-kubeconfig",
            context: "test-context",
        });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    test("creates cert-manager with correct configuration", async () => {
        const version = "v1.12.0";
        const namespace = "cert-manager-test";

        const certManager = new CertManager("test-cert-manager", {
            namespace: namespace,
            version: version,
            createNamespace: true,
        }, { provider });

        await new Promise(resolve => setTimeout(resolve, 100));
        expect(certManager).toBeDefined();
    });

    test("does not create namespace when createNamespace is false", async () => {
        const mockNamespace = jest.fn().mockImplementation((name: unknown, args: unknown) => ({
            ...new k8s.core.v1.Namespace(name as string, args as k8s.core.v1.NamespaceArgs),
            metadata: (args as K8sResourceArgs)?.metadata || {}
        }));
        const originalNamespace = k8s.core.v1.Namespace;
        // Use defineProperty to bypass readonly restriction
        Object.defineProperty(k8s.core.v1, 'Namespace', {
            value: mockNamespace
        });

        const namespace = "existing-namespace";
        const certManager = new CertManager("test-cert-manager-no-ns", {
            namespace: namespace,
            version: "v1.12.0",
            createNamespace: false,
        }, { provider });

        await Promise.all(pulumi.output(certManager).allResources);

        let namespaceCreated = false;
        for (const call of mockNamespace.mock.calls as MockCall[]) {
            if (call[0] === "cert-manager-ns" && call[1]?.metadata?.name === namespace) {
                namespaceCreated = true;
                break;
            }
        }
        expect(namespaceCreated).toBe(false);

        // Restore the original Namespace constructor
        Object.defineProperty(k8s.core.v1, 'Namespace', {
            value: originalNamespace
        });
    });

    test("creates correct operator CRDs", async () => {
        const mockConfigFile = jest.fn().mockImplementation((name: unknown, args: unknown) => ({
            ...new k8s.yaml.ConfigFile(name as string, args as k8s.yaml.ConfigFileArgs),
            file: (args as ConfigFileArgs)?.file || ""
        }));
        const originalConfigFile = k8s.yaml.ConfigFile;
        Object.defineProperty(k8s.yaml, 'ConfigFile', {
            value: mockConfigFile
        });

        const namespace = "cert-manager-test";
        const version = "v1.12.0";

        const certManager = new CertManager("test-cert-manager-crds", {
            namespace: namespace,
            version: version,
            createNamespace: true,
        }, { provider });

        await Promise.all(pulumi.output(certManager).allResources);

        let crdsCreated = false;
        for (const call of mockConfigFile.mock.calls as MockCall[]) {
            if (call[0] === "cert-manager-crds") {
                crdsCreated = true;
                expect(call[1].file).toContain(`github.com/cert-manager/cert-manager/releases/download/${version}/`);
                break;
            }
        }
        expect(crdsCreated).toBe(true);

        Object.defineProperty(k8s.yaml, 'ConfigFile', {
            value: originalConfigFile
        });
    });

    test("creates operator deployment correctly", async () => {
        const mockDeployment = jest.fn().mockImplementation((name: string, args: CustomResourceArgs, opts: any) => {
            return {
                ...new k8s.apps.v1.Deployment(name, args, opts),
                metadata: args.metadata || {}
            };
        });
        const originalDeployment = k8s.apps.v1.Deployment;
        Object.defineProperty(k8s.apps.v1, 'Deployment', {
            value: mockDeployment
        });

        const namespace = "cert-manager-test";
        const version = "v1.12.0";

        const certManager = new CertManager("test-cert-manager-deployment", {
            namespace: namespace,
            version: version,
            createNamespace: true,
        }, { provider });

        await Promise.all(pulumi.output(certManager).allResources);

        let controllerDeployed = false;
        for (const call of mockDeployment.mock.calls as MockCall[]) {
            if (call[0].includes("cert-manager-controller") || call[0].includes("cert-manager")) {
                controllerDeployed = true;

                expect(call[1].metadata.namespace).toBe(namespace);
                expect(call[1].spec.selector.matchLabels.app).toContain("cert-manager");

                const containers = call[1].spec.template.spec.containers;
                const controllerContainer = containers.find((c: any) =>
                    c.name === "cert-manager-controller" || c.name === "cert-manager");

                if (controllerContainer) {
                    expect(controllerContainer.image).toContain(version.replace('v', ''));
                }
                break;
            }
        }
        expect(controllerDeployed).toBe(true);

        Object.defineProperty(k8s.apps.v1, 'Deployment', {
            value: originalDeployment
        });
    });

    test("creates letsencrypt cluster issuer correctly", async () => {
        const mockCustomResource = jest.fn().mockImplementation((name: string, args: CustomResourceArgs, opts: any) => {
            return {
                ...new k8s.apiextensions.CustomResource(name, args, opts),
                metadata: args.metadata || {}
            };
        });
        const originalCustomResource = k8s.apiextensions.CustomResource;
        Object.defineProperty(k8s.apiextensions, 'CustomResource', {
            value: mockCustomResource
        });

        const namespace = "cert-manager-test";

        const certManager = new CertManager("test-cert-manager-issuer", {
            namespace: namespace,
            version: "v1.12.0",
            createNamespace: true,
        }, { provider });

        await Promise.all(pulumi.output(certManager).allResources);

        let issuerCreated = false;
        for (const call of mockCustomResource.mock.calls as MockCall[]) {
            if (
                call[0] === "letsencrypt-issuer" &&
                call[1]?.kind === "ClusterIssuer" &&
                call[1]?.apiVersion === "cert-manager.io/v1"
            ) {
                issuerCreated = true;

                expect(call[1].spec.acme.server).toBe("https://acme-v02.api.letsencrypt.org/directory");
                expect(call[1].spec.acme.privateKeySecretRef.name).toBe("letsencrypt-prod-account-key");
                expect(call[1].spec.acme.solvers[0].http01.ingress.class).toBe("traefik");
                break;
            }
        }
        expect(issuerCreated).toBe(true);

        Object.defineProperty(k8s.apiextensions, 'CustomResource', {
            value: originalCustomResource
        });
    });
});
