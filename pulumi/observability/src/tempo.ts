import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export class Tempo extends pulumi.ComponentResource {
    constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:Tempo", name, {}, opts);

        const tempoConfig = new k8s.core.v1.ConfigMap("tempo-config", {
            metadata: {
                name: "tempo-config",
                namespace: "monitoring",
            },
            data: {
                "tempo.yaml": `
server:
  http_listen_port: 3200
distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
storage:
  trace:
    backend: local
    local:
      path: /var/tempo/traces
    retention: 336h  # 14 days
compactor:
  compaction:
    block_retention: 336h
ingester:
  max_block_duration: 15m
metrics_generator:
  storage:
    path: /var/tempo/generator
`
            }
        });

        const tempoPvc = new k8s.core.v1.PersistentVolumeClaim("tempo-storage", {
            metadata: {
                name: "tempo-storage",
                namespace: "monitoring",
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                    requests: {
                        storage: "10Gi",
                    },
                },
                storageClassName: "local-path",
            },
        });

        const tempoDeployment = new k8s.apps.v1.StatefulSet("tempo", {
            metadata: {
                name: "tempo",
                namespace: "monitoring",
            },
            spec: {
                serviceName: "tempo",
                replicas: 1,
                selector: {
                    matchLabels: { app: "tempo" },
                },
                template: {
                    metadata: {
                        labels: { app: "tempo" },
                    },
                    spec: {
                        containers: [{
                            name: "tempo",
                            image: "grafana/tempo:latest",
                            ports: [
                                { containerPort: 3200, name: "http" },
                                { containerPort: 4317, name: "otlp-grpc" },
                                { containerPort: 4318, name: "otlp-http" },
                            ],
                            volumeMounts: [
                                {
                                    name: "config",
                                    mountPath: "/etc/tempo",
                                },
                                {
                                    name: "storage",
                                    mountPath: "/var/tempo",
                                },
                            ],
                            resources: {
                                requests: {
                                    cpu: "100m",
                                    memory: "512Mi",
                                },
                                limits: {
                                    cpu: "1",
                                    memory: "2Gi",
                                },
                            },
                        }],
                        volumes: [
                            {
                                name: "config",
                                configMap: {
                                    name: tempoConfig.metadata.name,
                                },
                            },
                            {
                                name: "storage",
                                persistentVolumeClaim: {
                                    claimName: tempoPvc.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        });

        const tempoService = new k8s.core.v1.Service("tempo", {
            metadata: {
                name: "tempo",
                namespace: "monitoring",
                labels: { app: "tempo" },
            },
            spec: {
                ports: [
                    { port: 3200, name: "http" },
                    { port: 4317, name: "otlp-grpc" },
                    { port: 4318, name: "otlp-http" },
                ],
                selector: { app: "tempo" },
            },
        });

        new k8s.apiextensions.CustomResource("tempo-monitor", {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "ServiceMonitor",
            metadata: {
                name: "tempo",
                namespace: "monitoring",
            },
            spec: {
                selector: {
                    matchLabels: { app: "tempo" },
                },
                endpoints: [{
                    port: "http",
                    path: "/metrics",
                }],
            },
        });
    }
}
