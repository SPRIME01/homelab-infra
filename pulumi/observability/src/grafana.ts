import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface GrafanaArgs {
    namespace: string;
    storageSize: string;
    storageClass: string;
    adminPassword: pulumi.Input<string>;
    domain: string;
    authProxyHeaderName?: string;
    authProxyHeaderValue?: string;
    plugins?: string[];
    resources?: {
        limits?: {
            cpu?: string;
            memory?: string;
        };
        requests?: {
            cpu?: string;
            memory?: string;
        };
    };
}

export class Grafana extends pulumi.ComponentResource {
    public readonly service: k8s.core.v1.Service;
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly ingress: k8s.networking.v1.Ingress;

    constructor(name: string, args: GrafanaArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:Grafana", name, {}, opts);

        // Default values
        const resources = args.resources || {
            limits: {
                cpu: "500m",
                memory: "512Mi",
            },
            requests: {
                cpu: "100m",
                memory: "128Mi",
            },
        };

        const plugins = args.plugins || [
            "grafana-piechart-panel",
            "grafana-clock-panel",
            "grafana-worldmap-panel",
            "grafana-singlestat-panel",
            "natel-discrete-panel",
            "vonage-status-panel"
        ];

        // Create PVC for Grafana data
        const grafanaPvc = new k8s.core.v1.PersistentVolumeClaim("grafana-data", {
            metadata: {
                name: "grafana-data",
                namespace: args.namespace,
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                    requests: {
                        storage: args.storageSize,
                    },
                },
                storageClassName: args.storageClass,
            },
        }, { parent: this });

        // Create ConfigMap for Grafana datasources
        const datasourcesConfigMap = new k8s.core.v1.ConfigMap("grafana-datasources", {
            metadata: {
                name: "grafana-datasources",
                namespace: args.namespace,
            },
            data: {
                "datasources.yaml": `
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus-operated.${args.namespace}.svc.cluster.local:9090
    isDefault: true
    editable: false
  - name: Loki
    type: loki
    access: proxy
    url: http://loki.${args.namespace}.svc.cluster.local:3100
    editable: false
  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo.${args.namespace}.svc.cluster.local:3200
    editable: false
    uid: tempo
    jsonData:
      httpMethod: GET
      serviceMap:
        datasourceUid: prometheus
  - name: InfluxDB
    type: influxdb
    access: proxy
    url: http://homeassistant.local:8086
    editable: false
    jsonData:
      version: Flux
      organization: homeassistant
      defaultBucket: system_metrics
    secureJsonData:
      token: ${process.env.INFLUXDB_TOKEN || ""}
`,
            },
        }, { parent: this });

        // Create ConfigMap for Grafana configuration
        const grafanaConfigMap = new k8s.core.v1.ConfigMap("grafana-config", {
            metadata: {
                name: "grafana-config",
                namespace: args.namespace,
            },
            data: {
                "grafana.ini": `
[server]
root_url = https://${args.domain}

[auth]
disable_login_form = false
oauth_auto_login = false

[auth.proxy]
enabled = ${args.authProxyHeaderName ? "true" : "false"}
header_name = ${args.authProxyHeaderName || "X-WEBAUTH-USER"}
header_property = username
auto_sign_up = true
sync_ttl = 60

[security]
allow_embedding = true

[users]
auto_assign_org = true
auto_assign_org_role = Editor

[dashboards]
min_refresh_interval = 5s

[alerting]
enabled = true

[unified_alerting]
enabled = true

[plugins]
allow_loading_unsigned_plugins = true
`,
            },
        }, { parent: this });

        // Create deployment for Grafana
        const grafanaDeployment = new k8s.apps.v1.Deployment("grafana", {
            metadata: {
                name: "grafana",
                namespace: args.namespace,
                labels: { app: "grafana" },
            },
            spec: {
                selector: {
                    matchLabels: { app: "grafana" },
                },
                template: {
                    metadata: {
                        labels: { app: "grafana" },
                        annotations: {
                            "checksum/config": pulumi.interpolate`${grafanaConfigMap.data["grafana.ini"]}`,
                            "checksum/datasources": pulumi.interpolate`${datasourcesConfigMap.data["datasources.yaml"]}`,
                        },
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 472,
                            runAsUser: 472,
                        },
                        containers: [{
                            name: "grafana",
                            image: "grafana/grafana:latest",
                            ports: [{ containerPort: 3000 }],
                            env: [
                                {
                                    name: "GF_SECURITY_ADMIN_PASSWORD",
                                    valueFrom: {
                                        secretKeyRef: {
                                            name: "grafana-admin-credentials",
                                            key: "password",
                                        },
                                    },
                                },
                                {
                                    name: "GF_INSTALL_PLUGINS",
                                    value: plugins.join(","),
                                },
                                ...(args.authProxyHeaderName ? [
                                    {
                                        name: "GF_AUTH_PROXY_HEADER_NAME",
                                        value: args.authProxyHeaderName,
                                    }
                                ] : []),
                            ],
                            volumeMounts: [
                                {
                                    name: "grafana-data",
                                    mountPath: "/var/lib/grafana",
                                },
                                {
                                    name: "grafana-config",
                                    mountPath: "/etc/grafana/grafana.ini",
                                    subPath: "grafana.ini",
                                },
                                {
                                    name: "grafana-datasources",
                                    mountPath: "/etc/grafana/provisioning/datasources/datasources.yaml",
                                    subPath: "datasources.yaml",
                                },
                            ],
                            resources: resources,
                            readinessProbe: {
                                httpGet: {
                                    path: "/api/health",
                                    port: 3000,
                                },
                                initialDelaySeconds: 30,
                                timeoutSeconds: 5,
                            },
                            livenessProbe: {
                                httpGet: {
                                    path: "/api/health",
                                    port: 3000,
                                },
                                initialDelaySeconds: 60,
                                timeoutSeconds: 5,
                                failureThreshold: 10,
                            },
                        }],
                        volumes: [
                            {
                                name: "grafana-data",
                                persistentVolumeClaim: {
                                    claimName: grafanaPvc.metadata.name,
                                },
                            },
                            {
                                name: "grafana-config",
                                configMap: {
                                    name: grafanaConfigMap.metadata.name,
                                },
                            },
                            {
                                name: "grafana-datasources",
                                configMap: {
                                    name: datasourcesConfigMap.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        // Create service for Grafana
        const grafanaService = new k8s.core.v1.Service("grafana", {
            metadata: {
                name: "grafana",
                namespace: args.namespace,
                labels: { app: "grafana" },
            },
            spec: {
                selector: { app: "grafana" },
                ports: [{ port: 3000, targetPort: 3000 }],
            },
        }, { parent: this });

        // Create Secret for admin password
        const grafanaAdminSecret = new k8s.core.v1.Secret("grafana-admin-credentials", {
            metadata: {
                name: "grafana-admin-credentials",
                namespace: args.namespace,
            },
            type: "Opaque",
            stringData: {
                password: args.adminPassword,
            },
        }, { parent: this });

        // Create Ingress for Grafana
        const grafanaIngress = new k8s.networking.v1.Ingress("grafana-ingress", {
            metadata: {
                name: "grafana-ingress",
                namespace: args.namespace,
                annotations: {
                    "kubernetes.io/ingress.class": "nginx",
                    "cert-manager.io/cluster-issuer": "letsencrypt-prod",
                    "nginx.ingress.kubernetes.io/ssl-redirect": "true",
                    ...(args.authProxyHeaderName ? {
                        "nginx.ingress.kubernetes.io/auth-url": "https://auth.${args.domain}/api/verify",
                        "nginx.ingress.kubernetes.io/auth-signin": "https://auth.${args.domain}",
                        "nginx.ingress.kubernetes.io/auth-response-headers": args.authProxyHeaderName,
                    } : {}),
                },
            },
            spec: {
                tls: [
                    {
                        hosts: [args.domain],
                        secretName: `grafana-tls`,
                    },
                ],
                rules: [
                    {
                        host: args.domain,
                        http: {
                            paths: [
                                {
                                    path: "/",
                                    pathType: "Prefix",
                                    backend: {
                                        service: {
                                            name: grafanaService.metadata.name,
                                            port: { number: 3000 },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        }, { parent: this });

        // Create ServiceMonitor for Grafana
        const grafanaServiceMonitor = new k8s.apiextensions.CustomResource("grafana-servicemonitor", {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: "grafana",
                namespace: args.namespace,
                labels: {
                    app: "grafana",
                    "monitoring.coreos.com/name": "grafana",
                },
            },
            spec: {
                selector: {
                    matchLabels: { app: "grafana" },
                },
                endpoints: [{
                    port: "http",
                    path: "/metrics",
                    interval: "15s",
                }],
            },
        }, { parent: this });

        this.service = grafanaService;
        this.deployment = grafanaDeployment;
        this.ingress = grafanaIngress;

        this.registerOutputs({
            service: grafanaService,
            deployment: grafanaDeployment,
            ingress: grafanaIngress,
        });
    }
}
