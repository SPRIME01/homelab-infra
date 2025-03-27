import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { jest } from '@jest/globals';
import { TraefikArgs } from '../types';

export interface K8sResourceArgs {
    apiVersion?: string;
    kind?: string;
    metadata?: {
        name?: string;
        namespace?: string;
    };
    spec?: any;
}

export type MockFn = ReturnType<typeof jest.fn>;
export type MockCall = [string, K8sResourceArgs, any];

export function setupPulumiMocks() {
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
}

export function setupMockCustomResource(): {
    mock: MockFn,
    restore: () => void
} {
    const mockCustomResource = jest.fn().mockImplementation((name: unknown, args: unknown) => ({
        ...new k8s.apiextensions.CustomResource(name as string, args as k8s.apiextensions.CustomResourceArgs),
        metadata: (args as K8sResourceArgs)?.metadata || {}
    }));

    const originalCustomResource = k8s.apiextensions.CustomResource;
    k8s.apiextensions.CustomResource = mockCustomResource as any;

    return {
        mock: mockCustomResource,
        restore: () => {
            k8s.apiextensions.CustomResource = originalCustomResource;
        }
    };
}

export function findResourceInCalls(
    calls: MockCall[],
    kind: string,
    apiVersion?: string,
    name?: string
): MockCall | undefined {
    return calls.find(call =>
        call[1].kind === kind &&
        (!apiVersion || call[1].apiVersion === apiVersion) &&
        (!name || call[1].metadata?.name === name)
    );
}

export function createTestArgs(overrides: Partial<TraefikArgs> = {}): TraefikArgs {
    return {
        createNamespace: true,
        ...overrides
    };
}
