import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { OpenEBS } from "../components/openEBS";

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

describe("OpenEBS", () => {
    let provider: k8s.Provider;

    beforeAll(() => {
        // Create a mock provider
        provider = new k8s.Provider("test-provider", {
            kubeconfig: "test-kubeconfig",
            context: "test-context",
        });
    });

    test("creates operator namespace and operatorgroup", async () => {
        const namespace = "openebs-system";
        const openEBS = new OpenEBS("test-openebs", {
            namespace: namespace,
            version: "3.8.0",
            createNamespace: true,
        }, { provider });

        await pulumi.runtime.resourcePromises();

        // Verify operator namespace
        const namespaceResource = openEBS.namespace;
        await namespaceResource.metadata.apply(metadata => {
            expect(metadata.name).toBe(namespace);
            expect(metadata.labels["operators.coreos.com/openebs-operator.openebs-system"]).toBe("");
        });

        // Verify operatorgroup
        const operatorGroup = openEBS.operatorGroup;
        await operatorGroup.metadata.apply(metadata => {
            expect(metadata.namespace).toBe(namespace);
            expect(metadata.name).toBe("openebs-operatorgroup");
        });
    });

    test("creates operator subscription with correct configuration", async () => {
        const mockCustomResource = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.apiextensions.CustomResource(name, args, opts);
        });
        k8s.apiextensions.CustomResource = mockCustomResource as any;

        const openEBS = new OpenEBS("test-openebs-operator", {
            namespace: "openebs-system",
            version: "3.8.0",
            createNamespace: true,
        }, { provider });

        await pulumi.runtime.resourcePromises();

        let subscriptionCreated = false;
        for (const call of mockCustomResource.mock.calls) {
            if (
                call[1]?.kind === "Subscription" &&
                call[1]?.apiVersion === "operators.coreos.com/v1alpha1"
            ) {
                subscriptionCreated = true;
                expect(call[1].metadata.namespace).toBe("openebs-system");
                expect(call[1].spec.name).toBe("openebs");
                expect(call[1].spec.source).toBe("operatorhubio-catalog");
                expect(call[1].spec.sourceNamespace).toBe("olm");
                expect(call[1].spec.installPlanApproval).toBe("Automatic");
                expect(call[1].spec.config?.env).toContainEqual({
                    name: "OPENEBS_IO_ENABLE_ANALYTICS",
                    value: "false"
                });
            }
        }
        expect(subscriptionCreated).toBe(true);

        k8s.apiextensions.CustomResource = k8s.apiextensions.CustomResource;
    });

    test("creates required CRDs", async () => {
        const mockCustomResourceDefinition = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.apiextensions.v1.CustomResourceDefinition(name, args, opts);
        });
        k8s.apiextensions.v1.CustomResourceDefinition = mockCustomResourceDefinition as any;

        const openEBS = new OpenEBS("test-openebs-crds", {
            namespace: "openebs-system",
            version: "3.8.0",
            createNamespace: true,
        }, { provider });

        await pulumi.runtime.resourcePromises();

        const expectedCRDs = [
            "blockdevices.openebs.io",
            "blockdeviceclaims.openebs.io",
            "cstorpoolclusters.cstor.openebs.io",
            "cstorpools.openebs.io",
            "cstorvolumes.openebs.io",
            "cstorvolumeclaims.openebs.io"
        ];

        for (const crd of expectedCRDs) {
            let crdCreated = false;
            for (const call of mockCustomResourceDefinition.mock.calls) {
                if (call[1]?.metadata?.name === crd) {
                    crdCreated = true;
                    expect(call[1].spec.scope).toBe("Namespaced");
                    expect(call[1].spec.group).toContain("openebs.io");
                    break;
                }
            }
            expect(crdCreated).toBe(true);
        }

        k8s.apiextensions.v1.CustomResourceDefinition = k8s.apiextensions.v1.CustomResourceDefinition;
    });

    test("configures storage pools correctly", async () => {
        const mockCustomResource = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.apiextensions.CustomResource(name, args, opts);
        });
        k8s.apiextensions.CustomResource = mockCustomResource as any;

        const openEBS = new OpenEBS("test-openebs-pools", {
            namespace: "openebs-system",
            version: "3.8.0",
            createNamespace: true,
            storageConfig: {
                defaultPath: "/var/openebs/local",
                nodeSelector: {
                    "openebs.io/storage": "true"
                }
            }
        }, { provider });

        await pulumi.runtime.resourcePromises();

        let poolConfigCreated = false;
        for (const call of mockCustomResource.mock.calls) {
            if (
                call[1]?.kind === "StoragePoolConfig" &&
                call[1]?.apiVersion === "openebs.io/v1alpha1"
            ) {
                poolConfigCreated = true;
                expect(call[1].metadata.name).toBe("default-pool-config");
                expect(call[1].spec.path).toBe("/var/openebs/local");
                expect(call[1].spec.nodeSelector).toEqual({
                    "openebs.io/storage": "true"
                });
            }
        }
        expect(poolConfigCreated).toBe(true);

        k8s.apiextensions.CustomResource = k8s.apiextensions.CustomResource;
    });

    test("creates default storage class", async () => {
        const mockStorageClass = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.storage.v1.StorageClass(name, args, opts);
        });
        k8s.storage.v1.StorageClass = mockStorageClass as any;

        const openEBS = new OpenEBS("test-openebs-storageclass", {
            namespace: "openebs-system",
            version: "3.8.0",
            createNamespace: true,
            defaultStorageClass: {
                name: "openebs-default",
                isDefault: true,
                replicaCount: 3,
                capacity: "10Gi"
            }
        }, { provider });

        await pulumi.runtime.resourcePromises();

        let storageClassCreated = false;
        for (const call of mockStorageClass.mock.calls) {
            if (call[1]?.metadata?.name === "openebs-default") {
                storageClassCreated = true;
                expect(call[1].metadata.annotations["storageclass.kubernetes.io/is-default-class"]).toBe("true");
                expect(call[1].provisioner).toBe("openebs.io/local");
                expect(call[1].parameters.replicaCount).toBe("3");
                expect(call[1].parameters.capacity).toBe("10Gi");
            }
        }
        expect(storageClassCreated).toBe(true);

        k8s.storage.v1.StorageClass = k8s.storage.v1.StorageClass;
    });
});
