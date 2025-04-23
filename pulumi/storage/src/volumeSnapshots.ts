import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// URLs for the official VolumeSnapshot CRDs
// Check for the latest compatible versions from kubernetes-csi/external-snapshotter releases
const SNAPSHOT_CRD_BASE_URL = "https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/v6.3.3/client/config/crd";
const SNAPSHOT_CRD_FILES = [
    `${SNAPSHOT_CRD_BASE_URL}/snapshot.storage.k8s.io_volumesnapshotclasses.yaml`,
    `${SNAPSHOT_CRD_BASE_URL}/snapshot.storage.k8s.io_volumesnapshotcontents.yaml`,
    `${SNAPSHOT_CRD_BASE_URL}/snapshot.storage.k8s.io_volumesnapshots.yaml`,
];

/**
 * Arguments for the VolumeSnapshots component.
 */
interface VolumeSnapshotArgs {
    /**
     * Configuration for VolumeSnapshotClasses to create.
     * Key: Name of the VolumeSnapshotClass.
     * Value: CSI driver name (e.g., 'openebs.io/local', 'cephfs.csi.ceph.com').
     */
    snapshotClasses: Record<string, pulumi.Input<string>>;

    /**
     * Deletion policy for the VolumeSnapshotClass. Retain or Delete.
     * Defaults to 'Retain'.
     */
    deletionPolicy?: pulumi.Input<"Retain" | "Delete">;

    /**
     * Optional namespace to install CRDs if needed, though they are cluster-scoped.
     */
    namespace?: pulumi.Input<string>;
}

/**
 * Pulumi component to set up Kubernetes Volume Snapshot capabilities.
 *
 * This component installs the necessary CRDs and creates VolumeSnapshotClass resources.
 *
 * **Important:**
 * 1.  **CSI Driver Requirement:** You MUST have a CSI driver installed that supports
 *     volume snapshots for the storage you intend to snapshot.
 * 2.  **Snapshot Controller Requirement:** The corresponding CSI external-snapshotter
 *     sidecar/controller MUST be deployed in your cluster. This is typically deployed
 *     alongside the CSI driver itself. This component *assumes* the controller is running.
 * 3.  **Scheduling & Retention:** This component sets up the *ability* to take snapshots.
 *     The actual *scheduling* of snapshot creation (e.g., daily, hourly) and the *retention*
 *     (e.g., keep last 7 daily snapshots) MUST be handled by a separate tool like
 *     Velero (velero.io), Kasten K10, or a custom Kubernetes CronJob/Operator that creates
 *     VolumeSnapshot resources based on a schedule.
 */
export class VolumeSnapshots extends pulumi.ComponentResource {
    public readonly snapshotClassNames: pulumi.Output<string[]>;

    constructor(name: string, args: VolumeSnapshotArgs, opts?: pulumi.ComponentResourceOptions) {
        super("homelab:storage:VolumeSnapshots", name, args, opts);

        const k8sProvider = opts?.provider || k8s.Provider.getDefaultProvider();

        // --- Step 1: Install VolumeSnapshot CRDs ---
        // These definitions allow Kubernetes to understand VolumeSnapshot resources.
        const snapshotCrds = new k8s.yaml.ConfigGroup(`${name}-crds`, {
            files: SNAPSHOT_CRD_FILES,
        }, { parent: this, provider: k8sProvider });

        pulumi.log.info(`[${name}] VolumeSnapshot CRDs installation initiated.`, this);

        // --- Step 2: Note about Snapshot Controller ---
        pulumi.log.warn(`[${name}] Prerequisite: Ensure a CSI driver with snapshot support AND the corresponding external-snapshotter controller are deployed.`, this);

        // --- Step 3: Create VolumeSnapshotClass resources ---
        // These classes link snapshot functionality to specific CSI drivers.
        const createdClassNames: pulumi.Output<string>[] = [];
        for (const className in args.snapshotClasses) {
            const driverName = args.snapshotClasses[className];
            const snapshotClass = new k8s.storage.v1.VolumeSnapshotClass(className, {
                // Ensure CRDs are applied before creating instances of them
                metadata: { name: className },
                driver: driverName,
                deletionPolicy: args.deletionPolicy || "Retain", // Retain is safer default
            }, {
                parent: this,
                provider: k8sProvider,
                dependsOn: [snapshotCrds] // Explicit dependency on CRDs
            });
            createdClassNames.push(snapshotClass.metadata.name);
            pulumi.log.info(`[${name}] VolumeSnapshotClass '${className}' configured for driver '${driverName}'.`, snapshotClass);
        }

        this.snapshotClassNames = pulumi.all(createdClassNames);

        // --- Step 4: Note about Scheduling and Retention ---
        pulumi.log.info(`[${name}] Reminder: Snapshot scheduling and retention are NOT handled by this component. Use tools like Velero or custom CronJobs.`, this);

        // --- Step 5: Note about Monitoring ---
        pulumi.log.info(`[${name}] Monitoring: Check 'kubectl get volumesnapshots,volumesnapshotcontents -A'. Monitor metrics from the external-snapshotter and CSI driver. Watch Kubernetes events.`, this);

        this.registerOutputs({
            snapshotClassNames: this.snapshotClassNames,
        });
    }
}
