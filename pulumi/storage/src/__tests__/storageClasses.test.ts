import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { StorageClasses } from "../components/storageClasses";

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

describe("StorageClasses", () => {
    let provider: k8s.Provider;

    beforeAll(() => {
        // Create a mock provider
        provider = new k8s.Provider("test-provider", {
            kubeconfig: "test-kubeconfig",
            context: "test-context",
        });
    });

    test("creates local-path storage class when enabled", async () => {
        const storageClasses = new StorageClasses("test", {
            provider: provider,
            localPath: {
                enabled: true,
                isDefault: true
            }
        });

        const resources = await pulumi.runtime.ResourceSuccessor.from(storageClasses);

        // Verify storage class creation
        expect(resources.filter(r => r instanceof k8s.storage.v1.StorageClass)).toHaveLength(1);

        // Verify operator deployment
        const deployments = resources.filter(r => r instanceof k8s.apps.v1.Deployment);
        expect(deployments).toHaveLength(1);

        const deployment = deployments[0];
        expect(deployment.spec.template.spec.containers[0].image).toContain("local-path-provisioner");
    });

    test("sets correct default storage class annotations", async () => {
        const storageClasses = new StorageClasses("test-default", {
            provider: provider,
            localPath: {
                enabled: true,
                isDefault: true
            }
        });

        const resources = await pulumi.runtime.ResourceSuccessor.from(storageClasses);
        const storageClass = resources.find(r => r instanceof k8s.storage.v1.StorageClass);

        expect(storageClass.metadata.annotations).toEqual(
            expect.objectContaining({
                "storageclass.kubernetes.io/is-default-class": "true"
            })
        );
    });

    test("creates local-path storage class when enabled", async () => {
        // Mock the k8s.storage.v1.StorageClass constructor to track if it's called
        const originalStorageClass = k8s.storage.v1.StorageClass;
        const mockStorageClass = jest.fn().mockImplementation((name, args, opts) => {
            return new originalStorageClass(name, args, opts);
        });
        k8s.storage.v1.StorageClass = mockStorageClass as any;

        // Create the component with localPathClass enabled
        const storageClasses = new StorageClasses("test-storage-classes", {
            localPathClass: true,
            jivaCsiClass: false,
        }, { provider });

        // Wait for resource creation
        await pulumi.runtime.resourcePromises();

        // Verify that StorageClass constructor was called for local-path
        let localPathCreated = false;
        for (const call of mockStorageClass.mock.calls) {
            if (call[0] === "local-path") {
                localPathCreated = true;

                // Check storage class configuration
                expect(call[1].metadata.name).toBe("openebs-hostpath");
                expect(call[1].metadata.annotations["storageclass.kubernetes.io/is-default-class"]).toBe("true");
                expect(call[1].provisioner).toBe("openebs.io/local");
                expect(call[1].reclaimPolicy).toBe("Delete");
                expect(call[1].volumeBindingMode).toBe("WaitForFirstConsumer");
                break;
            }
        }
        expect(localPathCreated).toBe(true);

        // Check that the default class output is set correctly
        await storageClasses.defaultClass.apply(className => {
            expect(className).toBe("openebs-hostpath");
        });

        // Restore the original StorageClass constructor
        k8s.storage.v1.StorageClass = originalStorageClass;
    });

    test("creates jiva-csi storage class when enabled", async () => {
        // Mock the k8s.storage.v1.StorageClass constructor to track if it's called
        const originalStorageClass = k8s.storage.v1.StorageClass;
        const mockStorageClass = jest.fn().mockImplementation((name, args, opts) => {
            return new originalStorageClass(name, args, opts);
        });
        k8s.storage.v1.StorageClass = mockStorageClass as any;

        // Create the component with jivaCsiClass enabled
        const storageClasses = new StorageClasses("test-storage-classes-jiva", {
            localPathClass: false,
            jivaCsiClass: true,
        }, { provider });

        // Wait for resource creation
        await pulumi.runtime.resourcePromises();

        // Verify that StorageClass constructor was called for jiva-csi
        let jivaCsiCreated = false;
        for (const call of mockStorageClass.mock.calls) {
            if (call[0] === "jiva-csi") {
                jivaCsiCreated = true;

                // Check storage class configuration
                expect(call[1].metadata.name).toBe("openebs-jiva-csi");
                expect(call[1].provisioner).toBe("jiva.csi.openebs.io");
                expect(call[1].reclaimPolicy).toBe("Delete");
                expect(call[1].allowVolumeExpansion).toBe(true);
                expect(call[1].parameters["cas-type"]).toBe("jiva");
                expect(call[1].parameters.replicaCount).toBe("3");
                break;
            }
        }
        expect(jivaCsiCreated).toBe(true);

        // Restore the original StorageClass constructor
        k8s.storage.v1.StorageClass = originalStorageClass;
    });

    test("creates both storage classes when both are enabled", async () => {
        // Mock the k8s.storage.v1.StorageClass constructor to track if it's called
        const originalStorageClass = k8s.storage.v1.StorageClass;
        const mockStorageClass = jest.fn().mockImplementation((name, args, opts) => {
            return new originalStorageClass(name, args, opts);
        });
        k8s.storage.v1.StorageClass = mockStorageClass as any;

        // Create the component with both types enabled
        const storageClasses = new StorageClasses("test-storage-classes-both", {
            localPathClass: true,
            jivaCsiClass: true,
        }, { provider });

        // Wait for resource creation
        await pulumi.runtime.resourcePromises();

        // Count how many storage classes were created
        let localPathCreated = false;
        let jivaCsiCreated = false;

        for (const call of mockStorageClass.mock.calls) {
            if (call[0] === "local-path") {
                localPathCreated = true;
            }
            if (call[0] === "jiva-csi") {
                jivaCsiCreated = true;
            }
        }

        expect(localPathCreated).toBe(true);
        expect(jivaCsiCreated).toBe(true);

        // Restore the original StorageClass constructor
        k8s.storage.v1.StorageClass = originalStorageClass;
    });

    test("creates operator subscription correctly", async () => {
        const mockCustomResource = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.apiextensions.CustomResource(name, args, opts);
        });
        k8s.apiextensions.CustomResource = mockCustomResource as any;

        const storageClasses = new StorageClasses("test-subscription", {
            namespace: "storage-operator",
            createNamespace: true,
            operatorVersion: "3.8.0",
        }, { provider });

        await pulumi.runtime.resourcePromises();

        let subscriptionCreated = false;
        for (const call of mockCustomResource.mock.calls) {
            if (
                call[1]?.kind === "Subscription" &&
                call[1]?.apiVersion === "operators.coreos.com/v1alpha1"
            ) {
                subscriptionCreated = true;
                expect(call[1].metadata.namespace).toBe("storage-operator");
                expect(call[1].spec.name).toBe("local-storage-operator");
                expect(call[1].spec.source).toBe("operatorhubio-catalog");
                expect(call[1].spec.sourceNamespace).toBe("olm");
            }
        }
        expect(subscriptionCreated).toBe(true);

        k8s.apiextensions.CustomResource = k8s.apiextensions.CustomResource;
    });

    test("creates local volume resources correctly", async () => {
        const mockCustomResource = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.apiextensions.CustomResource(name, args, opts);
        });
        k8s.apiextensions.CustomResource = mockCustomResource as any;

        const storageClasses = new StorageClasses("test-volumes", {
            namespace: "storage-operator",
            createNamespace: true,
            localVolumes: [{
                name: "local-disks",
                path: "/mnt/local-storage",
                nodeSelector: {
                    "storage.homelab/local-storage": "true"
                }
            }]
        }, { provider });

        await pulumi.runtime.resourcePromises();

        let volumeConfigCreated = false;
        for (const call of mockCustomResource.mock.calls) {
            if (
                call[1]?.kind === "LocalVolume" &&
                call[1]?.apiVersion === "local.storage.openshift.io/v1"
            ) {
                volumeConfigCreated = true;
                expect(call[1].metadata.name).toBe("local-disks");
                expect(call[1].spec.storageClassName).toBe("local-storage");
                expect(call[1].spec.nodeSelector).toEqual({
                    "storage.homelab/local-storage": "true"
                });
                expect(call[1].spec.localVolumeConfig.hostDir).toBe("/mnt/local-storage");
            }
        }
        expect(volumeConfigCreated).toBe(true);

        k8s.apiextensions.CustomResource = k8s.apiextensions.CustomResource;
    });

    test("creates storage class with correct configuration", async () => {
        const mockStorageClass = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.storage.v1.StorageClass(name, args, opts);
        });
        k8s.storage.v1.StorageClass = mockStorageClass as any;

        const storageClasses = new StorageClasses("test-storage-class", {
            namespace: "storage-operator",
            createNamespace: true,
            storageClasses: [{
                name: "local-storage",
                isDefault: true,
                volumeBindingMode: "WaitForFirstConsumer",
                reclaimPolicy: "Retain"
            }]
        }, { provider });

        await pulumi.runtime.resourcePromises();

        let storageClassCreated = false;
        for (const call of mockStorageClass.mock.calls) {
            if (call[1]?.metadata?.name === "local-storage") {
                storageClassCreated = true;
                expect(call[1].metadata.annotations["storageclass.kubernetes.io/is-default-class"]).toBe("true");
                expect(call[1].provisioner).toBe("kubernetes.io/no-provisioner");
                expect(call[1].volumeBindingMode).toBe("WaitForFirstConsumer");
                expect(call[1].reclaimPolicy).toBe("Retain");
            }
        }
        expect(storageClassCreated).toBe(true);

        k8s.storage.v1.StorageClass = k8s.storage.v1.StorageClass;
    });

    test("creates discovery daemon set correctly", async () => {
        const mockDaemonSet = jest.fn().mockImplementation((name, args, opts) => {
            return new k8s.apps.v1.DaemonSet(name, args, opts);
        });
        k8s.apps.v1.DaemonSet = mockDaemonSet as any;

        const storageClasses = new StorageClasses("test-discovery", {
            namespace: "storage-operator",
            createNamespace: true,
            discovery: {
                enabled: true,
                deviceClasses: ["hdd", "ssd"]
            }
        }, { provider });

        await pulumi.runtime.resourcePromises();

        let daemonSetCreated = false;
        for (const call of mockDaemonSet.mock.calls) {
            if (call[1]?.metadata?.name?.includes("local-storage-discovery")) {
                daemonSetCreated = true;
                const container = call[1].spec.template.spec.containers[0];
                expect(container.name).toBe("discovery");
                expect(container.env).toContainEqual({
                    name: "DEVICE_CLASSES",
                    value: "hdd,ssd"
                });
            }
        }
        expect(daemonSetCreated).toBe(true);

        k8s.apps.v1.DaemonSet = k8s.apps.v1.DaemonSet;
    });
});
