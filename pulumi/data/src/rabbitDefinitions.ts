import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../../cluster-setup/src/k8sProvider";
import * as fs from "fs";
import * as path from "path";

export interface RabbitDefinitionsArgs {
    /**
     * Namespace where RabbitMQ is deployed
     */
    namespace: string;

    /**
     * RabbitMQ service name
     */
    serviceName: string;

    /**
     * Path to directory containing definition YAML files
     */
    definitionsPath: string;

    /**
     * RabbitMQ admin credentials secret name
     */
    adminSecretName: string;

    /**
     * Optional prefix for resource names
     */
    namePrefix?: string;

    /**
     * Optional retry configuration
     */
    retryConfig?: {
        maxAttempts?: number;
        backoffLimit?: number;
        activeDeadlineSeconds?: number;
    };
}

export class RabbitDefinitions extends pulumi.ComponentResource {
    /**
     * The ConfigMap containing RabbitMQ definitions
     */
    public readonly definitionsConfigMap: k8s.core.v1.ConfigMap;

    /**
     * The Job that applies the definitions
     */
    public readonly applyJob: k8s.batch.v1.Job;

    constructor(name: string, args: RabbitDefinitionsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:rabbitmq:Definitions", name, args, opts);

        const prefix = args.namePrefix || "";

        // Load definition files
        const definitions = this.loadDefinitions(args.definitionsPath);

        // Create ConfigMap with definitions
        this.definitionsConfigMap = new k8s.core.v1.ConfigMap(`${prefix}rabbitmq-definitions`, {
            metadata: {
                name: `${prefix}rabbitmq-definitions`,
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq-definitions",
                    "app.kubernetes.io/part-of": "rabbitmq"
                }
            },
            data: {
                "exchanges.yaml": definitions.exchanges || "",
                "queues.yaml": definitions.queues || "",
                "bindings.yaml": definitions.bindings || "",
                "apply-definitions.sh": this.generateApplyScript()
            }
        }, { provider, parent: this });

        // Create Job to apply definitions
        this.applyJob = new k8s.batch.v1.Job(`${prefix}apply-rabbitmq-definitions`, {
            metadata: {
                name: `${prefix}apply-rabbitmq-definitions`,
                namespace: args.namespace,
                labels: {
                    "app.kubernetes.io/name": "rabbitmq-definitions",
                    "app.kubernetes.io/part-of": "rabbitmq"
                }
            },
            spec: {
                backoffLimit: args.retryConfig?.backoffLimit || 6,
                activeDeadlineSeconds: args.retryConfig?.activeDeadlineSeconds || 600,
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "rabbitmq-definitions",
                            "app.kubernetes.io/part-of": "rabbitmq"
                        }
                    },
                    spec: {
                        serviceAccountName: "rabbitmq",
                        restartPolicy: "OnFailure",
                        containers: [{
                            name: "apply-definitions",
                            image: "curlimages/curl:latest",
                            command: ["/bin/sh", "/scripts/apply-definitions.sh"],
                            env: [
                                {
                                    name: "RABBITMQ_HOST",
                                    value: `${args.serviceName}.${args.namespace}.svc.cluster.local`
                                },
                                {
                                    name: "RABBITMQ_PORT",
                                    value: "15672"
                                },
                                {
                                    name: "RABBITMQ_USERNAME",
                                    valueFrom: {
                                        secretKeyRef: {
                                            name: args.adminSecretName,
                                            key: "username"
                                        }
                                    }
                                },
                                {
                                    name: "RABBITMQ_PASSWORD",
                                    valueFrom: {
                                        secretKeyRef: {
                                            name: args.adminSecretName,
                                            key: "password"
                                        }
                                    }
                                },
                                {
                                    name: "MAX_RETRIES",
                                    value: (args.retryConfig?.maxAttempts || 30).toString()
                                }
                            ],
                            volumeMounts: [
                                {
                                    name: "definitions",
                                    mountPath: "/definitions"
                                },
                                {
                                    name: "scripts",
                                    mountPath: "/scripts"
                                }
                            ]
                        }],
                        volumes: [
                            {
                                name: "definitions",
                                configMap: {
                                    name: this.definitionsConfigMap.metadata.name,
                                    items: [
                                        {
                                            key: "exchanges.yaml",
                                            path: "exchanges.yaml"
                                        },
                                        {
                                            key: "queues.yaml",
                                            path: "queues.yaml"
                                        },
                                        {
                                            key: "bindings.yaml",
                                            path: "bindings.yaml"
                                        }
                                    ]
                                }
                            },
                            {
                                name: "scripts",
                                configMap: {
                                    name: this.definitionsConfigMap.metadata.name,
                                    items: [
                                        {
                                            key: "apply-definitions.sh",
                                            path: "apply-definitions.sh",
                                            mode: 0o755
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                }
            }
        }, { provider, parent: this, dependsOn: [this.definitionsConfigMap] });

        this.registerOutputs({
            definitionsConfigMap: this.definitionsConfigMap,
            applyJob: this.applyJob
        });
    }

    private loadDefinitions(definitionsPath: string): { [key: string]: string } {
        const definitions: { [key: string]: string } = {};
        const files = ["exchanges.yaml", "queues.yaml", "bindings.yaml"];

        files.forEach(file => {
            const filePath = path.join(definitionsPath, file);
            if (fs.existsSync(filePath)) {
                definitions[file] = fs.readFileSync(filePath, "utf8");
            }
        });

        return definitions;
    }

    private generateApplyScript(): string {
        return `#!/bin/sh
set -e

echo "Waiting for RabbitMQ to be ready..."
retries=0
while [ $retries -lt $MAX_RETRIES ]; do
    if curl -sS -u "$RABBITMQ_USERNAME:$RABBITMQ_PASSWORD" "http://$RABBITMQ_HOST:$RABBITMQ_PORT/api/health/checks/node" | grep -q "ok"; then
        echo "RabbitMQ is ready"
        break
    fi
    retries=$((retries + 1))
    echo "Attempt $retries/$MAX_RETRIES - RabbitMQ not ready yet, waiting..."
    sleep 10
done

if [ $retries -eq $MAX_RETRIES ]; then
    echo "Error: RabbitMQ failed to become ready"
    exit 1
fi

# Function to apply definitions
apply_definitions() {
    local type=$1
    local file="/definitions/$type.yaml"
    local endpoint="$type"

    if [ -f "$file" ]; then
        echo "Applying $type definitions..."
        while IFS= read -r item; do
            # Skip comments and empty lines
            [[ "$item" =~ ^[[:space:]]*# ]] && continue
            [ -z "$item" ] && continue

            echo "Processing $type definition..."
            status_code=$(curl -s -w "%{http_code}" -o /tmp/response.txt \
                -u "$RABBITMQ_USERNAME:$RABBITMQ_PASSWORD" \
                -H "Content-Type: application/json" \
                -X PUT \
                "http://$RABBITMQ_HOST:$RABBITMQ_PORT/api/$endpoint" \
                -d "$item")

            if [ "$status_code" -ge 400 ]; then
                echo "Error applying $type definition. Status: $status_code"
                cat /tmp/response.txt
                exit 1
            fi
        done < "$file"
        echo "$type definitions applied successfully"
    else
        echo "No $type definitions file found"
    fi
}

# Apply definitions in order
apply_definitions "exchanges"
apply_definitions "queues"
apply_definitions "bindings"

echo "All definitions applied successfully"
`;
    }
}
