import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";

export interface PrometheusRulesArgs {
    /**
     * Namespace where rules will be created
     */
    namespace: string;

    /**
     * Additional labels to apply to rules
     */
    labels?: { [key: string]: string };

    /**
     * Custom thresholds for alerts
     */
    thresholds?: {
        cpu?: {
            warning?: number;
            critical?: number;
        };
        memory?: {
            warning?: number;
            critical?: number;
        };
        disk?: {
            warning?: number;
            critical?: number;
        };
    };

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;
}

export class PrometheusRules extends pulumi.ComponentResource {
    /**
     * The created PrometheusRule resources
     */
    public readonly rules: k8s.apiextensions.CustomResource[];

    constructor(name: string, args: PrometheusRulesArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:PrometheusRules", name, args, opts);

        const prefix = args.namePrefix || "";

        // Default thresholds
        const thresholds = {
            cpu: {
                warning: args.thresholds?.cpu?.warning || 80,
                critical: args.thresholds?.cpu?.critical || 90
            },
            memory: {
                warning: args.thresholds?.memory?.warning || 80,
                critical: args.thresholds?.memory?.critical || 90
            },
            disk: {
                warning: args.thresholds?.disk?.warning || 80,
                critical: args.thresholds?.disk?.critical || 90
            }
        };

        // Common labels
        const labels = {
            "app.kubernetes.io/managed-by": "pulumi",
            "prometheus-operator": "true",
            ...args.labels
        };

        this.rules = [
            // System Health Rules
            new k8s.apiextensions.CustomResource(`${prefix}system-health-rules`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "PrometheusRule",
                metadata: {
                    name: `${prefix}system-health-rules`,
                    namespace: args.namespace,
                    labels: labels
                },
                spec: {
                    groups: [{
                        name: "system.rules",
                        rules: [
                            {
                                alert: "HighCPUUsage",
                                expr: `avg by(node) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100 > ${thresholds.cpu.warning}`,
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "system"
                                },
                                annotations: {
                                    summary: "High CPU usage detected",
                                    description: "CPU usage on {{ $labels.node }} is above {{ $value }}%",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#high-cpu-usage"
                                }
                            },
                            {
                                alert: "CriticalCPUUsage",
                                expr: `avg by(node) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100 > ${thresholds.cpu.critical}`,
                                for: "5m",
                                labels: {
                                    severity: "critical",
                                    domain: "system"
                                },
                                annotations: {
                                    summary: "Critical CPU usage detected",
                                    description: "CPU usage on {{ $labels.node }} is above {{ $value }}%",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#critical-cpu-usage"
                                }
                            },
                            {
                                alert: "HighMemoryUsage",
                                expr: `(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100 > ${thresholds.memory.warning}`,
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "system"
                                },
                                annotations: {
                                    summary: "High memory usage detected",
                                    description: "Memory usage on {{ $labels.node }} is above {{ $value }}%",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#high-memory-usage"
                                }
                            },
                            {
                                alert: "DiskSpaceRunningOut",
                                expr: `(node_filesystem_size_bytes{mountpoint="/"} - node_filesystem_free_bytes{mountpoint="/"}) / node_filesystem_size_bytes{mountpoint="/"} * 100 > ${thresholds.disk.warning}`,
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "system"
                                },
                                annotations: {
                                    summary: "Disk space running low",
                                    description: "Disk usage on {{ $labels.node }} ({{ $labels.mountpoint }}) is above {{ $value }}%",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#disk-space"
                                }
                            }
                        ]
                    }]
                }
            }, { provider, parent: this }),

            // Kubernetes Component Rules
            new k8s.apiextensions.CustomResource(`${prefix}kubernetes-rules`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "PrometheusRule",
                metadata: {
                    name: `${prefix}kubernetes-rules`,
                    namespace: args.namespace,
                    labels: labels
                },
                spec: {
                    groups: [{
                        name: "kubernetes.rules",
                        rules: [
                            {
                                alert: "KubePodCrashLooping",
                                expr: "rate(kube_pod_container_status_restarts_total[5m]) * 60 * 5 > 0",
                                for: "15m",
                                labels: {
                                    severity: "warning",
                                    domain: "kubernetes"
                                },
                                annotations: {
                                    summary: "Pod is crash looping",
                                    description: "Pod {{ $labels.namespace }}/{{ $labels.pod }} is restarting frequently",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#pod-crashlooping"
                                }
                            },
                            {
                                alert: "KubeNodeNotReady",
                                expr: "kube_node_status_condition{condition='Ready',status!='true'} == 1",
                                for: "15m",
                                labels: {
                                    severity: "critical",
                                    domain: "kubernetes"
                                },
                                annotations: {
                                    summary: "Kubernetes node is not ready",
                                    description: "Node {{ $labels.node }} has been unready for more than 15 minutes",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#node-not-ready"
                                }
                            }
                        ]
                    }]
                }
            }, { provider, parent: this }),

            // RabbitMQ Health Rules
            new k8s.apiextensions.CustomResource(`${prefix}rabbitmq-rules`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "PrometheusRule",
                metadata: {
                    name: `${prefix}rabbitmq-rules`,
                    namespace: args.namespace,
                    labels: labels
                },
                spec: {
                    groups: [{
                        name: "rabbitmq.rules",
                        rules: [
                            {
                                alert: "RabbitMQNodeDown",
                                expr: "rabbitmq_up == 0",
                                for: "1m",
                                labels: {
                                    severity: "critical",
                                    domain: "rabbitmq"
                                },
                                annotations: {
                                    summary: "RabbitMQ node is down",
                                    description: "RabbitMQ node {{ $labels.node }} is down",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#rabbitmq-node-down"
                                }
                            },
                            {
                                alert: "RabbitMQHighMemory",
                                expr: "rabbitmq_process_resident_memory_bytes / rabbitmq_resident_memory_limit_bytes * 100 > 80",
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "rabbitmq"
                                },
                                annotations: {
                                    summary: "RabbitMQ high memory usage",
                                    description: "RabbitMQ memory usage is {{ $value }}% of limit",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#rabbitmq-high-memory"
                                }
                            }
                        ]
                    }]
                }
            }, { provider, parent: this }),

            // AI Model Performance Rules
            new k8s.apiextensions.CustomResource(`${prefix}ai-model-rules`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "PrometheusRule",
                metadata: {
                    name: `${prefix}ai-model-rules`,
                    namespace: args.namespace,
                    labels: labels
                },
                spec: {
                    groups: [{
                        name: "ai.model.rules",
                        rules: [
                            {
                                alert: "ModelHighLatency",
                                expr: "rate(triton_inference_request_duration_us[5m]) / 1000 > 1000",
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "ai"
                                },
                                annotations: {
                                    summary: "Model inference latency is high",
                                    description: "Model {{ $labels.model_name }} inference latency is above 1 second",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#model-high-latency"
                                }
                            },
                            {
                                alert: "ModelHighErrorRate",
                                expr: "rate(triton_inference_request_failure[5m]) / rate(triton_inference_request_success[5m]) > 0.1",
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "ai"
                                },
                                annotations: {
                                    summary: "Model error rate is high",
                                    description: "Model {{ $labels.model_name }} has error rate above 10%",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#model-high-error-rate"
                                }
                            }
                        ]
                    }]
                }
            }, { provider, parent: this }),

            // Home Assistant Integration Rules
            new k8s.apiextensions.CustomResource(`${prefix}homeassistant-rules`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "PrometheusRule",
                metadata: {
                    name: `${prefix}homeassistant-rules`,
                    namespace: args.namespace,
                    labels: labels
                },
                spec: {
                    groups: [{
                        name: "homeassistant.rules",
                        rules: [
                            {
                                alert: "HomeAssistantDown",
                                expr: "up{job=\"homeassistant\"} == 0",
                                for: "5m",
                                labels: {
                                    severity: "critical",
                                    domain: "homeassistant"
                                },
                                annotations: {
                                    summary: "Home Assistant is down",
                                    description: "Home Assistant instance has been down for 5 minutes",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#homeassistant-down"
                                }
                            },
                            {
                                alert: "HomeAssistantHighLatency",
                                expr: "rate(homeassistant_request_duration_seconds_sum[5m]) / rate(homeassistant_request_duration_seconds_count[5m]) > 2",
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "homeassistant"
                                },
                                annotations: {
                                    summary: "Home Assistant response time is high",
                                    description: "Home Assistant average response time is above 2 seconds",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#homeassistant-high-latency"
                                }
                            }
                        ]
                    }]
                }
            }, { provider, parent: this }),

            // Network Connectivity Rules
            new k8s.apiextensions.CustomResource(`${prefix}network-rules`, {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "PrometheusRule",
                metadata: {
                    name: `${prefix}network-rules`,
                    namespace: args.namespace,
                    labels: labels
                },
                spec: {
                    groups: [{
                        name: "network.rules",
                        rules: [
                            {
                                alert: "NetworkHighLatency",
                                expr: "rate(node_network_transmit_packets_dropped_total[5m]) > 0",
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "network"
                                },
                                annotations: {
                                    summary: "Network packet drops detected",
                                    description: "Network interface {{ $labels.device }} is dropping packets",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#network-drops"
                                }
                            },
                            {
                                alert: "NetworkSaturation",
                                expr: "rate(node_network_transmit_bytes_total[5m]) / 1024 / 1024 > 100",
                                for: "5m",
                                labels: {
                                    severity: "warning",
                                    domain: "network"
                                },
                                annotations: {
                                    summary: "Network interface saturated",
                                    description: "Network interface {{ $labels.device }} is transmitting more than 100MB/s",
                                    runbook: "https://github.com/yourusername/homelab/wiki/Runbooks#network-saturation"
                                }
                            }
                        ]
                    }]
                }
            }, { provider, parent: this })
        ];

        this.registerOutputs({
            rules: this.rules
        });
    }
}
