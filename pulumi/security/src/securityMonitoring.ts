import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// --- Configuration Interfaces ---

export interface SecurityMonitoringArgs {
    /**
     * Namespace where monitoring components (like Promtail, Grafana) might reside or store configurations.
     * @default "monitoring"
     */
    monitoringNamespace?: pulumi.Input<string>;

    /**
     * Identifier for the cluster, used in dashboards and alerts.
     * @default "homelab-cluster"
     */
    clusterName?: pulumi.Input<string>;

    /**
     * Assumed Grafana data source name for Loki.
     * @default "Loki"
     */
    lokiDataSourceName?: pulumi.Input<string>;

    /**
     * Assumed Grafana data source name for Prometheus.
     * @default "Prometheus"
     */
    prometheusDataSourceName?: pulumi.Input<string>;

    /**
     * Configuration for Kubernetes API Server Audit Logs.
     * Note: Applying this policy requires manual configuration of the API server flags.
     */
    auditLogPolicy?: {
        /** Name for the audit policy ConfigMap. @default "kube-audit-policy" */
        configMapName?: string;
        /** Content of the audit policy YAML/JSON. If not provided, a basic default is used. */
        policyContent?: string;
    };

    /**
     * Configuration for log scraping (assuming Promtail).
     */
    logScraping?: {
        /** Name for the Promtail extra scrape configs ConfigMap. @default "promtail-extra-scrape-configs" */
        configMapName?: string;
        /** Additional Promtail scrape_configs YAML content focusing on security logs. */
        scrapeConfigs?: string;
    };

    /**
     * Configuration for Prometheus alerting rules.
     */
    alertingRules?: {
        /** Name for the PrometheusRule custom resource or ConfigMap. @default "security-alerting-rules" */
        resourceName?: string;
        /** Prometheus alerting rules YAML content. */
        rulesContent?: string;
        /** Set to true if deploying as PrometheusRule CRD (requires Prometheus Operator). @default false */
        usePrometheusRuleCrd?: boolean;
    };

    /**
     * Configuration for Grafana dashboards.
     */
    dashboards?: {
        /** Name prefix for dashboard ConfigMaps. @default "grafana-dashboard-security" */
        configMapPrefix?: string;
        /** Map of dashboard filenames (used in ConfigMap key) to dashboard JSON content. */
        dashboardJsonMap?: { [filename: string]: string };
    };

    /**
     * Enable configuration for network policy logging (if CNI supports it).
     * This might involve creating specific NetworkPolicy resources with logging enabled.
     * @default false
     */
    enableNetworkPolicyLogging?: boolean; // Placeholder for future implementation
}

// --- Default Configuration Snippets ---

const defaultAuditPolicy = `
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Log important modification events at RequestResponse level
  - level: RequestResponse
    verbs: ["create", "update", "patch", "delete"]
    resources:
      - group: "" # core
        resources: ["secrets", "configmaps", "serviceaccounts"]
      - group: "apps"
        resources: ["deployments", "statefulsets", "daemonsets"]
      - group: "rbac.authorization.k8s.io"
        resources: ["roles", "clusterroles", "rolebindings", "clusterrolebindings"]
      - group: "networking.k8s.io"
        resources: ["networkpolicies", "ingresses"]
  # Log authentication failures or policy violations at Metadata level
  - level: Metadata
    verbs: ["get", "list", "watch"] # Adjust as needed
    omitStages:
      - "RequestReceived"
  # Default level for all other requests
  - level: Request
    omitStages:
      - "RequestReceived"
`;

const defaultPromtailScrapeConfigs = `
- job_name: kubernetes-audit-logs
  static_configs:
  - targets:
      - localhost
    labels:
      job: kube-audit
      __path__: /var/log/kubernetes/audit.log # Adjust path if necessary
  pipeline_stages:
  - json:
      expressions:
        user: user.username
        verb: verb
        objectRef_resource: objectRef.resource
        objectRef_namespace: objectRef.namespace
        objectRef_name: objectRef.name
        responseStatus_code: responseStatus.code
  - labels:
      user:
      verb:
      objectRef_resource:
      objectRef_namespace:
      objectRef_name:
      responseStatus_code:

# Example: Scrape ingress controller logs (adjust for your ingress)
# - job_name: ingress-nginx-logs
#   kubernetes_sd_configs:
#     - role: pod
#   relabel_configs:
#     - source_labels:
#         - __meta_kubernetes_pod_label_app_kubernetes_io_name
#       action: keep
#       regex: ingress-nginx
#     - source_labels:
#         - __meta_kubernetes_pod_container_name
#       action: keep
#       regex: controller
#     - source_labels: [__meta_kubernetes_pod_name]
#       target_label: pod
#     - source_labels: [__meta_kubernetes_namespace]
#       target_label: namespace
#   pipeline_stages:
#     - # Add parsing stages for your ingress logs here
`;

const defaultAlertingRules = `
groups:
- name: SecurityAlerts
  rules:
  - alert: HighPercentageApiServerErrors
    expr: (sum(rate(apiserver_request_total{code=~"5.."}[5m])) by (cluster) / sum(rate(apiserver_request_total[5m])) by (cluster)) * 100 > 5
    for: 10m
    labels:
      severity: warning
      cluster: "{{ $labels.cluster }}"
    annotations:
      summary: High percentage of Kubernetes API server errors
      description: '{{ $value | printf "%.2f" }}% of API server requests are failing on cluster {{ $labels.cluster }}.'

  # Example Loki-based alert (requires LogQL support in alerting system)
  # - alert: ExcessiveFailedLogins # Needs specific log format
  #   expr: sum(rate({job="auth_service", status="failed"}[5m])) by (cluster) > 10
  #   for: 5m
  #   labels:
  #     severity: critical
  #     cluster: "{{ $labels.cluster }}"
  #   annotations:
  #     summary: Excessive failed logins detected
  #     description: 'More than 10 failed logins per minute detected on cluster {{ $labels.cluster }}.'

  - alert: KubeSecretAccessDenied # Requires audit log collection and parsing
    # This is a conceptual LogQL query - adjust based on your audit log format and labels
    expr: |
      sum by (cluster, user, verb, objectRef_namespace, objectRef_name) (
        rate({job="kube-audit", objectRef_resource="secrets", responseStatus_code=~"403"}[5m])
      ) > 0
    for: 1m
    labels:
      severity: warning
      cluster: "{{ $labels.cluster }}"
      user: "{{ $labels.user }}"
    annotations:
      summary: Access denied to Kubernetes Secret
      description: User '{{ $labels.user }}' was denied '{{ $labels.verb }}' access to Secret '{{ $labels.objectRef_namespace }}/{{ $labels.objectRef_name }}' on cluster {{ $labels.cluster }}.
`;

// --- SecurityMonitoring Component ---

/**
 * Configures security monitoring aspects within an existing observability stack
 * (Prometheus, Grafana, Loki) in a Kubernetes homelab environment.
 */
export class SecurityMonitoring extends pulumi.ComponentResource {
    public readonly auditPolicyConfigMap?: k8s.core.v1.ConfigMap;
    public readonly promtailScrapeConfigMap?: k8s.core.v1.ConfigMap;
    public readonly alertingRuleResource?: k8s.apiextensions.CustomResource | k8s.core.v1.ConfigMap;
    public readonly dashboardConfigMaps: k8s.core.v1.ConfigMap[] = [];

    constructor(name: string, args: SecurityMonitoringArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:security:SecurityMonitoring", name, args, opts);

        const monitoringNs = args.monitoringNamespace ?? "monitoring";
        const clusterName = args.clusterName ?? "homelab-cluster";

        // 1. Kubernetes Audit Policy ConfigMap
        if (args.auditLogPolicy !== undefined) {
            const policyName = args.auditLogPolicy?.configMapName ?? "kube-audit-policy";
            const policyContent = args.auditLogPolicy?.policyContent ?? defaultAuditPolicy;
            this.auditPolicyConfigMap = new k8s.core.v1.ConfigMap(policyName, {
                metadata: {
                    name: policyName,
                    namespace: "kube-system", // Policies often reside here, adjust if needed
                    labels: { app: "kube-apiserver" },
                },
                data: { "policy.yaml": policyContent },
            }, { parent: this });
            pulumi.log.warn(`Created audit policy ConfigMap '${policyName}'. Manual API server configuration required to apply it.`, this);
        }

        // 2. Promtail Extra Scrape Configs
        if (args.logScraping !== undefined) {
            const configMapName = args.logScraping?.configMapName ?? "promtail-extra-scrape-configs";
            const scrapeConfigs = args.logScraping?.scrapeConfigs ?? defaultPromtailScrapeConfigs;
            this.promtailScrapeConfigMap = new k8s.core.v1.ConfigMap(configMapName, {
                metadata: {
                    name: configMapName,
                    namespace: monitoringNs, // Assuming Promtail runs here
                    labels: { app: "promtail" }, // Label for Promtail to discover
                },
                data: { "scrape_configs.yaml": scrapeConfigs },
            }, { parent: this });
            pulumi.log.info(`Created Promtail extra scrape config '${configMapName}'. Ensure Promtail is configured to load it.`, this);
        }

        // 3. Alerting Rules
        if (args.alertingRules !== undefined) {
            const resourceName = args.alertingRules?.resourceName ?? "security-alerting-rules";
            const rulesContent = args.alertingRules?.rulesContent ?? defaultAlertingRules;
            const useCrd = args.alertingRules?.usePrometheusRuleCrd ?? false;

            if (useCrd) {
                // Create PrometheusRule CRD (requires Prometheus Operator)
                this.alertingRuleResource = new k8s.apiextensions.CustomResource(resourceName, {
                    apiVersion: "monitoring.coreos.com/v1",
                    kind: "PrometheusRule",
                    metadata: {
                        name: resourceName,
                        namespace: monitoringNs,
                        labels: { role: "alert-rules", prometheus: "kube-prometheus" }, // Adjust labels for your Prometheus Operator setup
                    },
                    spec: pulumi.output(rulesContent).apply(yamlContent => require("js-yaml").load(yamlContent)), // Parse YAML to JS object
                }, { parent: this });
            } else {
                // Create ConfigMap for standalone Alertmanager or Grafana Alerting
                this.alertingRuleResource = new k8s.core.v1.ConfigMap(resourceName, {
                    metadata: {
                        name: resourceName,
                        namespace: monitoringNs,
                        labels: { alertmanager_config: "true" }, // Example label
                    },
                    data: { "security_rules.yaml": rulesContent },
                }, { parent: this });
                pulumi.log.info(`Created alerting rules ConfigMap '${resourceName}'. Ensure Alertmanager/Grafana Alerting loads it.`, this);
            }
        }

        // 4. Grafana Dashboards
        if (args.dashboards?.dashboardJsonMap) {
            const prefix = args.dashboards.configMapPrefix ?? "grafana-dashboard-security";
            for (const [filename, jsonContent] of Object.entries(args.dashboards.dashboardJsonMap)) {
                const cmName = `${prefix}-${filename.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
                const dashboardCm = new k8s.core.v1.ConfigMap(cmName, {
                    metadata: {
                        name: cmName,
                        namespace: monitoringNs, // Assuming Grafana runs here
                        labels: {
                            grafana_dashboard: "1", // Label for Grafana sidecar/discovery
                            app: "grafana",
                        },
                    },
                    data: {
                        [filename]: jsonContent,
                    },
                }, { parent: this });
                this.dashboardConfigMaps.push(dashboardCm);
            }
        }

        // 5. Network Policy Logging (Placeholder)
        if (args.enableNetworkPolicyLogging) {
            pulumi.log.warn("Network policy logging configuration is tool-specific (CNI) and not fully implemented in this component.", this);
            // Future: Could create NetworkPolicy resources with specific annotations if the CNI supports logging denied connections.
        }

        this.registerOutputs({
            auditPolicyConfigMapName: this.auditPolicyConfigMap?.metadata.name,
            promtailScrapeConfigMapName: this.promtailScrapeConfigMap?.metadata.name,
            alertingRuleResourceName: this.alertingRuleResource?.metadata.name,
            dashboardConfigMapNames: this.dashboardConfigMaps.map(cm => cm.metadata.name),
        });
    }
}

/*
Example Usage:

import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";
import { SecurityMonitoring } from "./securityMonitoring"; // Adjust path

// Assume you have dashboard JSON files in a 'dashboards' directory
const dashboardDir = "./dashboards/security";
const dashboardFiles = fs.readdirSync(dashboardDir);
const dashboardMap: { [filename: string]: string } = {};
for (const file of dashboardFiles) {
    if (file.endsWith(".json")) {
        dashboardMap[file] = fs.readFileSync(path.join(dashboardDir, file), 'utf-8');
    }
}

// Configure Security Monitoring
const secMon = new SecurityMonitoring("homelab-security-monitoring", {
    monitoringNamespace: "observability", // Namespace of your monitoring stack
    clusterName: "my-homelab",
    lokiDataSourceName: "Loki", // Ensure these match Grafana data source names
    prometheusDataSourceName: "Prometheus",

    auditLogPolicy: { // Enable audit log policy generation
        // policyContent: customAuditPolicyYaml // Optionally provide custom policy
    },

    logScraping: { // Configure extra log scraping for Promtail
        // scrapeConfigs: customPromtailScrapeYaml // Optionally provide custom scrape configs
    },

    alertingRules: { // Configure alerting rules
        usePrometheusRuleCrd: true, // Set to true if using Prometheus Operator
        // rulesContent: customAlertRulesYaml // Optionally provide custom rules
    },

    dashboards: { // Provide Grafana dashboards
        dashboardJsonMap: dashboardMap,
    },

    // enableNetworkPolicyLogging: true, // If your CNI supports it and you want to configure it
});

// Export resource names if needed
export const auditPolicyMapName = secMon.auditPolicyConfigMap?.metadata.name;
export const alertRuleName = secMon.alertingRuleResource?.metadata.name;

*/
