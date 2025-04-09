import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";
import * as crypto from "crypto";

export interface GrafanaDashboardsArgs {
    namespace: string;
    dashboardsPath: string;
    organizationFolders?: boolean;
    grafanaLabels?: { [key: string]: string };
    annotations?: { [key: string]: string };
    deploymentName?: string;
}

interface DashboardFolder {
    name: string;
    dashboards: { [filename: string]: string };
}

export class GrafanaDashboards extends pulumi.ComponentResource {
    public readonly configMaps: k8s.core.v1.ConfigMap[];
    public readonly provider: k8s.provider.Provider;

    constructor(name: string, args: GrafanaDashboardsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:monitoring:GrafanaDashboards", name, {}, opts);

        this.configMaps = [];

        // Default values
        const defaultLabels = {
            app: "grafana",
            ...(args.grafanaLabels || {})
        };

        const defaultAnnotations = {
            "grafana-dashboard-version": new Date().toISOString(),
            ...(args.annotations || {})
        };

        // Organize dashboards by folder
        const dashboardFolders: { [folder: string]: DashboardFolder } = {};

        // Load dashboards from the specified path
        try {
            const dashboardFiles = glob.sync(path.join(args.dashboardsPath, "**/*.json"));

            for (const filePath of dashboardFiles) {
                const dashboardContent = fs.readFileSync(filePath, "utf8");
                let dashboardJson: any;

                try {
                    dashboardJson = JSON.parse(dashboardContent);
                } catch (e) {
                    console.warn(`Error parsing dashboard JSON from ${filePath}: ${e}`);
                    continue;
                }

                // Generate a hash of the dashboard content for versioning
                const contentHash = crypto.createHash("md5").update(dashboardContent).digest("hex").substring(0, 8);

                // Determine which folder this dashboard belongs to
                let folderName = "General";

                if (args.organizationFolders) {
                    // Extract folder from directory structure if organizationFolders is true
                    const relativePath = path.relative(args.dashboardsPath, filePath);
                    const pathParts = relativePath.split(path.sep);

                    if (pathParts.length > 1) {
                        folderName = pathParts[0];
                    }
                } else if (dashboardJson.meta && dashboardJson.meta.folderTitle) {
                    // Use the folder title from the JSON if available
                    folderName = dashboardJson.meta.folderTitle;
                } else if (dashboardJson.dashboard && dashboardJson.dashboard.tags && dashboardJson.dashboard.tags.length) {
                    // Use first tag as folder if no folder is specified
                    folderName = dashboardJson.dashboard.tags[0];
                }

                // Initialize folder if it doesn't exist
                if (!dashboardFolders[folderName]) {
                    dashboardFolders[folderName] = {
                        name: folderName,
                        dashboards: {}
                    };
                }

                // Add dashboard to folder with filename as key
                const filename = path.basename(filePath);

                // Ensure dashboard has a proper UID for tracking
                if (!dashboardJson.uid) {
                    const baseUid = path.basename(filePath, ".json").replace(/[^a-zA-Z0-9]/g, "-");
                    dashboardJson.uid = `${baseUid}-${contentHash}`;
                }

                // Add version annotation to the dashboard
                if (!dashboardJson.annotations) {
                    dashboardJson.annotations = {};
                }
                dashboardJson.annotations.version = contentHash;

                // Store the dashboard in the folder
                dashboardFolders[folderName].dashboards[filename] = JSON.stringify(dashboardJson);
            }
        } catch (error) {
            console.error(`Error loading dashboard files: ${error}`);
        }

        // Create provider config map (required for Grafana dashboard provisioning)
        const providerConfigMap = new k8s.core.v1.ConfigMap("grafana-dashboard-provider", {
            metadata: {
                name: "grafana-dashboard-provider",
                namespace: args.namespace,
                labels: defaultLabels,
            },
            data: {
                "provider.yaml": `
apiVersion: 1
providers:
  - name: 'homelab'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
`
            }
        }, { parent: this });

        // Create ConfigMaps for each folder with its dashboards
        for (const [folderName, folder] of Object.entries(dashboardFolders)) {
            // Sanitize folder name to be used in ConfigMap name
            const sanitizedName = folderName.toLowerCase().replace(/[^a-z0-9]/g, "-");

            // Create a ConfigMap for each dashboard to avoid size limits
            for (const [filename, dashboardJson] of Object.entries(folder.dashboards)) {
                const sanitizedFilename = filename.replace(/[^a-zA-Z0-9]/g, "-");

                const configMapName = `grafana-dashboard-${sanitizedName}-${sanitizedFilename}`;

                // Create the dashboard ConfigMap
                const dashboardConfigMap = new k8s.core.v1.ConfigMap(configMapName, {
                    metadata: {
                        name: configMapName,
                        namespace: args.namespace,
                        labels: {
                            ...defaultLabels,
                            "grafana-dashboard": "true",
                            "dashboard-folder": sanitizedName,
                        },
                        annotations: {
                            ...defaultAnnotations,
                            "grafana-folder": folderName,
                        }
                    },
                    data: {
                        [filename]: `
{
  "annotations": {
    "list": []
  },
  "editable": true,
  "fischerwick": false,
  "panels": [],
  "schemaVersion": 26,
  "style": "dark",
  "tags": ["${folderName}"],
  "templating": {
    "list": []
  },
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "timepicker": {},
  "timezone": "",
  "title": "${folderName} Dashboard",
  "uid": "${sanitizedName}-dashboard",
  "version": 1
}
`,
                        [`${sanitizedFilename.replace(".json", "")}.json`]: dashboardJson,
                    }
                }, { parent: this });

                this.configMaps.push(dashboardConfigMap);
            }
        }

        // If a deployment name is provided, patch the deployment to mount the ConfigMaps
        if (args.deploymentName) {
            // Create a patch for the Grafana deployment
            const grafanaPatch = new k8s.apps.v1.Deployment(`${args.deploymentName}-dashboards-patch`, {
                metadata: {
                    name: args.deploymentName,
                    namespace: args.namespace,
                },
                spec: {
                    template: {
                        spec: {
                            volumes: [
                                {
                                    name: "dashboards-provider",
                                    configMap: {
                                        name: providerConfigMap.metadata.name,
                                    },
                                },
                                ...this.configMaps.map(cm => ({
                                    name: `dashboard-${cm.metadata.name}`,
                                    configMap: {
                                        name: cm.metadata.name,
                                    },
                                })),
                            ],
                            containers: [{
                                name: "grafana",
                                volumeMounts: [
                                    {
                                        name: "dashboards-provider",
                                        mountPath: "/etc/grafana/provisioning/dashboards",
                                    },
                                    ...this.configMaps.map(cm => ({
                                        name: `dashboard-${cm.metadata.name}`,
                                        mountPath: `/var/lib/grafana/dashboards/${cm.metadata.labels["dashboard-folder"]}`,
                                    })),
                                ],
                            }],
                        },
                    },
                },
            }, { parent: this });
        }

        // Register outputs
        this.registerOutputs({
            configMaps: this.configMaps,
            providerConfigMap: providerConfigMap,
        });
    }

    /**
     * Helper method to create a dashboard update or sync job
     * @param name Name of the job
     * @param args Job configuration arguments
     * @returns Kubernetes Job resource
     */
    public createDashboardSyncJob(name: string, args: {
        namespace: string;
        grafanaUrl: string;
        apiKey: pulumi.Input<string>;
        dashboardsPath: string;
        syncInterval?: string;
    }): k8s.batch.v1.Job {
        const job = new k8s.batch.v1.Job(`grafana-dashboard-sync-${name}`, {
            metadata: {
                name: `grafana-dashboard-sync-${name}`,
                namespace: args.namespace,
            },
            spec: {
                template: {
                    spec: {
                        containers: [{
                            name: "dashboard-sync",
                            image: "curlimages/curl:latest",
                            command: ["/bin/sh", "-c"],
                            args: [
                                `
                                cd /tmp
                                for file in /dashboards/**/*.json; do
                                  echo "Processing $file"
                                  curl -X POST ${args.grafanaUrl}/api/dashboards/db \
                                    -H "Content-Type: application/json" \
                                    -H "Authorization: Bearer $API_KEY" \
                                    -d @$file
                                  echo ""
                                  sleep 1
                                done
                                echo "Dashboard sync completed"
                                `
                            ],
                            env: [
                                {
                                    name: "API_KEY",
                                    valueFrom: {
                                        secretKeyRef: {
                                            name: "grafana-api-key",
                                            key: "key",
                                        },
                                    },
                                },
                            ],
                            volumeMounts: [
                                {
                                    name: "dashboards-volume",
                                    mountPath: "/dashboards",
                                },
                            ],
                        }],
                        restartPolicy: "OnFailure",
                        volumes: [
                            {
                                name: "dashboards-volume",
                                hostPath: {
                                    path: args.dashboardsPath,
                                },
                            },
                        ],
                    },
                },
            },
        }, { parent: this });

        return job;
    }

    /**
     * Helper method to create a CronJob for periodic dashboard updates
     * @param name Name of the cronjob
     * @param args CronJob configuration arguments
     * @returns Kubernetes CronJob resource
     */
    public createDashboardUpdateCronJob(name: string, args: {
        namespace: string;
        grafanaUrl: string;
        apiKey: pulumi.Input<string>;
        dashboardsPath: string;
        schedule: string;
    }): k8s.batch.v1.CronJob {
        const cronJob = new k8s.batch.v1.CronJob(`grafana-dashboard-update-${name}`, {
            metadata: {
                name: `grafana-dashboard-update-${name}`,
                namespace: args.namespace,
            },
            spec: {
                schedule: args.schedule,
                jobTemplate: {
                    spec: {
                        template: {
                            spec: {
                                containers: [{
                                    name: "dashboard-update",
                                    image: "curlimages/curl:latest",
                                    command: ["/bin/sh", "-c"],
                                    args: [
                                        `
                                        cd /tmp
                                        for file in /dashboards/**/*.json; do
                                          echo "Processing $file"
                                          curl -X POST ${args.grafanaUrl}/api/dashboards/db \
                                            -H "Content-Type: application/json" \
                                            -H "Authorization: Bearer $API_KEY" \
                                            -d @$file
                                          echo ""
                                          sleep 1
                                        done
                                        echo "Dashboard update completed"
                                        `
                                    ],
                                    env: [
                                        {
                                            name: "API_KEY",
                                            valueFrom: {
                                                secretKeyRef: {
                                                    name: "grafana-api-key",
                                                    key: "key",
                                                },
                                            },
                                        },
                                    ],
                                    volumeMounts: [
                                        {
                                            name: "dashboards-volume",
                                            mountPath: "/dashboards",
                                        },
                                    ],
                                }],
                                restartPolicy: "OnFailure",
                                volumes: [
                                    {
                                        name: "dashboards-volume",
                                        hostPath: {
                                            path: args.dashboardsPath,
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        }, { parent: this });

        return cronJob;
    }
}
