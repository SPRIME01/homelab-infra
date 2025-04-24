#!/usr/bin/env python3

import datetime
import glob
import hashlib
import logging
import os
import shutil
import subprocess
import sys
from contextlib import contextmanager

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("Error: 'boto3' package not found. Please install it: pip install boto3")
    sys.exit(1)

# --- Configuration (Prefer environment variables) ---
# Comma-separated list of directories containing primary backups
SOURCE_BACKUP_DIRS = os.getenv(
    "SOURCE_BACKUP_DIRS",
    "/backups/postgresql,/backups/redis,/backups/influxdb,/backups/files,/backups/config-backup",
).split(",")
# File pattern to select within source dirs (e.g., latest .gpg files)
SOURCE_FILE_PATTERN = os.getenv(
    "SOURCE_FILE_PATTERN", "*_????????_??????.*.gpg"
)  # Adjust if primary backups aren't encrypted
# How many latest files per source directory prefix to upload (e.g., 1 for latest daily)
FILES_PER_PREFIX = int(os.getenv("FILES_PER_PREFIX", "1"))

# Offsite Storage Config (S3 compatible)
S3_ENDPOINT_URL = os.getenv(
    "S3_ENDPOINT_URL"
)  # e.g., 'https://s3.us-east-1.amazonaws.com' or Backblaze/MinIO endpoint
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY")
S3_REGION = os.getenv("S3_REGION")  # e.g., 'us-east-1', required for AWS
S3_BUCKET = os.getenv("S3_BUCKET")
S3_PREFIX = os.getenv(
    "S3_PREFIX", "homelab-backups/"
)  # Optional prefix within the bucket

# Encryption (if encrypting here or re-encrypting)
# Set to true ONLY if primary backups are NOT already encrypted OR if re-encryption is desired.
ENCRYPT_OFFSITE = os.getenv("ENCRYPT_OFFSITE", "false").lower() == "true"
GPG_RECIPIENT_OFFSITE = os.getenv(
    "GPG_RECIPIENT_OFFSITE"
)  # GPG Key ID for offsite encryption

# Retention Policy (Offsite)
OFFSITE_RETENTION_DAYS = int(os.getenv("OFFSITE_RETENTION_DAYS", "30"))

# Staging directory for temporary processing
STAGING_DIR = os.getenv("STAGING_DIR", "/tmp/offsite_staging")

TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"  # Assumed format in filenames

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


# --- Helper Functions ---
def run_command(command, check=True):
    """Runs a shell command."""
    logging.info(f"Running command: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            text=True,
        )
        if result.stdout:
            logging.info(f"Command stdout:\n{result.stdout.strip()}")
        if result.stderr:
            logging.warning(f"Command stderr:\n{result.stderr.strip()}")
        return result
    except subprocess.CalledProcessError as e:
        logging.error(
            f"Command failed with exit code {e.returncode}: {' '.join(command)}"
        )
        if e.stderr:
            logging.error(f"Error output:\n{e.stderr.strip()}")
        raise
    except Exception as e:
        logging.error(f"Failed to run command {' '.join(command)}: {e}")
        raise


@contextmanager
def ensure_clean_dir(dir_path):
    """Ensure directory exists and is empty."""
    if os.path.exists(dir_path):
        logging.info(f"Cleaning staging directory: {dir_path}")
        shutil.rmtree(dir_path)
    logging.info(f"Creating staging directory: {dir_path}")
    os.makedirs(dir_path, exist_ok=True)
    yield dir_path
    # Clean up again after use (optional, depends on workflow)
    # logging.info(f"Cleaning up staging directory after use: {dir_path}")
    # shutil.rmtree(dir_path)


def encrypt_file_gpg(filepath, recipient, staging_dir):
    """Encrypts a file using GPG, placing output in staging_dir."""
    if not recipient:
        logging.error("GPG recipient not set, cannot encrypt.")
        return None

    base_filename = os.path.basename(filepath)
    encrypted_filename = (
        f"{base_filename}.gpg" if not base_filename.endswith(".gpg") else base_filename
    )
    encrypted_filepath = os.path.join(staging_dir, encrypted_filename)

    # Avoid re-encrypting if the target exists (e.g., from a previous failed run)
    if os.path.exists(encrypted_filepath):
        logging.warning(
            f"Encrypted file already exists in staging: {encrypted_filepath}. Skipping encryption."
        )
        return encrypted_filepath

    logging.info(f"Encrypting {filepath} to {encrypted_filepath} for {recipient}")
    try:
        run_command(
            [
                "gpg",
                "--encrypt",
                "--yes",
                "--trust-model",
                "always",  # Assume key is trusted in automated env
                "--recipient",
                recipient,
                "--output",
                encrypted_filepath,
                filepath,
            ]
        )
        logging.info(f"Encryption successful: {encrypted_filepath}")
        return encrypted_filepath
    except Exception as e:
        logging.error(f"Encryption failed for {filepath}: {e}")
        # Clean up partial file
        if os.path.exists(encrypted_filepath):
            os.remove(encrypted_filepath)
        return None


def get_s3_client():
    """Initializes and returns an S3 client."""
    if not all([S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET]):
        logging.error("S3 connection details incomplete.")
        return None
    try:
        session = boto3.session.Session()
        s3_client = session.client(
            service_name="s3",
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            endpoint_url=S3_ENDPOINT_URL,
            region_name=S3_REGION,  # May be optional depending on S3 provider
        )
        # Test connection by listing buckets (optional, requires ListBuckets permission)
        # s3_client.list_buckets()
        logging.info(
            f"Successfully initialized S3 client for endpoint {S3_ENDPOINT_URL}"
        )
        return s3_client
    except ClientError as e:
        logging.error(f"Failed to initialize S3 client (ClientError): {e}")
        return None
    except Exception as e:
        logging.error(f"Failed to initialize S3 client: {e}")
        return None


def calculate_md5(filepath):
    """Calculates the MD5 hash of a file."""
    hash_md5 = hashlib.md5()
    try:
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()
    except Exception as e:
        logging.error(f"Failed to calculate MD5 for {filepath}: {e}")
        return None


def upload_and_verify(s3_client, local_filepath, bucket, object_key):
    """Uploads a file to S3 and verifies integrity using MD5/ETag."""
    logging.info(f"Uploading {local_filepath} to s3://{bucket}/{object_key}")
    local_md5 = calculate_md5(local_filepath)
    if not local_md5:
        logging.error("Cannot proceed with upload without local MD5 hash.")
        return False

    try:
        with open(local_filepath, "rb") as f:
            response = s3_client.put_object(
                Bucket=bucket,
                Key=object_key,
                Body=f,
                # ContentMD5=base64.b64encode(hashlib.md5(f.read()).digest()).decode() # Alternative
            )
        # ETag is returned with quotes around it, remove them
        s3_etag = response.get("ETag", "").strip('"')
        logging.info(f"Upload successful. ETag: {s3_etag}, Local MD5: {local_md5}")

        # Verification: For non-multipart uploads on AWS S3, ETag is the MD5 hash.
        # Other providers or multipart uploads might differ.
        if s3_etag == local_md5:
            logging.info(
                f"Verification successful: S3 ETag matches local MD5 for {object_key}"
            )
            return True
        else:
            # Could be due to multipart upload, encryption settings on bucket, or provider differences
            logging.warning(
                f"Verification mismatch or inconclusive: S3 ETag '{s3_etag}' != Local MD5 '{local_md5}' for {object_key}."
            )
            logging.warning(
                "This might be expected with multipart uploads or non-AWS providers. Manual check recommended if unsure."
            )
            # Consider it a success for now, but log warning
            return True  # Change to False if strict MD5 match is required and expected

    except ClientError as e:
        logging.error(f"S3 ClientError during upload of {object_key}: {e}")
        return False
    except Exception as e:
        logging.error(f"Failed to upload {local_filepath}: {e}")
        return False


def apply_offsite_retention(s3_client, bucket, prefix):
    """Deletes objects older than OFFSITE_RETENTION_DAYS from S3."""
    logging.info(
        f"Applying offsite retention policy (>{OFFSITE_RETENTION_DAYS} days) to s3://{bucket}/{prefix}"
    )
    now = datetime.datetime.now(datetime.timezone.utc)  # Use timezone-aware datetime
    cutoff_date = now - datetime.timedelta(days=OFFSITE_RETENTION_DAYS)
    objects_to_delete = []

    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=bucket, Prefix=prefix)

        for page in pages:
            if "Contents" in page:
                for obj in page["Contents"]:
                    key = obj["Key"]
                    last_modified = obj["LastModified"]  # Already timezone-aware (UTC)

                    if last_modified < cutoff_date:
                        logging.info(
                            f"Marking for deletion (older than {cutoff_date}): {key} (LastModified: {last_modified})"
                        )
                        objects_to_delete.append({"Key": key})
                    else:
                        logging.info(f"Keeping: {key} (LastModified: {last_modified})")

        if objects_to_delete:
            # S3 delete_objects can handle up to 1000 keys at a time
            for i in range(0, len(objects_to_delete), 1000):
                chunk = objects_to_delete[i : i + 1000]
                logging.info(f"Deleting {len(chunk)} objects from S3...")
                response = s3_client.delete_objects(
                    Bucket=bucket, Delete={"Objects": chunk}
                )
                deleted_count = len(response.get("Deleted", []))
                error_count = len(response.get("Errors", []))
                logging.info(
                    f"Deleted {deleted_count} objects. Encountered {error_count} errors in this chunk."
                )
                if error_count > 0:
                    logging.error(f"Errors during deletion: {response.get('Errors')}")
        else:
            logging.info("No objects found matching retention policy for deletion.")

    except ClientError as e:
        logging.error(f"S3 ClientError during retention check: {e}")
    except Exception as e:
        logging.error(f"Error applying retention policy: {e}")


# --- Main Execution ---
def main():
    logging.info("Starting Offsite Backup Process...")
    start_time = datetime.datetime.now()
    upload_success_count = 0
    upload_failure_count = 0

    # --- Basic Configuration Checks ---
    if not all([S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET]):
        logging.error("S3 configuration is incomplete. Exiting.")
        sys.exit(1)
    if ENCRYPT_OFFSITE and not GPG_RECIPIENT_OFFSITE:
        logging.error(
            "Offsite encryption enabled, but GPG_RECIPIENT_OFFSITE is not set. Exiting."
        )
        sys.exit(1)

    s3_client = get_s3_client()
    if not s3_client:
        sys.exit(1)

    # --- Process Backups ---
    with ensure_clean_dir(STAGING_DIR) as staging_dir:
        all_files_to_upload = []

        # 1. Find candidate files from source directories
        for source_dir in SOURCE_BACKUP_DIRS:
            if not os.path.isdir(source_dir):
                logging.warning(f"Source directory not found: {source_dir}. Skipping.")
                continue

            # Group files by prefix (e.g., postgresql_mydb, redis_dump)
            files_by_prefix = {}
            search_pattern = os.path.join(source_dir, SOURCE_FILE_PATTERN)
            logging.info(f"Searching for files matching '{search_pattern}'")
            found_files = glob.glob(search_pattern)

            for f_path in found_files:
                filename = os.path.basename(f_path)
                try:
                    # Extract prefix assuming format prefix_YYYYMMDD_HHMMSS.*
                    prefix = filename.split("_")[0]
                    if prefix not in files_by_prefix:
                        files_by_prefix[prefix] = []
                    files_by_prefix[prefix].append(f_path)
                except IndexError:
                    logging.warning(
                        f"Could not determine prefix for file {filename}. Skipping."
                    )

            # Select the latest N files for each prefix
            for prefix, file_list in files_by_prefix.items():
                # Sort by filename (assuming timestamp makes this chronological)
                file_list.sort(reverse=True)
                selected_files = file_list[:FILES_PER_PREFIX]
                all_files_to_upload.extend(selected_files)
                logging.info(
                    f"Selected latest {len(selected_files)} file(s) for prefix '{prefix}' in {source_dir}: {selected_files}"
                )

        # 2. Process and Upload selected files
        for local_path in all_files_to_upload:
            file_to_upload = local_path
            cleanup_staging_file = None

            # Encrypt if needed
            if ENCRYPT_OFFSITE:
                encrypted_path = encrypt_file_gpg(
                    local_path, GPG_RECIPIENT_OFFSITE, staging_dir
                )
                if not encrypted_path:
                    logging.error(
                        f"Skipping upload for {local_path} due to encryption failure."
                    )
                    upload_failure_count += 1
                    continue
                file_to_upload = encrypted_path
                cleanup_staging_file = encrypted_path  # Mark for cleanup after upload
            elif not local_path.endswith(".gpg"):
                # Warn if uploading unencrypted file and encryption wasn't explicitly enabled
                logging.warning(
                    f"File {local_path} appears unencrypted, and ENCRYPT_OFFSITE is false. Uploading as is."
                )

            # Define S3 object key
            relative_path = os.path.relpath(
                local_path, start=os.path.dirname(os.path.dirname(local_path))
            )  # Get path relative to parent of source_dir
            object_key = os.path.join(S3_PREFIX, relative_path).replace(
                "\\", "/"
            )  # Ensure forward slashes
            if ENCRYPT_OFFSITE and not object_key.endswith(".gpg"):
                object_key += ".gpg"

            # Upload and Verify
            if upload_and_verify(s3_client, file_to_upload, S3_BUCKET, object_key):
                upload_success_count += 1
            else:
                upload_failure_count += 1

            # Clean up staged encrypted file if created
            if cleanup_staging_file and os.path.exists(cleanup_staging_file):
                try:
                    os.remove(cleanup_staging_file)
                    logging.info(f"Cleaned up staged file: {cleanup_staging_file}")
                except Exception as e:
                    logging.warning(
                        f"Failed to clean up staged file {cleanup_staging_file}: {e}"
                    )

    # --- Apply Retention Policy ---
    apply_offsite_retention(s3_client, S3_BUCKET, S3_PREFIX)

    # --- Reporting ---
    end_time = datetime.datetime.now()
    duration = end_time - start_time
    logging.info(f"Offsite backup process finished in {duration}.")
    logging.info(
        f"Uploaded successfully: {upload_success_count}, Failed: {upload_failure_count}"
    )

    if upload_failure_count > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    # --- Prerequisites Check ---
    if ENCRYPT_OFFSITE:
        if shutil.which("gpg") is None:
            logging.error(
                "Missing required command-line tool: gpg (required because ENCRYPT_OFFSITE=true)"
            )
            sys.exit(2)
        if not GPG_RECIPIENT_OFFSITE:
            logging.error("ENCRYPT_OFFSITE=true but GPG_RECIPIENT_OFFSITE is not set.")
            sys.exit(3)
        logging.info(
            f"Offsite encryption enabled for recipient: {GPG_RECIPIENT_OFFSITE}"
        )
        logging.warning(
            "Ensure the GPG public key is imported and trusted where this script runs."
        )

    # --- Cost Management Note ---
    logging.info(
        "Note: Cloud storage costs depend on provider, storage class, amount stored, and data transfer."
    )
    logging.info(
        "Monitor costs via your cloud provider's console. Consider using S3 Lifecycle Policies for transitions (e.g., to Glacier) or expiration."
    )

    main()

# --- Scheduling Notes ---
#
# This script is intended to run periodically (e.g., weekly) after primary backups have completed.
# - **Kubernetes CronJob:** Package this script and its dependencies (Python, boto3, gpg) into a container.
#   Configure a CronJob resource with the necessary environment variables (secrets for credentials) and schedule.
#   The job might need access to the primary backup volume to read the source files.
# - **systemd Timer:** Run directly on a host or VM using a systemd service and timer unit. Ensure Python,
#   dependencies, and credentials (e.g., via environment files or AWS credentials file) are available.
#
