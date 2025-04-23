import * as pulumi from "@pulumi/pulumi";
// Import specific Pulumi providers based on your monitoring system, e.g.:
// import * as grafana from "@pulumi/grafana";

/**
 * Arguments for configuring the NotificationChannels component.
 */
interface NotificationChannelArgs {
    /** The recipient email address for critical alerts. */
    emailRecipient: pulumi.Input<string>;
    /** The endpoint URL or identifier for mobile push notifications (e.g., Gotify, Pushover webhook). */
    mobilePushEndpoint: pulumi.Input<string>;
    /** The webhook URL for Home Assistant notifications. */
    homeAssistantWebhook: pulumi.Input<string>;
    /** The webhook URL for n8n automation workflows. */
    n8nWebhook: pulumi.Input<string>;
    // Note: Throttling and grouping are typically configured in the alerting rules
    // or notification policies that *use* these channels, not on the channels themselves.
}

/**
 * A Pulumi component for configuring various notification channels for homelab monitoring.
 *
 * Note: This component provides a structure. You will need to replace the placeholder
 * comments with actual Pulumi resource definitions based on your chosen monitoring
 * system and its corresponding Pulumi provider (e.g., Grafana, Alertmanager).
 */
export class NotificationChannels extends pulumi.ComponentResource {
    constructor(name: string, args: NotificationChannelArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:observability:NotificationChannels", name, args, opts);

        // --- Placeholder for Email Notification Channel ---
        // Replace with your specific provider resource (e.g., grafana.NotificationChannel)
        // Configure filtering for 'critical' alerts within your alerting rules or notification policies.
        /*
        const emailChannel = new grafana.NotificationChannel(`${name}-email`, {
            name: `${name}-email-critical`,
            type: "email",
            settings: { addresses: args.emailRecipient },
            isDefault: false,
            sendReminder: false, // Usually false for critical alerts
        }, { parent: this });
        */
        pulumi.log.info(`[${name}] Placeholder: Configure Email channel for ${args.emailRecipient}`);

        // --- Placeholder for Mobile Push Notification Channel ---
        // Replace with your specific provider resource (e.g., grafana.NotificationChannel type 'webhook')
        // The specific type and settings depend on the app/service used (Gotify, Pushover, etc.)
        /*
        const mobilePushChannel = new grafana.NotificationChannel(`${name}-mobile`, {
            name: `${name}-mobile-push`,
            type: "webhook", // Or a specific type if supported
            settings: { url: args.mobilePushEndpoint, httpMethod: "POST" }, // Adjust settings as needed
            isDefault: false,
        }, { parent: this });
        */
        pulumi.log.info(`[${name}] Placeholder: Configure Mobile Push channel to ${args.mobilePushEndpoint}`);

        // --- Placeholder for Home Assistant Integration (Webhook) ---
        // Replace with your specific provider resource (e.g., grafana.NotificationChannel type 'webhook')
        /*
        const homeAssistantChannel = new grafana.NotificationChannel(`${name}-ha`, {
            name: `${name}-home-assistant`,
            type: "webhook",
            settings: { url: args.homeAssistantWebhook, httpMethod: "POST" }, // Adjust settings as needed
            isDefault: false,
        }, { parent: this });
        */
        pulumi.log.info(`[${name}] Placeholder: Configure Home Assistant webhook to ${args.homeAssistantWebhook}`);

        // --- Placeholder for n8n Integration (Webhook) ---
        // Replace with your specific provider resource (e.g., grafana.NotificationChannel type 'webhook')
        /*
        const n8nChannel = new grafana.NotificationChannel(`${name}-n8n`, {
            name: `${name}-n8n-webhook`,
            type: "webhook",
            settings: { url: args.n8nWebhook, httpMethod: "POST" }, // Adjust settings as needed
            isDefault: false,
        }, { parent: this });
        */
        pulumi.log.info(`[${name}] Placeholder: Configure n8n webhook to ${args.n8nWebhook}`);

        // --- Status Dashboard / Alert History ---
        // This is typically a feature of the monitoring system's UI (e.g., Grafana Alerting view)
        // or a separate status page application (e.g., Uptime Kuma, Gatus) configured elsewhere.
        // No specific "channel" resource is usually created for this.
        pulumi.log.info(`[${name}] Note: Status Dashboard/Alert History is part of the monitoring UI or a separate status page service.`);

        // --- Throttling and Grouping Configuration ---
        // Throttling (rate limiting) and Grouping (combining related alerts) are generally configured
        // within the Alerting Rules or Notification Policies (e.g., Grafana Notification Policies,
        // Alertmanager routing tree) that determine *which* alerts go to *which* channels and *how*.
        pulumi.log.warn(`[${name}] Reminder: Configure notification throttling and grouping in your alerting rules or notification policies.`);

        this.registerOutputs({});
    }
}
