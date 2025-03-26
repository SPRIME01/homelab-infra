import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { Traefik, TraefikArgs } from "../components/traefik";
import { describe, test, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import { Input } from "@pulumi/pulumi";

// Define interfaces for the mock call arguments
interface K8sResourceArgs {
    apiVersion?: Input<string>;
    kind?: string;
    metadata?: {
        name?: string;
        namespace?: string;
    };
    spec?: any;
}

type MockCall = [string, K8sResourceArgs, any];

// Custom matchers
declare global {
    namespace jest {
        interface Matchers<R> {
            toHaveResource(kind: string, apiVersion: string): R;
            toHaveResourceWithProps(kind: string, apiVersion: string, props: Record<string, any>): R;
        }
    }
}

expect.extend({
    toHaveResource(received: MockCall[], kind: string, apiVersion: string) {
        const found = findResourceCall(received, kind, apiVersion);
        return {
            message: () => `expected to find resource of kind ${kind} with apiVersion ${apiVersion}`,
            pass: !!found
        };
    },
    toHaveResourceWithProps(received: MockCall[], kind: string, apiVersion: string, props: Record<string, any>) {
        const found = findResourceCall(received, kind, apiVersion);
        if (!found) {
            return {
                message: () => `expected to find resource of kind ${kind} with apiVersion ${apiVersion}`,
                pass: false
            };
        }
        const matches = Object.entries(props).every(([key, value]) => {
            return JSON.stringify(found[1].spec?.[key]) === JSON.stringify(value);
        });
        return {
            message: () => `expected resource to have properties ${JSON.stringify(props)}`,
            pass: matches
        };
    }
});

// Helper functions
function findResourceCall(calls: MockCall[], kind: string, apiVersion: string) {
    return calls.find(call =>
        call[1]?.kind === kind &&
        call[1]?.apiVersion === apiVersion
    );
}

function createTestArgs(overrides: Partial<TraefikArgs> = {}): TraefikArgs {
    return {
        namespace: "traefik-system",
        createNamespace: true,
        ...overrides
    };
}

// Mock setup
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

// Test environment setup
describe("Traefik", () => {
    let provider: k8s.Provider;
    let mockCustomResource: jest.Mock;
    let originalCustomResource: typeof k8s.apiextensions.CustomResource;

    beforeAll(() => {
        provider = new k8s.Provider("test-provider", {
            kubeconfig: "test-kubeconfig",
            context: "test-context",
        });
    });

    beforeEach(() => {
        mockCustomResource = jest.fn().mockImplementation((name: unknown, args: unknown) => ({
            ...new k8s.apiextensions.CustomResource(name as string, args as k8s.apiextensions.CustomResourceArgs),
            metadata: (args as K8sResourceArgs)?.metadata || {}
        }));
        originalCustomResource = k8s.apiextensions.CustomResource;
        k8s.apiextensions.CustomResource = mockCustomResource as any;
    });

    afterEach(() => {
        k8s.apiextensions.CustomResource = originalCustomResource;
        jest.clearAllMocks();
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    test("creates operator subscription correctly", async () => {
        const args = createTestArgs({ createNamespace: false });
        const traefik = new Traefik("test-subscription", args, { provider });
        await (traefik as any).ready;

        const calls = mockCustomResource.mock.calls as MockCall[];
        expect(calls).toHaveResourceWithProps("Subscription", "operators.coreos.com/v1alpha1", {
            name: "traefik-operator",
            source: "operatorhubio-catalog",
            sourceNamespace: "olm"
        });
    });

    test("creates TraefikController resource correctly", async () => {
        const args = createTestArgs({
            config: {
                replicas: 2,
                logging: { level: "INFO" },
                resources: {
                    requests: { cpu: "100m", memory: "128Mi" },
                    limits: { cpu: "300m", memory: "256Mi" }
                }
            }
        });

        const traefik = new Traefik("test-controller", args, { provider });
        await (traefik as any).ready;

        const calls = mockCustomResource.mock.calls as MockCall[];
        expect(calls).toHaveResourceWithProps("TraefikController", "traefik.io/v1alpha1", {
            config: {
                replicas: 2,
                logging: { level: "INFO" },
                resources: {
                    requests: { cpu: "100m", memory: "128Mi" },
                    limits: { cpu: "300m", memory: "256Mi" }
                }
            }
        });
    });

    test("creates IngressRoute for dashboard correctly", async () => {
        const args = createTestArgs({
            dashboard: {
                enabled: true,
                domain: "traefik.homelab.local",
                auth: {
                    enabled: true,
                    username: "admin",
                    passwordHash: "$2y$05$example.hash.here"
                }
            }
        });

        const traefik = new Traefik("test-dashboard", args, { provider });
        await (traefik as any).ready;

        const calls = mockCustomResource.mock.calls as MockCall[];
        expect(calls).toHaveResource("IngressRoute", "traefik.io/v1alpha1");
        expect(calls).toHaveResource("Middleware", "traefik.io/v1alpha1");

        const ingressRoute = findResourceCall(calls, "IngressRoute", "traefik.io/v1alpha1");
        expect(ingressRoute?.[1].spec.routes[0].match).toBe("Host(`traefik.homelab.local`)");
        expect(ingressRoute?.[1].spec.routes[0].middlewares).toContainEqual({
            name: "traefik-auth",
            namespace: "traefik-system"
        });
    });

    test("creates middlewares correctly", async () => {
        const args = createTestArgs({
            middlewares: {
                headers: {
                    enabled: true,
                    sslRedirect: true,
                    stsSeconds: 315360000
                },
                rateLimit: {
                    enabled: true,
                    average: 100,
                    burst: 50
                }
            }
        });

        const traefik = new Traefik("test-middlewares", args, { provider });
        await (traefik as any).ready;

        const calls = mockCustomResource.mock.calls as MockCall[];
        expect(calls).toHaveResourceWithProps("Middleware", "traefik.io/v1alpha1", {
            headers: {
                sslRedirect: true,
                stsSeconds: 315360000,
                stsIncludeSubdomains: true,
                stsPreload: true,
                forceSTSHeader: true
            }
        });

        expect(calls).toHaveResourceWithProps("Middleware", "traefik.io/v1alpha1", {
            rateLimit: {
                average: 100,
                burst: 50
            }
        });
    });

    test("creates TLSOptions correctly", async () => {
        const args = createTestArgs({
            tls: {
                options: {
                    minVersion: "VersionTLS12",
                    maxVersion: "VersionTLS13",
                    cipherSuites: [
                        "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
                        "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"
                    ]
                }
            }
        });

        const traefik = new Traefik("test-tls", args, { provider });
        await (traefik as any).ready;

        const calls = mockCustomResource.mock.calls as MockCall[];
        expect(calls).toHaveResourceWithProps("TLSOption", "traefik.io/v1alpha1", {
            minVersion: "VersionTLS12",
            maxVersion: "VersionTLS13",
            cipherSuites: [
                "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
                "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"
            ]
        });
    });
});
