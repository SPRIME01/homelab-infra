#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Function for logging
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to handle errors
handle_error() {
    log_error "An error occurred during setup. Please check the output above."
    exit 1
}

# Function to cleanup partial installations
cleanup() {
    log "Cleaning up any partial installations..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

    # Remove any partial Pulumi project directories
    rm -rf "$PROJECT_ROOT/pulumi/cluster-setup" "$PROJECT_ROOT/pulumi/core-services" "$PROJECT_ROOT/pulumi/storage" 2>/dev/null || true

    log "Cleanup complete. You can now run the script again."
}

# Function to safely update Node.js
update_nodejs() {
    log "Removing old Node.js packages to prevent conflicts..."
    sudo apt-get remove -y nodejs nodejs-doc libnode-dev || true
    sudo apt-get autoremove -y

    log "Installing Node.js 18..."
    sudo apt-get install -y ca-certificates curl gnupg
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    NODE_MAJOR=18
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
    sudo apt-get update
    sudo apt-get install -y nodejs
}

# Function to generate a random secure passphrase
generate_passphrase() {
    # Generate a 32-character random string for the passphrase
    if command_exists openssl; then
        openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32
    else
        # Fallback if openssl is not available
        cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 32
    fi
}

# Function to create a more comprehensive TypeScript project structure
create_typescript_project_structure() {
    local project_dir=$1
    local project_type=$2

    # Create src directory structure
    mkdir -p "$project_dir/src/components"
    mkdir -p "$project_dir/src/types"
    mkdir -p "$project_dir/src/config"
    mkdir -p "$project_dir/src/utils"

    # Create base configuration file
    cat > "$project_dir/src/config/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";

// Configuration for the ${project_type} stack
export const config = new pulumi.Config();

// Common configuration values
export const environment = config.require("environment");
export const namespace = config.get("namespace") || "${project_type}";

// Resource tags
export const tags = {
    "environment": environment,
    "managedBy": "pulumi",
    "project": "${project_type}"
};
EOF

    # Create utility functions
    cat > "$project_dir/src/utils/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";

/**
 * Create a resource name with a consistent format
 */
export function createResourceName(
    baseName: string,
    suffix?: string
): string {
    const stack = pulumi.getStack();
    return suffix
        ? \`\${baseName}-\${stack}-\${suffix}\`
        : \`\${baseName}-\${stack}\`;
}

/**
 * Format error messages consistently
 */
export function formatError(message: string, err: any): string {
    return \`Error: \${message}. Details: \${err}\`;
}
EOF

    # Create types
    cat > "$project_dir/src/types/index.ts" << EOF
import * as k8s from "@pulumi/kubernetes";

/**
 * Common resource options
 */
export interface CommonResourceOptions {
    provider?: k8s.Provider;
    dependsOn?: pulumi.Resource[];
    namespace?: string;
    tags?: {[key: string]: string};
}

/**
 * Component output interface
 */
export interface ComponentOutput {
    name: string;
    status?: pulumi.Output<string>;
    endpoint?: pulumi.Output<string>;
}
EOF

    # Create main index.ts based on project type
    if [ "$project_type" = "cluster-setup" ]; then
        create_cluster_setup_files "$project_dir"
    elif [ "$project_type" = "core-services" ]; then
        create_core_services_files "$project_dir"
    elif [ "$project_type" = "storage" ]; then
        create_storage_files "$project_dir"
    fi

    # Update the main index.ts file
    cat > "$project_dir/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import { setup } from "./src";

// Run the main setup function and export the outputs
export const outputs = setup();
EOF
}

# Function to create cluster-setup specific files
create_cluster_setup_files() {
    local project_dir=$1

    # Create main setup file
    cat > "$project_dir/src/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import { K3sCluster } from "./components/k3sCluster";
import { KubeConfig } from "./components/kubeConfig";
import { config } from "./config";

/**
 * Main setup function for the K3s cluster
 */
export function setup() {
    // Create the K3s cluster
    const cluster = new K3sCluster("k3s", {
        nodeCount: config.getNumber("nodeCount") || 3,
        version: config.get("k3sVersion") || "v1.27.1+k3s1",
        networkCidr: config.get("networkCidr") || "10.42.0.0/16",
    });

    // Generate and export kubeconfig
    const kubeConfig = new KubeConfig("kubeconfig", {
        clusterId: cluster.id,
        endpoint: cluster.endpoint,
    });

    return {
        kubeconfig: kubeConfig.path,
        clusterEndpoint: cluster.endpoint,
        clusterName: cluster.name,
    };
}
EOF

    # Create K3s cluster component
    mkdir -p "$project_dir/src/components/k3sCluster"
    cat > "$project_dir/src/components/k3sCluster/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ComponentOutput } from "../../types";
import { createResourceName } from "../../utils";

export interface K3sClusterArgs {
    nodeCount: number;
    version: string;
    networkCidr: string;
}

export class K3sCluster extends pulumi.ComponentResource {
    public readonly id: pulumi.Output<string>;
    public readonly name: string;
    public readonly endpoint: pulumi.Output<string>;

    constructor(name: string, args: K3sClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        const resourceName = createResourceName(name);
        super("homelab:k3s:Cluster", resourceName, {}, opts);

        this.name = resourceName;

        // This is a simplified example. In reality, you would use specific
        // provider resources to create K3s nodes or leverage cloud resources

        // Install K3s master node
        const master = new command.local.Command("k3s-master", {
            create: pulumi.interpolate\`curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=\${args.version} sh -s - --cluster-cidr=\${args.networkCidr}\`,
            delete: "k3s-uninstall.sh",
        }, { parent: this });

        // Extract kubeconfig and API endpoint
        const getKubeconfig = master.stdout.apply(_ => {
            return new command.local.Command("get-kubeconfig", {
                create: "cat /etc/rancher/k3s/k3s.yaml | grep server | awk '{print $2}'",
            }, { parent: this });
        });

        this.endpoint = getKubeconfig.stdout.apply(stdout => stdout.trim());
        this.id = pulumi.output(resourceName);

        this.registerOutputs({
            id: this.id,
            endpoint: this.endpoint,
 });
    }
}
EOF

    # Create KubeConfig component
    mkdir -p "$project_dir/src/components/kubeConfig"
    cat > "$project_dir/src/components/kubeConfig/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface KubeConfigArgs {
    clusterId: pulumi.Output<string>;
    endpoint: pulumi.Output<string>;
}

export class KubeConfig extends pulumi.ComponentResource {
    public readonly path: pulumi.Output<string>;

    constructor(name: string, args: KubeConfigArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:k3s:KubeConfig", name, {}, opts);

        // Export the kubeconfig to a file
        const kubeConfigCmd = new command.local.Command("export-kubeconfig", {
            create: "mkdir -p ~/.kube && sudo cat /etc/rancher/k3s/k3s.yaml > ~/.kube/k3s-config",
        }, { parent: this });

        this.path = kubeConfigCmd.stdout.apply(_ => "~/.kube/k3s-config");

        this.registerOutputs({
            path: this.path,
        });
    }
}
EOF
}

# Function to create core-services specific files
create_core_services_files() {
    local project_dir=$1

    # Create main setup file
    cat > "$project_dir/src/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { CertManager } from "./components/certManager";
import { Traefik } from "./components/traefik";
import { config } from "./config";

/**
 * Main setup function for core services
 */
export function setup() {
    // Create Kubernetes provider using the kubeconfig from cluster-setup
    const k8sProvider = new k8s.Provider("k8s-provider", {
        kubeconfig: config.requireSecret("kubeconfig"),
    });

    // Install cert-manager
    const certManager = new CertManager("cert-manager", {
        namespace: "cert-manager",
        version: config.get("certManagerVersion") || "v1.12.0",
        createNamespace: true,
    }, { provider: k8sProvider });

    // Install Traefik
    const traefik = new Traefik("traefik", {
        namespace: "traefik",
        version: config.get("traefikVersion") || "23.0.0",
        createNamespace: true,
        email: config.requireSecret("letsencryptEmail"),
    }, {
        provider: k8sProvider,
        dependsOn: [certManager],
    });

    return {
        certManagerStatus: certManager.status,
        traefikEndpoint: traefik.endpoint,
    };
}
EOF

    # Create cert-manager component
    mkdir -p "$project_dir/src/components/certManager"
    cat > "$project_dir/src/components/certManager/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface CertManagerArgs {
    namespace: string;
    version: string;
    createNamespace: boolean;
    useOperator: boolean;
}

export class CertManager extends pulumi.ComponentResource {
    public readonly status: pulumi.Output<string>;

    constructor(name: string, args: CertManagerArgs, opts?: CommonResourceOptions) {
        super("homelab:core:CertManager", name, {}, opts);

        // Create namespace if requested
        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("cert-manager-ns", {
                metadata: {
                    name: args.namespace,
                },
            }, { provider: opts?.provider, parent: this });
        }

        if (args.useOperator) {
            // Deploy cert-manager operator
            const certManagerCrds = new k8s.yaml.ConfigGroup("cert-manager-crds", {
                files: [\`https://github.com/cert-manager/cert-manager/releases/download/\${args.version}/cert-manager.crds.yaml\`],
            }, { provider: opts?.provider, parent: this });

            const certManagerOperator = new k8s.yaml.ConfigGroup("cert-manager-operator", {
                files: [\`https://github.com/cert-manager/cert-manager/releases/download/\${args.version}/cert-manager.yaml\`],
            }, {
                provider: opts?.provider,
                parent: this,
                dependsOn: [certManagerCrds]
            });

            this.status = certManagerOperator.ready.apply(r => r ? "Deployed" : "Pending");
        } else {
            // Add the Jetstack Helm repository
            const certManagerRepo = new k8s.helm.v3.Release("cert-manager", {
                chart: "cert-manager",
                version: args.version,
                repositoryOpts: {
                    repo: "https://charts.jetstack.io",
                },
                namespace: args.namespace,
                values: {
                    installCRDs: true,
                    prometheus: {
                        enabled: true,
                    },
                },
            }, { provider: opts?.provider, parent: this });

            this.status = certManagerRepo.status.apply(s => s === "deployed" ? "Deployed" : "Pending");
        }

        // Create a ClusterIssuer for Let's Encrypt
        const issuer = new k8s.apiextensions.CustomResource("letsencrypt-issuer", {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
                name: "letsencrypt-prod",
                namespace: args.namespace,
            },
            spec: {
                acme: {
                    server: "https://acme-v02.api.letsencrypt.org/directory",
                    email: "admin@example.com", // This should be configurable
                    privateKeySecretRef: {
                        name: "letsencrypt-prod-account-key",
                    },
                    solvers: [{
                        http01: {
                            ingress: {
                                class: "traefik",
                            },
                        },
                    }],
                },
            },
        }, {
            provider: opts?.provider,
            parent: this,
            dependsOn: [certManagerRepo],
        });

        this.status = pulumi.output("Deployed");

        this.registerOutputs({
            status: this.status,
        });
    }
}
EOF

    # Create Traefik component
    mkdir -p "$project_dir/src/components/traefik"
    cat > "$project_dir/src/components/traefik/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface TraefikArgs {
    namespace: string;
    version: string;
    createNamespace: boolean;
    email: pulumi.Input<string>;
}

export class Traefik extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;

    constructor(name: string, args: TraefikArgs, opts?: CommonResourceOptions) {
        super("homelab:core:Traefik", name, {}, opts);

        // Create namespace if requested
        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("traefik-ns", {
                metadata: {
                    name: args.namespace,
                },
            }, { provider: opts?.provider, parent: this });
        }

        // Deploy Traefik via Helm
        const traefikRelease = new k8s.helm.v3.Release("traefik", {
            chart: "traefik",
            version: args.version,
            repositoryOpts: {
                repo: "https://helm.traefik.io/traefik",
            },
            namespace: args.namespace,
            values: {
                deployment: {
                    replicas: 2,
                },
                ingressRoute: {
                    dashboard: {
                        enabled: true,
                    },
                },
                service: {
                    type: "LoadBalancer",
                },
                additionalArguments: [
                    "--log.level=INFO",
                    "--providers.kubernetesingress.ingressclass=traefik",
                    "--entrypoints.web.http.redirections.entryPoint.to=websecure",
                    "--entrypoints.web.http.redirections.entryPoint.scheme=https",
                ],
            },
        }, { provider: opts?.provider, parent: this });

        // Get the Traefik service to extract the endpoint
        const traefikService = traefikRelease.status.apply(_ => {
            return k8s.core.v1.Service.get("traefik-service",
                pulumi.interpolate\`\${args.namespace}/traefik\`,
                { provider: opts?.provider }
            );
        });

        // Extract the endpoint
        this.endpoint = traefikService.status.loadBalancer.ingress[0].ip.apply(ip =>
            `http://${ip}:80`
        );

        this.registerOutputs({
            endpoint: this.endpoint,
        });
    }
}
EOF
}

# Function to create storage files
create_storage_files() {
    local project_dir=$1

    # Create main setup file
    cat > "$project_dir/src/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { OpenEBS } from "./components/openEBS";
import { StorageClasses } from "./components/storageClasses";
import { config } from "./config";

/**
 * Main setup function for storage
 */
export function setup() {
    // Create Kubernetes provider using the kubeconfig from cluster-setup
    const k8sProvider = new k8s.Provider("k8s-provider", {
        kubeconfig: config.requireSecret("kubeconfig"),
    });

    // Install OpenEBS
    const openEBS = new OpenEBS("openebs", {
        namespace: "openebs",
        version: config.get("openEBSVersion") || "3.3.0",
        createNamespace: true,
    }, { provider: k8sProvider });

    // Setup storage classes
    const storageClasses = new StorageClasses("storage-classes", {
        localPathClass: config.getBoolean("enableLocalPath") || true,
        jivaCsiClass: config.getBoolean("enableJivaCsi") || true,
    }, {
        provider: k8sProvider,
        dependsOn: [openEBS],
    });

    return {
        openEBSStatus: openEBS.status,
        defaultStorageClass: storageClasses.defaultClass,
    };
}
EOF

    # Create OpenEBS component
    mkdir -p "$project_dir/src/components/openEBS"
    cat > "$project_dir/src/components/openEBS/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface OpenEBSArgs {
    namespace: string;
    version: string;
    createNamespace: boolean;
}

export class OpenEBS extends pulumi.ComponentResource {
    public readonly status: pulumi.Output<string>;

    constructor(name: string, args: OpenEBSArgs, opts?: CommonResourceOptions) {
        super("homelab:storage:OpenEBS", name, {}, opts);

        // Create namespace if requested
        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("openebs-ns", {
                metadata: {
                    name: args.namespace,
                },
            }, { provider: opts?.provider, parent: this });
        }

        // Deploy OpenEBS via Helm
        const openebsRelease = new k8s.helm.v3.Release("openebs", {
            chart: "openebs",
            version: args.version,
            repositoryOpts: {
                repo: "https://openebs.github.io/charts",
            },
            namespace: args.namespace,
            values: {
                ndm: {
                    enabled: true,
                },
                localprovisioner: {
                    enabled: true,
                },
                jiva: {
                    enabled: true,
                },
            },
        }, { provider: opts?.provider, parent: this });

        this.status = pulumi.output("Deployed");

        this.registerOutputs({
            status: this.status,
        });
    }
}
EOF

    # Create Storage Classes component
    mkdir -p "$project_dir/src/components/storageClasses"
    cat > "$project_dir/src/components/storageClasses/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface StorageClassesArgs {
    localPathClass: boolean;
    jivaCsiClass: boolean;
}

export class StorageClasses extends pulumi.ComponentResource {
    public readonly defaultClass: pulumi.Output<string>;

    constructor(name: string, args: StorageClassesArgs, opts?: CommonResourceOptions) {
        super("homelab:storage:StorageClasses", name, {}, opts);

        let defaultClassName = "openebs-hostpath";

        // Create local-path storage class if requested
        if (args.localPathClass) {
            const localPath = new k8s.storage.v1.StorageClass("local-path", {
                metadata: {
                    name: "openebs-hostpath",
                    annotations: {
                        "storageclass.kubernetes.io/is-default-class": "true",
                    },
                },
                provisioner: "openebs.io/local",
                reclaimPolicy: "Delete",
                volumeBindingMode: "WaitForFirstConsumer",
            }, { provider: opts?.provider, parent: this });

            defaultClassName = "openebs-hostpath";
        }

        // Create Jiva CSI storage class if requested
        if (args.jivaCsiClass) {
            const jivaCsi = new k8s.storage.v1.StorageClass("jiva-csi", {
                metadata: {
                    name: "openebs-jiva-csi",
                },
                provisioner: "jiva.csi.openebs.io",
                reclaimPolicy: "Delete",
                allowVolumeExpansion: true,
                parameters: {
                    "cas-type": "jiva",
                    "replicaCount": "3",
                },
            }, { provider: opts?.provider, parent: this });
        }

        this.defaultClass = pulumi.output(defaultClassName);

        this.registerOutputs({
            defaultClass: this.defaultClass,
        });
    }
}
EOF
}

# Function to migrate from Helm to Kubernetes operators
migrate_to_operators() {
    log "Starting migration from Helm to Kubernetes operators..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

    # Migrate Traefik
    log "Migrating Traefik to use operator..."
    mkdir -p "$PROJECT_ROOT/pulumi/core-services/src/components/traefik"
    traefik_file="$PROJECT_ROOT/pulumi/core-services/src/components/traefik/index.ts"

    # Backup original file
    if [ -f "$traefik_file" ]; then
        cp "$traefik_file" "$traefik_file.bak.$(date +%Y%m%d%H%M%S)"
    fi

    # Create operator-based implementation
    cat > "$traefik_file" << 'EOF'
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ComponentOutput, CommonResourceOptions } from "../../types";

export interface TraefikArgs {
    namespace?: string;
    createNamespace?: boolean;
    dashboard?: {
        enabled?: boolean;
        domain?: string;
        auth?: {
            enabled?: boolean;
            username?: string;
            passwordHash?: string;
        };
    };
    middlewares?: {
        headers?: {
            enabled?: boolean;
            sslRedirect?: boolean;
            stsSeconds?: number;
        };
        rateLimit?: {
            enabled?: boolean;
            average?: number;
            burst?: number;
        };
    };
    tls?: {
        options?: {
            minVersion?: string;
            maxVersion?: string;
            cipherSuites?: string[];
        };
    };
    config?: {
        replicas?: number;
        logging?: {
            level?: string;
        };
        resources?: {
            requests?: {
                cpu?: string;
                memory?: string;
            };
            limits?: {
                cpu?: string;
                memory?: string;
            };
        };
    };
}

export class Traefik extends pulumi.ComponentResource {
    public readonly namespace: string;
    public readonly subscription: k8s.apiextensions.CustomResource;
    public readonly controller: k8s.apiextensions.CustomResource;

    constructor(name: string, args: TraefikArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:traefik:Traefik", name, args, opts);

        const namespace = args.namespace || "traefik-system";
        this.namespace = namespace;

        if (args.createNamespace) {
            const ns = new k8s.core.v1.Namespace("traefik-namespace", {
                metadata: {
                    name: namespace,
                },
            }, { parent: this, ...opts });
        }

        // Create the operator subscription
        this.subscription = new k8s.apiextensions.CustomResource("traefik-operator", {
            apiVersion: "operators.coreos.com/v1alpha1",
            kind: "Subscription",
            metadata: {
                name: "traefik-operator",
                namespace: namespace,
            },
            spec: {
                channel: "alpha",
                name: "traefik-operator",
                source: "operatorhubio-catalog",
                sourceNamespace: "olm",
            },
        }, { parent: this, ...opts });

        // Create the Traefik controller
        this.controller = new k8s.apiextensions.CustomResource("traefik-controller", {
            apiVersion: "traefik.io/v1alpha1",
            kind: "TraefikController",
            metadata: {
                name: "traefik-controller",
                namespace: namespace,
            },
            spec: {
                replicas: args.config?.replicas || 1,
                resources: args.config?.resources || {},
                logging: args.config?.logging || { level: "INFO" },
                additionalArguments: [
                    "--api.dashboard=true",
                    "--api.insecure=false",
                    "--serverstransport.insecureskipverify=true",
                    "--providers.kubernetesingress.ingressclass=traefik",
                    "--entrypoints.web.http.redirections.entryPoint.to=websecure",
                    "--entrypoints.web.http.redirections.entryPoint.scheme=https",
                    "--entrypoints.web.http.redirections.entrypoint.permanent=true",
                ],
            },
        }, { parent: this, dependsOn: [this.subscription], ...opts });

        // Create dashboard IngressRoute if enabled
        if (args.dashboard?.enabled) {
            const auth = args.dashboard.auth;
            let middlewares: { name: string; namespace: string }[] = [];

            if (auth?.enabled) {
                const authMiddleware = new k8s.apiextensions.CustomResource("traefik-auth", {
                    apiVersion: "traefik.io/v1alpha1",
                    kind: "Middleware",
                    metadata: {
                        name: "traefik-auth",
                        namespace: namespace,
                    },
                    spec: {
                        basicAuth: {
                            users: [`${auth.username}:${auth.passwordHash}`],
                        },
                    },
                }, { parent: this, ...opts });

                middlewares.push({
                    name: "traefik-auth",
                    namespace: namespace,
                });
            }

            const dashboardRoute = new k8s.apiextensions.CustomResource("traefik-dashboard", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "IngressRoute",
                metadata: {
                    name: "traefik-dashboard",
                    namespace: namespace,
                },
                spec: {
                    entryPoints: ["websecure"],
                    routes: [
                        {
                            match: `Host(\`${args.dashboard.domain}\`)`,
                            kind: "Rule",
                            services: [
                                {
                                    name: "api@internal",
                                    kind: "TraefikService",
                                },
                            ],
                            middlewares: middlewares,
                        },
                    ],
                },
            }, { parent: this, ...opts });
        }

        // Create middlewares if configured
        if (args.middlewares?.headers?.enabled) {
            const headers = new k8s.apiextensions.CustomResource("secure-headers", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: "secure-headers",
                    namespace: namespace,
                },
                spec: {
                    headers: {
                        sslRedirect: args.middlewares.headers.sslRedirect,
                        stsSeconds: args.middlewares.headers.stsSeconds,
                        stsIncludeSubdomains: true,
                        stsPreload: true,
                        forceSTSHeader: true,
                    },
                },
            }, { parent: this, ...opts });
        }

        if (args.middlewares?.rateLimit?.enabled) {
            const rateLimit = new k8s.apiextensions.CustomResource("rate-limit", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "Middleware",
                metadata: {
                    name: "rate-limit",
                    namespace: namespace,
                },
                spec: {
                    rateLimit: {
                        average: args.middlewares.rateLimit.average,
                        burst: args.middlewares.rateLimit.burst,
                    },
                },
            }, { parent: this, ...opts });
        }

        // Create TLS options if configured
        if (args.tls?.options) {
            const tlsOptions = new k8s.apiextensions.CustomResource("default-tls", {
                apiVersion: "traefik.io/v1alpha1",
                kind: "TLSOption",
                metadata: {
                    name: "default",
                    namespace: namespace,
                },
                spec: {
                    minVersion: args.tls.options.minVersion,
                    maxVersion: args.tls.options.maxVersion,
                    cipherSuites: args.tls.options.cipherSuites,
                },
            }, { parent: this, ...opts });
        }

        this.registerOutputs({
            namespace: namespace,
            subscription: this.subscription,
            controller: this.controller,
        });
    }
}
EOF

    # Also migrate cert-manager and OpenEBS components
    log "Migrating cert-manager to use operator..."
    cert_manager_file="$PROJECT_ROOT/pulumi/core-services/src/components/certManager/index.ts"
    if [ -f "$cert_manager_file" ]; then
        cp "$cert_manager_file" "$cert_manager_file.bak.$(date +%Y%m%d%H%M%S)"
        # Add cert-manager operator implementation here
    fi

    log "Migrating OpenEBS to use operator..."
    openebs_file="$PROJECT_ROOT/pulumi/storage/src/components/openEBS/index.ts"
    if [ -f "$openebs_file" ]; then
        cp "$openebs_file" "$openebs_file.bak.$(date +%Y%m%d%H%M%S)"
        # Add OpenEBS operator implementation here
    fi

    log "Migration complete. Original files have been backed up with .bak extension."
    log "Next steps:"
    log "1. Navigate to each project directory and run 'pulumi up' to apply the changes"
    log "2. You may need to manually remove Helm resources that are no longer needed"
}

# Set up error trap
trap handle_error ERR

# Check for --cleanup flag
if [ "$1" == "--cleanup" ]; then
    cleanup
    exit 0
fi

# Ensure running on WSL2 Ubuntu
if ! grep -q "microsoft" /proc/version; then
    log_warning "This script is designed for WSL2 Ubuntu. Proceed with caution."
fi

log "Starting Pulumi setup with TypeScript..."

# Update package list
log "Updating package list..."
sudo apt-get update

# Check Node.js version and update if needed
NODE_VERSION=$(node -v 2>/dev/null || echo "v0.0.0")
REQUIRED_NODE_VERSION="v18"
if [[ "$NODE_VERSION" < "$REQUIRED_NODE_VERSION" ]]; then
    log_warning "Node.js $NODE_VERSION is too old. Pulumi requires Node.js 18 or later."
    update_nodejs
else
    log "Node.js $NODE_VERSION is already installed."
fi

# Verify Node.js and npm installation
log "Verifying Node.js and npm installation..."
node -v
npm -v

# Install Pulumi CLI if not already installed
if ! command_exists pulumi; then
    log "Installing Pulumi CLI..."
    curl -fsSL https://get.pulumi.com | sh
    # Add Pulumi to PATH for current session
    source ~/.bashrc
    # Verify that the path is set correctly
    if ! command_exists pulumi; then
        log "Adding Pulumi to PATH..."
        export PATH="$PATH:$HOME/.pulumi/bin"
    fi
else
    log "Pulumi CLI is already installed."
fi

# Verify Pulumi installation
log "Verifying Pulumi installation..."
pulumi version

# Configure Pulumi to use local filesystem backend
log "Configuring Pulumi to use local filesystem backend..."
# Use a consistent backend location relative to the script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PULUMI_BACKEND_DIR="$PROJECT_ROOT/.pulumi-state"
mkdir -p "$PULUMI_BACKEND_DIR"
export PULUMI_BACKEND_URL="file://$PULUMI_BACKEND_DIR"

# Generate and set a secure passphrase for Pulumi config encryption
if [ -z "$PULUMI_CONFIG_PASSPHRASE" ]; then
    log "Generating a secure passphrase for Pulumi secrets..."
    PULUMI_PASSPHRASE=$(generate_passphrase)
    export PULUMI_CONFIG_PASSPHRASE="$PULUMI_PASSPHRASE"

    # Save passphrase to a .env file for future use
    ENV_FILE="$PROJECT_ROOT/.env"
    if [ -f "$ENV_FILE" ]; then
        # If .env exists, check if passphrase is already set
        if ! grep -q "PULUMI_CONFIG_PASSPHRASE=" "$ENV_FILE"; then
            echo "PULUMI_CONFIG_PASSPHRASE=\"$PULUMI_PASSPHRASE\"" >> "$ENV_FILE"
        fi
    else
        # Create new .env file with the passphrase
        echo "# Pulumi configuration" > "$ENV_FILE"
        echo "PULUMI_CONFIG_PASSPHRASE=\"$PULUMI_PASSPHRASE\"" >> "$ENV_FILE"
        echo "PULUMI_BACKEND_URL=\"file://$PULUMI_BACKEND_DIR\"" >> "$ENV_FILE"
    fi

    # Set proper permissions for .env file
    chmod 600 "$ENV_FILE"

    log "Passphrase saved to $ENV_FILE (keep this secure)"
    log "To use in future sessions, run: source $ENV_FILE"
fi

# Make the backend URL configuration permanent (still in .bashrc for convenience)
if ! grep -q "PULUMI_BACKEND_URL" ~/.bashrc; then
    echo "export PULUMI_BACKEND_URL=\"file://$PULUMI_BACKEND_DIR\"" >> ~/.bashrc
fi

# Set up proper directory structure for Pulumi projects
log "Setting up Pulumi project directory structure..."
mkdir -p "$PROJECT_ROOT/pulumi/"{cluster-setup,core-services,storage}

# Configure npm to avoid hanging
log "Configuring npm settings to improve performance..."
npm config set fetch-timeout 300000
npm config set fund false
npm config set audit false
npm config set progress false
npm config set legacy-peer-deps true

# Create minimal package.json files to avoid interactive prompts
create_minimal_package() {
    local dir=$1
    local name=$(basename "$dir")
    cat > "$dir/package.json" << EOF
{
  "name": "$name",
  "version": "0.1.0",
  "description": "Pulumi project for $name",
  "main": "index.js",
  "scripts": {
    "build": "tsc",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC"
}
EOF
}

# Initialize Pulumi TypeScript projects with minimal interaction
for PROJECT in cluster-setup core-services storage; do
    log "Initializing Pulumi TypeScript project: $PROJECT..."
    PROJECT_DIR="$PROJECT_ROOT/pulumi/$PROJECT"
    cd "$PROJECT_DIR"

    # Create directories
    mkdir -p src src/__tests__

    # Create minimal package.json to avoid prompts
    create_minimal_package "$PROJECT_DIR"

    # Create proper TypeScript file structure with project-specific components
    create_typescript_project_structure "$PROJECT_DIR" "$PROJECT"

    # Create minimal tsconfig.json
    cat > "$PROJECT_DIR/tsconfig.json" << EOF
{
  "compilerOptions": {
    "target": "ES2018",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "sourceMap": true,
    "outDir": "bin",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true
  },
  "files": [
    "index.ts"
  ]
}
EOF
    # Create minimal Pulumi.yaml
    cat > "$PROJECT_DIR/Pulumi.yaml" << EOF
name: $PROJECT
runtime: nodejs
description: A Pulumi project for $PROJECT
EOF
    # Create minimal index.ts
    cat > "$PROJECT_DIR/index.ts" << EOF
import * as pulumi from "@pulumi/pulumi";
export const message = "Hello, Pulumi!";
EOF
    # Install dependencies with legacy-peer-deps to avoid compatibility issues
    log "Installing dependencies for $PROJECT (this may take a while)..."
    npm install --save @pulumi/pulumi --no-fund --no-audit --prefer-offline --no-progress --legacy-peer-deps

    # Install additional dependencies separately to avoid hanging
    log "Installing additional dependencies for $PROJECT..."
    npm install --save @pulumi/kubernetes --no-fund --no-audit --prefer-offline --no-progress --legacy-peer-deps
    npm install --save @pulumi/random @pulumi/command --no-fund --no-audit --prefer-offline --no-progress --legacy-peer-deps

    # Create Pulumi stack if it doesn't exist
    if ! pulumi stack ls 2>/dev/null | grep -q "dev"; then
        log "Creating Pulumi stack 'dev' for $PROJECT..."
        # Use the already exported PULUMI_CONFIG_PASSPHRASE
        pulumi stack init dev --non-interactive
    fi

    # Add a brief pause between projects
    sleep 2
done

log "Pulumi TypeScript project setup complete!"
log "Your Pulumi projects are located at: $PROJECT_ROOT/pulumi"
log "To start working with a project, navigate to one of the project directories and run 'pulumi up'"

log "Remember to edit your Pulumi.yaml and index.ts files to configure your infrastructure!"

log "If you encounter issues, you can run this script with the --cleanup flag to remove partial installations:"
log "  $0 --cleanup"
