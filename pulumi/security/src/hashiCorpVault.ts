import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";

export interface VaultOptions {
    namespace: pulumi.Input<string>;
    storageClassName?: pulumi.Input<string>;
    storageSize?: pulumi.Input<string>;
    domain: string;
    replicas?: number;
    resources?: {
        limits?: {
            cpu: string;
            memory: string;
        };
        requests?: {
            cpu: string;
            memory: string;
        };
    };
    ui?: {
        enabled: boolean;
        serviceType?: string;
    };
    audit?: {
        enabled: boolean;
        logPath?: string;
        logFormat?: string;
        logRotateDuration?: string;
    };
}

export class HashiCorpVault extends pulumi.ComponentResource {
    public readonly statefulSet: k8s.apps.v1.StatefulSet;
    public readonly service: k8s.core.v1.Service;
    public readonly configMap: k8s.core.v1.ConfigMap;
    public readonly secret: k8s.core.v1.Secret;
    public readonly pvc: k8s.core.v1.PersistentVolumeClaim;
    public readonly ingress: k8s.networking.v1.Ingress;

    constructor(
        name: string,
        options: VaultOptions,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("homelab:security:HashiCorpVault", name, {}, opts);

        const {
            namespace,
            storageClassName = "longhorn",
            storageSize = "10Gi",
            domain,
            replicas = 1,
            resources = {
                limits: {
                    cpu: "1000m",
                    memory: "1Gi",
                },
                requests: {
                    cpu: "250m",
                    memory: "256Mi",
                },
            },
            ui = {
                enabled: true,
                serviceType: "ClusterIP",
            },
            audit = {
                enabled: true,
                logPath: "/vault/logs/audit.log",
                logFormat: "json",
                logRotateDuration: "24h",
            },
        } = options;

        // Generate root key for auto-unsealing
        const rootKey = new random.RandomPassword(`${name}-root-key`, {
            length: 32,
            special: true,
        }, { parent: this });

        // Create Secret for sensitive data
        this.secret = new k8s.core.v1.Secret(`${name}-secret`, {
            metadata: {
                name: `${name}-keys`,
                namespace: namespace,
            },
            stringData: {
                "root-key": rootKey.result,
                "config.hcl": `
disable_mlock = true
ui = ${ui.enabled}

storage "file" {
    path = "/vault/data"
}

listener "tcp" {
    address = "0.0.0.0:8200"
    tls_disable = 1
}

seal "shamir" {
    key_shares = 1
    key_threshold = 1
}

api_addr = "http://127.0.0.1:8200"
cluster_addr = "http://127.0.0.1:8201"
`,
            },
        }, { parent: this });

        // Create PVC for Vault data
        this.pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: {
                name: `${name}-data`,
                namespace: namespace,
            },
            spec: {
                accessModes: ["ReadWriteOnce"],
                storageClassName: storageClassName,
                resources: {
                    requests: {
                        storage: storageSize,
                    },
                },
            },
        }, { parent: this });

        // Create ConfigMap for initialization scripts
        this.configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: `${name}-init`,
                namespace: namespace,
            },
            data: {
                "init-vault.sh": `#!/bin/sh
set -e

# Wait for Vault to start
until curl -fs http://127.0.0.1:8200/v1/sys/health; do
    echo "Waiting for Vault to start..."
    sleep 5
done

# Initialize Vault if needed
init_status=$(curl -s http://127.0.0.1:8200/v1/sys/health | grep initialized)
if [[ $init_status =~ "false" ]]; then
    echo "Initializing Vault..."
    curl -X PUT -H "Content-Type: application/json" \
         -d '{"secret_shares": 1, "secret_threshold": 1}' \
         http://127.0.0.1:8200/v1/sys/init > /vault/data/init.json

    # Store root token and unseal key securely
    export VAULT_TOKEN=$(cat /vault/data/init.json | jq -r '.root_token')
    export UNSEAL_KEY=$(cat /vault/data/init.json | jq -r '.keys[0]')

    # Enable audit logging
    if [ "${audit.enabled}" = "true" ]; then
        curl -X PUT -H "X-Vault-Token: $VAULT_TOKEN" \
             -d "{\"type\": \"file\", \"options\": {\"file_path\": \"${audit.logPath}\", \"format\": \"${audit.logFormat}\"}}" \
             http://127.0.0.1:8200/v1/sys/audit/file
    fi

    # Enable secrets engines
    curl -X POST -H "X-Vault-Token: $VAULT_TOKEN" \
         -d '{"type": "kv", "options": {"version": "2"}}' \
         http://127.0.0.1:8200/v1/sys/mounts/kv

    curl -X POST -H "X-Vault-Token: $VAULT_TOKEN" \
         -d '{"type": "transit"}' \
         http://127.0.0.1:8200/v1/sys/mounts/transit

    curl -X POST -H "X-Vault-Token: $VAULT_TOKEN" \
         -d '{"type": "pki"}' \
         http://127.0.0.1:8200/v1/sys/mounts/pki

    # Enable Kubernetes authentication
    curl -X POST -H "X-Vault-Token: $VAULT_TOKEN" \
         -d '{"type": "kubernetes"}' \
         http://127.0.0.1:8200/v1/sys/auth/kubernetes

    # Configure Kubernetes auth
    curl -X POST -H "X-Vault-Token: $VAULT_TOKEN" \
         -d "{\"kubernetes_host\": \"https://\$KUBERNETES_SERVICE_HOST:\\$KUBERNETES_SERVICE_PORT\"}" \
         http://127.0.0.1:8200/v1/auth/kubernetes/config
fi
`,
            },
        }, { parent: this });

        // Create StatefulSet for Vault
        this.statefulSet = new k8s.apps.v1.StatefulSet(`${name}-statefulset`, {
            metadata: {
                name: name,
                namespace: namespace,
            },
            spec: {
                serviceName: name,
                replicas: replicas,
                selector: {
                    matchLabels: {
                        app: name,
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            app: name,
                        },
                    },
                    spec: {
                        serviceAccountName: `${name}-sa`,
                        containers: [{
                            name: "vault",
                            image: "vault:1.13",
                            command: ["vault", "server", "-config=/vault/config/config.hcl"],
                            ports: [{
                                containerPort: 8200,
                                name: "http",
                            }, {
                                containerPort: 8201,
                                name: "internal",
                            }],
                            resources: resources,
                            securityContext: {
                                capabilities: {
                                    add: ["IPC_LOCK"],
                                },
                            },
                            volumeMounts: [{
                                name: "config",
                                mountPath: "/vault/config",
                                readOnly: true,
                            }, {
                                name: "data",
                                mountPath: "/vault/data",
                            }, {
                                name: "logs",
                                mountPath: "/vault/logs",
                            }],
                            readinessProbe: {
                                httpGet: {
                                    path: "/v1/sys/health",
                                    port: 8200,
                                    scheme: "HTTP",
                                },
                                initialDelaySeconds: 5,
                                periodSeconds: 10,
                            },
                            livenessProbe: {
                                httpGet: {
                                    path: "/v1/sys/health",
                                    port: 8200,
                                    scheme: "HTTP",
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 10,
                            },
                        }],
                        volumes: [{
                            name: "config",
                            secret: {
                                secretName: this.secret.metadata.name,
                            },
                        }, {
                            name: "data",
                            persistentVolumeClaim: {
                                claimName: this.pvc.metadata.name,
                            },
                        }, {
                            name: "logs",
                            emptyDir: {},
                        }],
                    },
                },
            },
        }, { parent: this });

        // Create Service
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                name: name,
                namespace: namespace,
            },
            spec: {
                selector: {
                    app: name,
                },
                ports: [{
                    port: 8200,
                    targetPort: 8200,
                    name: "http",
                }, {
                    port: 8201,
                    targetPort: 8201,
                    name: "internal",
                }],
                type: ui.serviceType,
            },
        }, { parent: this });

        // Create Ingress if UI is enabled
        if (ui.enabled) {
            this.ingress = new k8s.networking.v1.Ingress(`${name}-ingress`, {
                metadata: {
                    name: name,
                    namespace: namespace,
                    annotations: {
                        "kubernetes.io/ingress.class": "traefik",
                        "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
                        "traefik.ingress.kubernetes.io/router.tls": "true",
                    },
                },
                spec: {
                    rules: [{
                        host: `vault.${domain}`,
                        http: {
                            paths: [{
                                path: "/",
                                pathType: "Prefix",
                                backend: {
                                    service: {
                                        name: this.service.metadata.name,
                                        port: {
                                            name: "http",
                                        },
                                    },
                                },
                            }],
                        },
                    }],
                    tls: [{
                        hosts: [`vault.${domain}`],
                        secretName: `${name}-tls`,
                    }],
                },
            }, { parent: this });
        }

        this.registerOutputs({
            serviceName: this.service.metadata.name,
            statefulSetName: this.statefulSet.metadata.name,
            configMapName: this.configMap.metadata.name,
            secretName: this.secret.metadata.name,
            pvcName: this.pvc.metadata.name,
        });
    }
}
