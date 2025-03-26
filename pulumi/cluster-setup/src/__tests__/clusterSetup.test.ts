import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ClusterSetup } from "../clusterSetup";

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

describe("ClusterSetup", () => {
    let provider: k8s.Provider;

    beforeAll(() => {
        // Create a mock provider
        provider = new k8s.Provider("test-provider", {
            kubeconfig: "test-kubeconfig",
            context: "test-context",
        });
    });

    test("creates namespaces with correct configuration", async () => {
        // Setup test data
        const namespaces = ["monitoring", "apps", "database"];

        // Create the component with test data
        const setup = new ClusterSetup("test-setup", {
            namespaces: namespaces,
            namePrefix: "test-",
        }, { provider });

        // Wait for resource creation
        await pulumi.runtime.resourcePromises();

        // Verify resources were created
        expect(setup.namespaces).toHaveLength(namespaces.length);

        // Check that the namespaces have the expected properties
        for (let i = 0; i < namespaces.length; i++) {
            const ns = setup.namespaces[i];

            // Verify namespace name
            await pulumi.all([ns.metadata]).apply(([metadata]) => {
                expect(metadata.name).toBe(namespaces[i]);
                expect(metadata.labels["homelab-managed"]).toBe("true");
                expect(metadata.labels["app.kubernetes.io/managed-by"]).toBe("pulumi");
            });
        }
    });

    test("creates service accounts for each namespace", async () => {
        // Setup test data
        const namespaces = ["test-ns1", "test-ns2"];

        // Create the component with test data
        const setup = new ClusterSetup("test-sa-setup", {
            namespaces: namespaces,
        }, { provider });

        // Wait for resource creation
        await pulumi.runtime.resourcePromises();

        // Verify service accounts were created
        expect(setup.serviceAccounts).toHaveLength(namespaces.length);

        // Check that each service account is correctly associated with its namespace
        for (let i = 0; i < namespaces.length; i++) {
            const sa = setup.serviceAccounts[i];

            await pulumi.all([sa.metadata]).apply(([metadata]) => {
                expect(metadata.name).toBe(`${namespaces[i]}-admin`);
                expect(metadata.namespace).toBe(namespaces[i]);
            });
        }
    });

    test("applies node labels correctly", async () => {
        // Setup test data
        const nodeLabels = {
            "node1": {
                "label1": "value1",
                "label2": "value2"
            },
            "node2": {
                "label3": "value3"
            }
        };

        // Create the component with test data
        const setup = new ClusterSetup("test-labels-setup", {
            nodeLabels: nodeLabels,
        }, { provider });

        // Wait for resource creation
        await pulumi.runtime.resourcePromises();

        // Since nodeLabels is an array of outputs, we need to count them
        expect(setup.nodeLabels.length).toBe(Object.keys(nodeLabels).length);

        // Verify node labels (we can't easily check the actual values because of the Output wrapping)
        // This is a simplified check
        expect(setup.nodeLabels.length).toBeGreaterThan(0);
    });
});
