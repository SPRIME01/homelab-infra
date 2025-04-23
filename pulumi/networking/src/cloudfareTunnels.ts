import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

// Define the structure for service configuration
interface TunnelServiceConfig {
    name: string; // Name for the ingress rule/service
    hostname: string; // Subdomain (e.g., "grafana.example.com")
    serviceUrl: string; // Internal service URL (e.g., "http://192.168.1.100:3000")
    // Optional: Define access policy requirements here if using Cloudflare Access
    // accessPolicy?: { /* policy details */ };
}

// Define the properties for the CloudflareTunnels component
interface CloudflareTunnelsArgs {
    accountId: pulumi.Input<string>;
    zoneId: pulumi.Input<string>;
    tunnelName: pulumi.Input<string>;
    tunnelSecret: pulumi.Input<string>; // Secret obtained after creating tunnel manually or via API
    services: TunnelServiceConfig[];
}

export class CloudflareTunnels extends pulumi.ComponentResource {
    public readonly tunnelId: pulumi.Output<string>;
    public readonly dnsRecords: pulumi.Output<cloudflare.Record[]>;

    constructor(name: string, args: CloudflareTunnelsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:CloudflareTunnels", name, args, opts);

        const { accountId, zoneId, tunnelName, tunnelSecret, services } = args;

        // 1. Create the Cloudflare Tunnel resource
        // Note: Tunnel creation often involves running `cloudflared tunnel create <name>`
        // which provides the Tunnel ID and credentials file path/secret.
        // We assume the tunnel is pre-created or managed outside this specific Pulumi resource
        // for simplicity, and we mainly manage its configuration and DNS routing.
        // If the provider supports full tunnel creation lifecycle, that could be used instead.
        // For this example, we'll reference an existing tunnel by name/secret.

        // Placeholder: In a real scenario, you might fetch the tunnel ID based on its name
        // or expect it as an input if created manually or via another process.
        // For demonstration, we'll simulate having a tunnel ID.
        // A more robust approach might involve using `cloudflare.getTunnel` if available
        // or managing the tunnel resource directly if the provider supports it fully.
        const tunnel = new cloudflare.Tunnel(tunnelName, {
            accountId: accountId,
            name: tunnelName,
            secret: tunnelSecret, // Provide the tunnel secret
        }, { parent: this });

        this.tunnelId = tunnel.id;

        // 2. Configure Tunnel Ingress Rules
        const ingressRules = services.map(service => ({
            hostname: service.hostname,
            service: service.serviceUrl,
            // Add other ingress settings like path, originRequest config if needed
        }));

        // Add a catch-all rule (optional, but recommended)
        ingressRules.push({
            service: "http_status:404", // Return 404 for unconfigured hostnames/paths
        });

        const tunnelConfig = new cloudflare.TunnelConfig("main-config", {
            accountId: accountId,
            tunnelId: tunnel.id,
            config: {
                ingressRules: ingressRules,
                // warpRouting: { enabled: false }, // Configure Warp routing if needed
            },
        }, { parent: this, dependsOn: [tunnel] });

        // 3. Configure DNS CNAME records pointing to the tunnel
        const dnsRecords = services.map(service => {
            const subdomain = service.hostname.split('.')[0]; // Extract subdomain part
            return new cloudflare.Record(`${name}-${subdomain}-cname`, {
                zoneId: zoneId,
                name: subdomain, // The subdomain part (e.g., "grafana")
                type: "CNAME",
                // The value should be the tunnel's CNAME target (e.g., <tunnel-id>.cfargotunnel.com)
                value: pulumi.interpolate`${tunnel.id}.cfargotunnel.com`,
                proxied: true, // Ensure traffic goes through Cloudflare
                ttl: 1, // Use 1 for automatic TTL
            }, { parent: this, dependsOn: [tunnel] });
        });
        this.dnsRecords = pulumi.output(dnsRecords);

        // 4. Access Policies (Placeholder)
        // Cloudflare Access Applications and Policies would be configured here.
        // This often involves creating `cloudflare.AccessApplication` and `cloudflare.AccessPolicy`
        // resources, linking them to the hostnames defined in `services`.
        // Example (conceptual):
        // services.forEach(service => {
        //   if (service.accessPolicy) {
        //     const app = new cloudflare.AccessApplication(`${name}-${service.name}-app`, { ... });
        //     const policy = new cloudflare.AccessPolicy(`${name}-${service.name}-policy`, { ... });
        //   }
        // });
        pulumi.log.warn("Access Policy configuration is not fully implemented in this component. Manual setup or additional Pulumi resources (cloudflare.AccessApplication, cloudflare.AccessPolicy) might be required.", this);


        // 5. Monitoring Integration (Placeholder)
        // Integration with monitoring systems (e.g., Prometheus, Grafana Cloud)
        // might involve configuring Cloudflare health checks (`cloudflare.Healthcheck`)
        // or exporting metrics if the provider/API supports it.
        // Fallback mechanisms could involve multiple tunnel instances or health check based routing.
        pulumi.log.info("Monitoring integration and fallback mechanisms need separate implementation.", this);


        this.registerOutputs({
            tunnelId: this.tunnelId,
            dnsRecords: this.dnsRecords,
        });
    }
}
