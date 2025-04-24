#!/usr/bin/env python3

import datetime
import glob
import gzip
import logging
import os
import shutil
import subprocess
import sys
import tarfile
from contextlib import contextmanager

# --- Configuration (Prefer environment variables for K8s) ---
BACKUP_ROOT_DIR = os.getenv("BACKUP_ROOT_DIR", "/backups")
TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"
RETENTION_DAYS = int(
    os.getenv("RETENTION_DAYS", "7")
)  # Simple retention: keep for N days

# PostgreSQL Config
PG_HOST = os.getenv("PG_HOST")
PG_PORT = os.getenv("PG_PORT", "5432")
PG_USER = os.getenv("PG_USER")
PG_PASSWORD = os.getenv("PG_PASSWORD")  # Consider K8s secrets
PG_DATABASE = os.getenv("PG_DATABASE")  # Database to back up (or 'all' for pg_dumpall)

# Redis Config
REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")  # Consider K8s secrets
REDIS_RDB_PATH = os.getenv(
    "REDIS_RDB_PATH", "/data/dump.rdb"
)  # Path *inside* redis container/pod if copying

# InfluxDB Config
INFLUXDB_HOST = os.getenv(
    "INFLUXDB_HOST", "http://localhost:8086"
)  # URL for influx cli
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN")  # Consider K8s secrets
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG")

# File Backup Config
# Comma-separated list of paths to back up
FILE_BACKUP_PATHS = os.getenv("FILE_BACKUP_PATHS", "").split(",")
FILE_BACKUP_NAME = os.getenv("FILE_BACKUP_NAME", "appdata")

# Encryption Config
ENCRYPT_BACKUPS = os.getenv("ENCRYPT_BACKUPS", "false").lower() == "true"
GPG_RECIPIENT = os.getenv("GPG_RECIPIENT")  # GPG Key ID or email

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


# --- Helper Functions ---
def run_command(command, env=None, cwd=None, check=True, shell=False):
    """Runs a shell command."""
    logging.info(f"Running command: {' '.join(command)}")
    try:
        process_env = os.environ.copy()
        if env:
            process_env.update(env)

        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=process_env,
            cwd=cwd,
            check=check,  # Raise exception on non-zero exit code
            text=True,
            shell=shell,  # Be cautious with shell=True
        )
        if result.stdout:
            logging.info(f"Command stdout:\n{result.stdout.strip()}")
        if result.stderr:
            # Log stderr as warning, but let check=True handle failure
            logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result
    except subprocess.CalledProcessError as e:
        logging.error(
            f"Command failed with exit code {e.returncode}: {' '.join(command)}"
        )
        if e.stderr:
            logging.error(f"Error output:\n{e.stderr.strip()}")
        raise  # Re-raise the exception to stop the script if check=True
    except Exception as e:
        logging.error(f"Failed to run command {' '.join(command)}: {e}")
        raise


@contextmanager
def ensure_dir(dir_path):
    """Ensure directory exists."""
    if not os.path.exists(dir_path):
        logging.info(f"Creating directory: {dir_path}")
        os.makedirs(dir_path, exist_ok=True)
    yield dir_path


def get_timestamp():
    """Returns the current timestamp string."""
    return datetime.datetime.now().strftime(TIMESTAMP_FORMAT)


def encrypt_file(filepath):
    """Encrypts a file using GPG."""
    if not ENCRYPT_BACKUPS or not GPG_RECIPIENT:
        logging.warning("Encryption skipped: Not enabled or GPG_RECIPIENT not set.")
        return filepath

    encrypted_filepath = f"{filepath}.gpg"
    logging.info(f"Encrypting {filepath} to {encrypted_filepath} for {GPG_RECIPIENT}")
    try:
        # Ensure the GPG agent is likely running or password entry is handled
        # Requires gpg binary and the recipient's public key imported
        run_command(
            [
                "gpg",
                "--encrypt",
                "--recipient",
                GPG_RECIPIENT,
                "--output",
                encrypted_filepath,
                filepath,
            ]
        )
        logging.info(f"Encryption successful: {encrypted_filepath}")
        # Remove original file after successful encryption
        os.remove(filepath)
        logging.info(f"Removed original file: {filepath}")
        return encrypted_filepath
    except Exception as e:
        logging.error(f"Encryption failed for {filepath}: {e}")
        # Keep the unencrypted file if encryption fails
        return filepath  # Return original path on failure


def apply_retention_policy(backup_dir, prefix):
    """Deletes old backups based on RETENTION_DAYS."""
    logging.info(
        f"Applying retention policy (>{RETENTION_DAYS} days) in {backup_dir} for prefix '{prefix}'"
    )
    now = datetime.datetime.now()
    cutoff_date = now - datetime.timedelta(days=RETENTION_DAYS)
    # Match pattern like prefix_YYYYMMDD_HHMMSS.* (.sql, .gz, .gpg, .tar.gz, etc.)
    backup_pattern = os.path.join(backup_dir, f"{prefix}_????????_??????.*")
    files_to_check = glob.glob(backup_pattern)
    files_to_check.sort()  # Process oldest first potentially

    deleted_count = 0
    for filepath in files_to_check:
        filename = os.path.basename(filepath)
        try:
            # Extract timestamp string (assuming format prefix_YYYYMMDD_HHMMSS)
            timestamp_str = (
                filename.split("_")[1] + "_" + filename.split("_")[2].split(".")[0]
            )
            file_date = datetime.datetime.strptime(timestamp_str, TIMESTAMP_FORMAT)

            if file_date < cutoff_date:
                logging.info(
                    f"Deleting old backup (older than {cutoff_date}): {filepath}"
                )
                os.remove(filepath)
                deleted_count += 1
            else:
                logging.info(f"Keeping backup (newer than {cutoff_date}): {filepath}")

        except (IndexError, ValueError) as e:
            logging.warning(
                f"Could not parse timestamp from filename {filename}: {e}. Skipping retention check."
            )
        except Exception as e:
            logging.error(f"Error processing retention for {filepath}: {e}")

    logging.info(
        f"Retention policy applied. Deleted {deleted_count} old backups for prefix '{prefix}'."
    )


# --- Backup Functions ---


def backup_postgresql(target_dir):
    """Backs up a PostgreSQL database."""
    if not all([PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE]):
        logging.warning("PostgreSQL backup skipped: Missing configuration.")
        return None

    timestamp = get_timestamp()
    backup_name = f"postgresql_{PG_DATABASE}_{timestamp}.sql"
    backup_filepath = os.path.join(target_dir, backup_name)
    compressed_filepath = f"{backup_filepath}.gz"

    logging.info(
        f"Starting PostgreSQL backup for database '{PG_DATABASE}' on {PG_HOST}..."
    )
    pg_env = {
        "PGPASSWORD": PG_PASSWORD,
    }
    command = [
        "pg_dump",
        "-h",
        PG_HOST,
        "-p",
        PG_PORT,
        "-U",
        PG_USER,
        "-d",
        PG_DATABASE,
        "-F",
        "p",  # Plain text format
        # Add other options like --no-owner, --no-privileges if needed
    ]
    if PG_DATABASE.lower() == "all":
        command = [
            "pg_dumpall",
            "-h",
            PG_HOST,
            "-p",
            PG_PORT,
            "-U",
            PG_USER,
            "--clean",
            "--if-exists",
        ]
        backup_name = f"postgresql_all_{timestamp}.sql"
        backup_filepath = os.path.join(target_dir, backup_name)
        compressed_filepath = f"{backup_filepath}.gz"

    try:
        # Run pg_dump and compress output directly
        with gzip.open(compressed_filepath, "wb") as f_out:
            logging.info(f"Running command and compressing to: {compressed_filepath}")
            process_env = os.environ.copy()
            process_env.update(pg_env)
            result = subprocess.run(
                command,
                stdout=f_out,  # Pipe stdout directly to gzip file handle
                stderr=subprocess.PIPE,
                env=process_env,
                check=True,
                text=False,  # Work with bytes for stdout pipe
            )
            if result.stderr:
                logging.warning(f"pg_dump stderr:\n{result.stderr.decode().strip()}")

        logging.info(f"PostgreSQL backup successful: {compressed_filepath}")
        return encrypt_file(compressed_filepath)
    except Exception as e:
        logging.error(f"PostgreSQL backup failed: {e}")
        # Clean up partial file if it exists
        if os.path.exists(compressed_filepath):
            os.remove(compressed_filepath)
        return None


def backup_redis(target_dir):
    """Backs up Redis data using BGSAVE and copying RDB or using --rdb."""
    if not all([REDIS_HOST]):
        logging.warning("Redis backup skipped: Missing configuration (REDIS_HOST).")
        return None

    timestamp = get_timestamp()
    backup_name = f"redis_dump_{timestamp}.rdb"
    backup_filepath = os.path.join(target_dir, backup_name)
    compressed_filepath = f"{backup_filepath}.gz"

    logging.info(f"Starting Redis backup for {REDIS_HOST}...")
    redis_cli_command = ["redis-cli", "-h", REDIS_HOST, "-p", REDIS_PORT]
    if REDIS_PASSWORD:
        redis_cli_command.extend(["-a", REDIS_PASSWORD])

    try:
        # Option 1: Use --rdb (preferred if available and suitable)
        # This streams the RDB content directly. Requires Redis 7+? Check docs.
        logging.info("Attempting Redis backup using 'redis-cli --rdb'")
        with open(backup_filepath, "wb") as f_out:
            rdb_command = redis_cli_command + ["--rdb", "-"]
            logging.info(
                f"Running command: {' '.join(rdb_command[:-1])} - > {backup_filepath}"
            )
            result = subprocess.run(
                rdb_command,
                stdout=f_out,  # Write RDB stream to file
                stderr=subprocess.PIPE,
                check=True,
                text=False,
            )
            if result.stderr:
                logging.warning(
                    f"redis-cli --rdb stderr:\n{result.stderr.decode().strip()}"
                )
        logging.info(f"Redis RDB streamed successfully to {backup_filepath}")

        # Compress the RDB file
        logging.info(f"Compressing {backup_filepath} to {compressed_filepath}")
        with open(backup_filepath, "rb") as f_in, gzip.open(
            compressed_filepath, "wb"
        ) as f_out:
            shutil.copyfileobj(f_in, f_out)
        os.remove(backup_filepath)  # Remove uncompressed RDB
        logging.info(f"Redis backup compressed: {compressed_filepath}")
        return encrypt_file(compressed_filepath)

    except Exception as e:
        logging.warning(
            f"Redis backup using 'redis-cli --rdb' failed: {e}. Falling back to BGSAVE if possible."
        )
        # Clean up potentially partial file
        if os.path.exists(backup_filepath):
            os.remove(backup_filepath)
        if os.path.exists(compressed_filepath):
            os.remove(compressed_filepath)

        # Option 2: Trigger BGSAVE and copy the file (less ideal, needs access to Redis filesystem)
        # This requires the script to have access to the Redis persistence volume/path.
        # Often not feasible/secure in Kubernetes unless using a sidecar or specific volume mounts.
        logging.warning(
            "BGSAVE method requires access to Redis RDB file path - this might not work in K8s."
        )
        logging.warning(
            f"Attempting BGSAVE and copy from {REDIS_RDB_PATH} (if accessible)"
        )
        try:
            # Trigger BGSAVE
            bgsave_command = redis_cli_command + ["BGSAVE"]
            run_command(bgsave_command)
            logging.info(
                "BGSAVE command issued. Waiting a few seconds for save to potentially complete..."
            )
            # WARNING: This wait is unreliable. A better approach checks INFO persistence `rdb_bgsave_in_progress`.
            import time

            time.sleep(5)  # Very basic wait

            if os.path.exists(REDIS_RDB_PATH):
                logging.info(
                    f"Copying RDB file from {REDIS_RDB_PATH} to {backup_filepath}"
                )
                shutil.copy2(
                    REDIS_RDB_PATH, backup_filepath
                )  # copy2 preserves metadata

                # Compress the RDB file
                logging.info(f"Compressing {backup_filepath} to {compressed_filepath}")
                with open(backup_filepath, "rb") as f_in, gzip.open(
                    compressed_filepath, "wb"
                ) as f_out:
                    shutil.copyfileobj(f_in, f_out)
                os.remove(backup_filepath)  # Remove uncompressed RDB
                logging.info(f"Redis backup compressed: {compressed_filepath}")
                return encrypt_file(compressed_filepath)
            else:
                logging.error(
                    f"Redis RDB file not found at specified path: {REDIS_RDB_PATH}"
                )
                return None
        except Exception as inner_e:
            logging.error(f"Redis backup using BGSAVE failed: {inner_e}")
            return None


def backup_influxdb(target_dir):
    """Backs up InfluxDB data using the influx CLI."""
    if not all([INFLUXDB_HOST, INFLUXDB_TOKEN]):
        logging.warning(
            "InfluxDB backup skipped: Missing configuration (INFLUXDB_HOST, INFLUXDB_TOKEN)."
        )
        return None

    timestamp = get_timestamp()
    # influx backup creates a directory, so we name the parent dir
    backup_name_prefix = f"influxdb_{timestamp}"
    backup_subdir = os.path.join(target_dir, backup_name_prefix)
    # Final archive name
    archive_name = f"{backup_name_prefix}.tar.gz"
    archive_filepath = os.path.join(target_dir, archive_name)

    logging.info(f"Starting InfluxDB backup from {INFLUXDB_HOST}...")
    command = [
        "influx",
        "backup",
        # "--host", INFLUXDB_HOST, # Often inferred or use config profiles
        "--token",
        INFLUXDB_TOKEN,
        backup_subdir,  # Directory where influx CLI will place backup files
    ]
    if INFLUXDB_ORG:
        command.extend(["--org", INFLUXDB_ORG])
        # Add bucket filtering if needed: --bucket BUCKET_NAME

    try:
        # influx backup command creates files in backup_subdir
        run_command(command)
        logging.info(f"InfluxDB backup files created in: {backup_subdir}")

        # Compress the resulting directory
        logging.info(
            f"Compressing backup directory {backup_subdir} to {archive_filepath}"
        )
        with tarfile.open(archive_filepath, "w:gz") as tar:
            # Add files from backup_subdir into the tar archive
            # arcname='.' ensures files are stored relative to the root of the archive
            tar.add(backup_subdir, arcname=os.path.basename(backup_subdir))

        # Clean up the temporary backup subdirectory
        logging.info(f"Removing temporary backup directory: {backup_subdir}")
        shutil.rmtree(backup_subdir)

        logging.info(f"InfluxDB backup successful: {archive_filepath}")
        return encrypt_file(archive_filepath)
    except Exception as e:
        logging.error(f"InfluxDB backup failed: {e}")
        # Clean up partial directory/archive if they exist
        if os.path.exists(backup_subdir):
            shutil.rmtree(backup_subdir)
        if os.path.exists(archive_filepath):
            os.remove(archive_filepath)
        return None


def backup_files(target_dir):
    """Backs up specified directories and files."""
    valid_paths = [p for p in FILE_BACKUP_PATHS if p and os.path.exists(p)]
    if not valid_paths:
        logging.warning(
            "File backup skipped: No valid paths specified in FILE_BACKUP_PATHS or paths do not exist."
        )
        return None

    timestamp = get_timestamp()
    backup_name = f"{FILE_BACKUP_NAME}_{timestamp}.tar.gz"
    backup_filepath = os.path.join(target_dir, backup_name)

    logging.info(f"Starting file backup for paths: {valid_paths}...")
    try:
        with tarfile.open(backup_filepath, "w:gz") as tar:
            for path in valid_paths:
                logging.info(f"Adding path to archive: {path}")
                # arcname can be adjusted if you want to change the structure within the tar file
                tar.add(path, arcname=os.path.basename(path))
        logging.info(f"File backup successful: {backup_filepath}")
        return encrypt_file(backup_filepath)
    except Exception as e:
        logging.error(f"File backup failed: {e}")
        if os.path.exists(backup_filepath):
            os.remove(backup_filepath)
        return None


# --- Main Execution ---
def main():
    logging.info("Starting Homelab Backup Process...")
    start_time = datetime.datetime.now()
    backup_success = True

    # Ensure root backup directory exists
    with ensure_dir(BACKUP_ROOT_DIR):
        # --- Perform Backups ---
        # Create subdirectories for tidiness
        pg_backup_dir = os.path.join(BACKUP_ROOT_DIR, "postgresql")
        redis_backup_dir = os.path.join(BACKUP_ROOT_DIR, "redis")
        influx_backup_dir = os.path.join(BACKUP_ROOT_DIR, "influxdb")
        files_backup_dir = os.path.join(BACKUP_ROOT_DIR, "files")

        with ensure_dir(pg_backup_dir):
            if not backup_postgresql(pg_backup_dir):
                backup_success = False
            apply_retention_policy(pg_backup_dir, f"postgresql_{PG_DATABASE or 'all'}")

        with ensure_dir(redis_backup_dir):
            if not backup_redis(redis_backup_dir):
                backup_success = False
            apply_retention_policy(redis_backup_dir, "redis_dump")

        with ensure_dir(influx_backup_dir):
            if not backup_influxdb(influx_backup_dir):
                backup_success = False
            apply_retention_policy(influx_backup_dir, "influxdb")

        with ensure_dir(files_backup_dir):
            if not backup_files(files_backup_dir):
                backup_success = False
            apply_retention_policy(files_backup_dir, FILE_BACKUP_NAME)

    # --- Reporting ---
    end_time = datetime.datetime.now()
    duration = end_time - start_time
    logging.info(f"Backup process finished in {duration}.")

    if backup_success:
        logging.info("All configured backup tasks completed successfully.")
        # In K8s CronJob, exit code 0 indicates success
        sys.exit(0)
    else:
        logging.error("One or more backup tasks failed. Please check logs.")
        # In K8s CronJob, non-zero exit code indicates failure
        sys.exit(1)


if __name__ == "__main__":
    # --- Prerequisites Check (Basic) ---
    # Check for essential command-line tools used directly
    required_tools = ["gpg"]  # Add others if not using direct library alternatives
    if PG_HOST and PG_DATABASE:
        required_tools.append("pg_dump")
    if REDIS_HOST:
        required_tools.append("redis-cli")
    if INFLUXDB_HOST and INFLUXDB_TOKEN:
        required_tools.append("influx")

    missing_tools = []
    for tool in required_tools:
        if shutil.which(tool) is None:
            missing_tools.append(tool)

    if missing_tools:
        logging.error(
            f"Missing required command-line tools: {', '.join(missing_tools)}"
        )
        logging.error("Please install them or ensure they are in the PATH.")
        sys.exit(2)

    if ENCRYPT_BACKUPS and not GPG_RECIPIENT:
        logging.error(
            "Encryption is enabled (ENCRYPT_BACKUPS=true), but GPG_RECIPIENT is not set."
        )
        sys.exit(3)
    if ENCRYPT_BACKUPS and GPG_RECIPIENT:
        logging.info(
            f"Encryption enabled. Will encrypt using GPG for recipient: {GPG_RECIPIENT}"
        )
        logging.warning(
            "Ensure the GPG public key for the recipient is imported in the environment where this script runs."
        )
        logging.warning(
            "Ensure gpg-agent or similar is configured if passphrase is needed."
        )

    main()

# --- Kubernetes CronJob Notes ---
#
# To run this script as a Kubernetes CronJob:
#
# 1.  **Containerize the Script:**
#     - Create a Dockerfile based on a Python image (e.g., `python:3.9-slim`).
#     - COPY this script into the image.
#     - Install necessary dependencies:
#       - Python libraries (if any beyond standard library - none currently).
#       - Command-line tools: `postgresql-client`, `redis-tools`, `influxdb2-cli`, `gnupg`, `gzip`, `tar`. The exact package names depend on the base image's distribution (e.g., `apt-get install -y ...` on Debian/Ubuntu).
#     - Set the ENTRYPOINT or CMD to run this Python script.
#     - Build and push the image to a registry accessible by your Kubernetes cluster.
#
# 2.  **GPG Key Setup (if encrypting):**
#     - The container needs the GPG *public key* of the recipient (`GPG_RECIPIENT`).
#     - You can import this key into the container's GPG keyring during the Docker build process or using an init container.
#     - Ensure `gpg-agent` is running or handle passphrase prompts appropriately if the private key used for signing (if applicable) requires one (though typically not needed for encryption only). Best practice is to use keys without passphrases for automation or manage passphrases securely (e.g., via K8s secrets and agent configuration).
#
# 3.  **Kubernetes Secrets:**
#     - Store sensitive information like `PG_PASSWORD`, `REDIS_PASSWORD`, `INFLUXDB_TOKEN`, and potentially `GPG_RECIPIENT` in Kubernetes Secrets.
#     - Mount these secrets as environment variables in the CronJob's pod definition.
#
# 4.  **Persistent Volume:**
#     - Define a PersistentVolume (PV) and PersistentVolumeClaim (PVC) for storing the backups (`BACKUP_ROOT_DIR`). Use a storage class appropriate for your environment (e.g., NFS, CephFS, cloud provider block storage).
#     - Mount the PVC into the CronJob's pod at the path specified by `BACKUP_ROOT_DIR`.
#
# 5.  **Kubernetes CronJob YAML:**
#     - Create a `CronJob` resource definition (e.g., `backup-cronjob.yaml`).
#     - Specify the schedule (e.g., `schedule: "0 2 * * *"` for 2 AM daily).
#     - Reference the Docker image built in step 1.
#     - Configure environment variables, referencing the Kubernetes Secrets for credentials and setting other parameters like `BACKUP_ROOT_DIR`, `RETENTION_DAYS`, `FILE_BACKUP_PATHS`, `ENCRYPT_BACKUPS`, `GPG_RECIPIENT`, etc.
#     - Mount the backup PVC.
#     - Set appropriate resource requests/limits.
#     - Configure `successfulJobsHistoryLimit` and `failedJobsHistoryLimit`.
#     - Set `concurrencyPolicy: Forbid` or `Replace` depending on whether you want jobs to queue or replace running ones if they overlap. `Forbid` is usually safer for backups.
#     - Apply the YAML using `kubectl apply -f backup-cronjob.yaml`.
#
# Example CronJob Snippet (Illustrative):
#
# apiVersion: batch/v1
# kind: CronJob
# metadata:
#   name: application-backup
# spec:
#   schedule: "0 2 * * *" # 2 AM daily
#   jobTemplate:
#     spec:
#       template:
#         spec:
#           containers:
#           - name: backup-runner
#             image: your-registry/homelab-backup:latest # Your image
#             env:
#             - name: BACKUP_ROOT_DIR
#               value: "/backups"
#             - name: RETENTION_DAYS
#               value: "7"
#             - name: ENCRYPT_BACKUPS
#               value: "true"
#             - name: GPG_RECIPIENT
#               valueFrom:
#                 secretKeyRef:
#                   name: backup-secrets
#                   key: gpg-recipient
#             - name: PG_HOST
#               value: "postgresql-service" # K8s service name
#             # ... other PG_, REDIS_, INFLUXDB_ env vars from secrets ...
#             - name: FILE_BACKUP_PATHS
#               value: "/config,/data/app1" # Paths *within this container* if mounting other app volumes
#             volumeMounts:
#             - name: backup-storage
#               mountPath: /backups
#             - name: app1-config # Example: Mount config from another app
#               mountPath: /config
#               readOnly: true
#           volumes:
#           - name: backup-storage
#             persistentVolumeClaim:
#               claimName: backup-pvc # Your PVC name
#           - name: app1-config # Example volume definition
#             persistentVolumeClaim:
#               claimName: app1-config-pvc
#               readOnly: true
#           restartPolicy: OnFailure # Or Never
#   concurrencyPolicy: Forbid
#   successfulJobsHistoryLimit: 3
#   failedJobsHistoryLimit: 5
#
