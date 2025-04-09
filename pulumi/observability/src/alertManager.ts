import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface AlertManagerArgs {
    /**
     * Namespace where AlertManager is deployed
     */
    namespace: string;

    /**
     * Notification configurations
     */
    notifications?: {
        email?: {
            from: string;
            smartHost: string;
            username: string;
            password: string;
            recipients: string[];
        };
        slack?: {
            webhookUrl: string;
            channel: string;
        };
        pushover?: {
            userKey: string;
            apiToken: string;
        };
        telegram?: {
            apiToken: string;
            chatId: string;
        };
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class AlertManager extends pulumi.ComponentResource {
    /**
     * The ConfigMap containing AlertManager configuration
     */
    public readonly configMap: k8s.core.v1.ConfigMap;

    /**
     * The Secret containing sensitive configuration
     */
    public readonly secret: k8s.core.v1.Secret;

    constructor(name: string, args: AlertManagerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:AlertManager", name, args, opts);

        const prefix = args.namePrefix || "";

        // Create Secret for sensitive configurations
        this.secret = new k8s.core.v1.Secret(`${prefix}alertmanager-config`, {
            metadata: {
                name: `${prefix}alertmanager-config`,
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "alertmanager",
                    "app.kubernetes.io/part-of": "monitoring"
                }
            },
            stringData: {
                "notification-secrets.yaml": this.generateSecretConfig(args.notifications)
            }
        }, { provider, parent: this });

        // Create ConfigMap for AlertManager configuration
        this.configMap = new k8s.core.v1.ConfigMap(`${prefix}alertmanager`, {
            metadata: {
                name: `${prefix}alertmanager`,
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "alertmanager",
                    "app.kubernetes.io/part-of": "monitoring"
                }
            },
            data: {
                "alertmanager.yaml": this.generateMainConfig(args.notifications)
            }
        }, { provider, parent: this });

        this.registerOutputs({
            configMap: this.configMap,
            secret: this.secret
        });
    }

    private generateSecretConfig(notifications?: AlertManagerArgs["notifications"]): string {
        // Generate secret configuration in YAML format
        return `
global:
  # Email SMTP configuration
  smtp_smarthost: '${notifications?.email?.smartHost || ""}'
  smtp_from: '${notifications?.email?.from || ""}'
  smtp_auth_username: '${notifications?.email?.username || ""}'
  smtp_auth_password: '${notifications?.email?.password || ""}'

# Notification channel secrets
slack_api_url: '${notifications?.slack?.webhookUrl || ""}'
pushover_user_key: '${notifications?.pushover?.userKey || ""}'
pushover_token: '${notifications?.pushover?.apiToken || ""}'
telegram_api_token: '${notifications?.telegram?.apiToken || ""}'
`;
    }

    private generateMainConfig(notifications?: AlertManagerArgs["notifications"]): string {
        return `
global:
  resolve_timeout: 5m
  slack_api_url_file: /etc/alertmanager/secrets/notification-secrets.yaml

# Template customizations
templates:
  - '/etc/alertmanager/templates/*.tmpl'

# Route tree
route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'
  routes:
    # Critical alerts
    - match:
        severity: critical
      group_wait: 10s
      group_interval: 1m
      repeat_interval: 1h
      receiver: 'critical'
      continue: true

    # AI model alerts
    - match:
        domain: ai
      receiver: 'ai-team'
      group_by: ['alertname', 'model', 'instance']
      routes:
        - match:
            severity: critical
          receiver: 'ai-critical'

    # Infrastructure alerts
    - match:
        domain: infrastructure
      receiver: 'infrastructure'
      group_by: ['alertname', 'node', 'instance']

    # Data service alerts
    - match:
        domain: data
      receiver: 'data-team'
      group_by: ['alertname', 'service', 'instance']

    # Home automation alerts
    - match:
        domain: home
      receiver: 'home-automation'
      group_by: ['alertname', 'device', 'location']

# Inhibition rules to prevent alert storms
inhibit_rules:
  # Inhibit node-level alerts when cluster is down
  - source_match:
      alertname: 'ClusterDown'
    target_match_re:
      alertname: 'Node.*'
    equal: ['cluster']

  # Inhibit service alerts when node is down
  - source_match:
      alertname: 'NodeDown'
    target_match_re:
      alertname: 'Service.*'
    equal: ['node']

# Receiver definitions
receivers:
  - name: 'default'
    email_configs:
      - to: '${notifications?.email?.recipients?.join(", ") || ""}'
        send_resolved: true
        headers:
          subject: '[ALERT] {{ .GroupLabels.alertname }}'

  - name: 'critical'
    pushover_configs:
      - user_key_file: '/etc/alertmanager/secrets/pushover_user_key'
        token_file: '/etc/alertmanager/secrets/pushover_token'
        priority: 2
        retry: 30
        expire: 3600
    slack_configs:
      - channel: '#alerts-critical'
        send_resolved: true
        icon_emoji: ':warning:'
        title: '{{ template "slack.title" . }}'
        text: '{{ template "slack.text" . }}'
    telegram_configs:
      - chat_id: ${notifications?.telegram?.chatId || ""}
        parse_mode: 'HTML'
        message: '{{ template "telegram.message" . }}'

  - name: 'ai-team'
    slack_configs:
      - channel: '#ai-alerts'
        send_resolved: true
        title: '{{ template "slack.ai.title" . }}'
        text: '{{ template "slack.ai.text" . }}'
    email_configs:
      - to: '${notifications?.email?.recipients?.join(", ") || ""}'
        send_resolved: true

  - name: 'ai-critical'
    slack_configs:
      - channel: '#ai-alerts'
        send_resolved: true
        icon_emoji: ':warning:'
        title: '[CRITICAL] {{ template "slack.ai.title" . }}'
        text: '{{ template "slack.ai.text" . }}'
    pushover_configs:
      - user_key_file: '/etc/alertmanager/secrets/pushover_user_key'
        token_file: '/etc/alertmanager/secrets/pushover_token'
        priority: 1

  - name: 'infrastructure'
    slack_configs:
      - channel: '#infrastructure'
        send_resolved: true
        title: '{{ template "slack.infra.title" . }}'
        text: '{{ template "slack.infra.text" . }}'

  - name: 'data-team'
    slack_configs:
      - channel: '#data-services'
        send_resolved: true
        title: '{{ template "slack.data.title" . }}'
        text: '{{ template "slack.data.text" . }}'

  - name: 'home-automation'
    telegram_configs:
      - chat_id: ${notifications?.telegram?.chatId || ""}
        parse_mode: 'HTML'
        message: '{{ template "telegram.home.message" . }}'

# Template definitions
templates:
  - name: slack.title
    template: |
      [{{ .Status | toUpper }}] {{ .GroupLabels.alertname }}
  - name: slack.text
    template: |
      {{ range .Alerts }}
      *Alert:* {{ .Annotations.summary }}
      *Description:* {{ .Annotations.description }}
      *Severity:* {{ .Labels.severity }}
      *Duration:* {{ .Duration }}
      {{ if .Annotations.runbook }}*Runbook:* {{ .Annotations.runbook }}{{ end }}
      {{ end }}
  - name: telegram.message
    template: |
      <b>{{ .Status | toUpper }}</b>
      {{ range .Alerts }}
      <b>Alert:</b> {{ .Annotations.summary }}
      <b>Description:</b> {{ .Annotations.description }}
      <b>Severity:</b> {{ .Labels.severity }}
      {{ if .Annotations.runbook }}<b>Runbook:</b> {{ .Annotations.runbook }}{{ end }}
      {{ end }}

# Time intervals for notification policies
time_intervals:
  - name: workdays
    time_intervals:
      - weekdays: ['monday:friday']
        times:
          - start_time: '09:00'
            end_time: '17:00'
  - name: oncall
    time_intervals:
      - weekdays: ['monday:friday']
        times:
          - start_time: '00:00'
            end_time: '24:00'
`;
    }
}
