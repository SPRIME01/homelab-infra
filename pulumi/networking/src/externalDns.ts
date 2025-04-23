import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

/**
 * Configuration for a single DNS record.
 */
interface DnsRecordConfig {
    /** A unique name for the Pulumi resource */
    resourceName: string;
    /** The type of DNS record (A, CNAME, TXT, MX, CAA, etc.) */
    type: pulumi.Input<string>;
    /** The name of the record (e.g., "@" for root, "www", "mail") */
    name: pulumi.Input<string>;
    /** The value/content of the record */
    value: pulumi.Input<string>;
    /** Time To Live for the record (seconds). 1 for automatic. */
    ttl?: pulumi.Input<number>;
    /** Whether the record is proxied through Cloudflare (orange cloud). Defaults to false. */
    proxied?: pulumi.Input<boolean>;
    /** Priority for MX records. */
    priority?: pulumi.Input<number>;
    /** CAA record data */
    data?: pulumi.Input<cloudflare.RecordDataArgs>;
}

/**
 * Configuration for Certificate Authority Authorization (CAA) records.
 */
interface CaaConfig {
    /** The tag for the CAA record (issue, issuewild, iodef) */
    tag: pulumi.Input<string>;
    /** The value associated with the tag (e.g., "letsencrypt.org") */
    value: pulumi.Input<string>;
}

/**
 * Arguments for the ExternalDns component.
 */
interface ExternalDnsArgs {
    /** Your Cloudflare Account ID. */
    accountId: pulumi.Input<string>;
    /** The Zone ID of the domain you are managing. */
    zoneId: pulumi.Input<string>;
    /** An array of DNS records to manage. */
    records: DnsRecordConfig[];
    /** Optional: Configuration for CAA records. */
    caaRecords?: CaaConfig[];
    /** Optional: Enable DNSSEC for the zone. Defaults to false. */
    enableDnssec?: pulumi.Input<boolean>;
}

/**
 * Pulumi component for managing external DNS configuration on Cloudflare.
 *
 * This component handles the creation and management of various DNS records
 * (A, CNAME, TXT, MX, CAA) and DNSSEC settings for a specified Cloudflare zone.
 *
 * Naming Conventions:
 * - Use "@" for the root domain.
 * - Use "*" for wildcard records.
 * - Subdomains are specified directly (e.g., "www", "mail", "service").
 *
 * DNS Structure Example:
 * - example.com (A record, proxied) -> Points to main web server/tunnel
 * - www.example.com (CNAME record, proxied) -> Points to example.com
 * - mail.example.com (A record, DNS only) -> Points to mail server IP
 * - example.com (MX record, DNS only) -> Points to mail.example.com
 * - example.com (TXT record, DNS only) -> SPF/DKIM/DMARC records
 * - example.com (CAA record, DNS only) -> Specifies allowed CAs
 */
export class ExternalDns extends pulumi.ComponentResource {
    public readonly managedRecords: pulumi.Output<cloudflare.Record[]>;
    public readonly dnssecSettings?: cloudflare.ZoneDnssec;

    constructor(name: string, args: ExternalDnsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:networking:ExternalDns", name, args, opts);

        const { accountId, zoneId, records, caaRecords = [], enableDnssec = false } = args;

        const createdRecords: pulumi.Output<cloudflare.Record>[] = [];

        // 1. Manage standard DNS records
        records.forEach(recordConfig => {
            const dnsRecord = new cloudflare.Record(recordConfig.resourceName, {
                zoneId: zoneId,
                name: recordConfig.name,
                type: recordConfig.type,
                value: recordConfig.value,
                ttl: recordConfig.ttl ?? 1, // Default to automatic TTL
                proxied: recordConfig.proxied ?? false, // Default to DNS only
                priority: recordConfig.priority, // Only relevant for MX
                data: recordConfig.data, // Only relevant for CAA/TLSA etc.
            }, { parent: this });
            createdRecords.push(pulumi.output(dnsRecord));
        });

        // 2. Manage CAA records
        caaRecords.forEach((caaConfig, index) => {
            const caaRecord = new cloudflare.Record(`${name}-caa-${index}`, {
                zoneId: zoneId,
                name: "@", // CAA records typically apply to the root domain
                type: "CAA",
                data: {
                    tag: caaConfig.tag,
                    value: caaConfig.value,
                    flags: 0, // Standard flag
                },
                ttl: 3600, // Recommended TTL for CAA is often 1 hour
            }, { parent: this });
            createdRecords.push(pulumi.output(caaRecord));
        });

        this.managedRecords = pulumi.all(createdRecords);

        // 3. Configure DNSSEC
        if (enableDnssec) {
            this.dnssecSettings = new cloudflare.ZoneDnssec(`${name}-dnssec`, {
                zoneId: zoneId,
                // Status can be 'active' or 'disabled'. Pulumi manages the state.
            }, { parent: this });
            pulumi.log.info(`DNSSEC management enabled for zone ${zoneId}. State will be managed by Pulumi.`, this);
        } else {
            // Optionally ensure DNSSEC is disabled if enableDnssec is false
            // This might require checking current state or using ZoneSettingsOverride
             pulumi.log.info(`DNSSEC management not explicitly enabled for zone ${zoneId}.`, this);
        }

        this.registerOutputs({
            managedRecords: this.managedRecords,
            dnssecSettings: this.dnssecSettings,
        });
    }
}
