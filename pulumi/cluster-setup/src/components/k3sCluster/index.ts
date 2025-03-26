import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ComponentOutput } from "../../types";
import { createResourceName } from "../../utils";

export interface K3sClusterArgs {
    nodeCount: number;
    version: string;
    networkCidr: string;
}

export class K3sCluster extends pulumi.ComponentResource {
    public readonly id: pulumi.Output<string>;
    public readonly name: string;
    public readonly endpoint: pulumi.Output<string>;

    constructor(name: string, args: K3sClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        const resourceName = createResourceName(name);
        super("homelab:k3s:Cluster", resourceName, {}, opts);

        this.name = resourceName;

        // This is a simplified example. In reality, you would use specific
        // provider resources to create K3s nodes or leverage cloud resources

        // Install K3s master node
        const master = new command.local.Command("k3s-master", {
            create: pulumi.interpolate`curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=${args.version} sh -s - --cluster-cidr=${args.networkCidr}`,
            delete: "k3s-uninstall.sh",
        }, { parent: this });

        // Extract kubeconfig and API endpoint
        const getKubeconfig = master.stdout.apply(_ => {
            return new command.local.Command("get-kubeconfig", {
                create: "cat /etc/rancher/k3s/k3s.yaml | grep server | awk '{print }'",
            }, { parent: this });
        });

        this.endpoint = getKubeconfig.stdout.apply(stdout => stdout.trim());
        this.id = pulumi.output(resourceName);

        this.registerOutputs({
            id: this.id,
            endpoint: this.endpoint,
        });
    }
}
