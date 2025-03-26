import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface KubeConfigArgs {
    clusterId: pulumi.Output<string>;
    endpoint: pulumi.Output<string>;
}

export class KubeConfig extends pulumi.ComponentResource {
    public readonly path: pulumi.Output<string>;

    constructor(name: string, args: KubeConfigArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k3s:KubeConfig", name, {}, opts);

        // Export the kubeconfig to a file
        const kubeConfigCmd = new command.local.Command("export-kubeconfig", {
            create: "mkdir -p ~/.kube && sudo cat /etc/rancher/k3s/k3s.yaml > ~/.kube/k3s-config",
        }, { parent: this });

        this.path = kubeConfigCmd.stdout.apply(_ => "~/.kube/k3s-config");

        this.registerOutputs({
            path: this.path,
        });
    }
}
