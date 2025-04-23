#!/usr/bin/env python3

import os
import subprocess
import logging
import sys
import datetime
import requests
import json
import shutil
import glob
import time
from contextlib import contextmanager

# --- Configuration (Prefer environment variables) ---
# General
REPORT_DIR = os.getenv("REPORT_DIR", "./health_check_reports")
TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"

# 1. System Resources (via Prometheus)
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus.homelab:9090")
NODE_CPU_WARN_THRESHOLD = float(os.getenv("NODE_CPU_WARN_THRESHOLD", "75")) # % usage avg 5m
NODE_CPU_FAIL_THRESHOLD = float(os.getenv("NODE_CPU_FAIL_THRESHOLD", "90"))
NODE_MEM_WARN_THRESHOLD = float(os.getenv("NODE_MEM_WARN_THRESHOLD", "80")) # % usage current
NODE_MEM_FAIL_THRESHOLD = float(os.getenv("NODE_MEM_FAIL_THRESHOLD", "95"))
NODE_DISK_WARN_THRESHOLD = float(os.getenv("NODE_DISK_WARN_THRESHOLD", "70")) # % usage current (root fs)
NODE_DISK_FAIL_THRESHOLD = float(os.getenv("NODE_DISK_FAIL_THRESHOLD", "85"))

# 2. Service Functionality
# Comma-separated list of URLs to check, e.g., "http://grafana.homelab,http://app.homelab/health"
SERVICE_URLS_TO_CHECK = os.getenv("SERVICE_URLS_TO_CHECK", "").split(',')
SERVICE_RESPONSE_WARN_MS = int(os.getenv("SERVICE_RESPONSE_WARN_MS", "500"))
SERVICE_RESPONSE_FAIL_MS = int(os.getenv("SERVICE_RESPONSE_FAIL_MS", "2000"))

# 3. Database Health (PostgreSQL Example)
CHECK_DB = os.getenv("CHECK_DB", "false").lower() == "true"
PG_HOST = os.getenv("PG_HOST")
PG_PORT = os.getenv("PG_PORT", "5432")
PG_USER = os.getenv("PG_USER")
PG_PASSWORD = os.getenv("PG_PASSWORD") # Use K8s secrets
PG_DATABASE = os.getenv("PG_DATABASE", "postgres") # DB for basic connection check
PG_SLOW_QUERY_THRESHOLD_MS = int(os.getenv("PG_SLOW_QUERY_THRESHOLD_MS", "200"))
PG_MAX_CONNECTIONS_WARN_PCT = float(os.getenv("PG_MAX_CONNECTIONS_WARN_PCT", "70"))

# 4. Network Connectivity
# Comma-separated list of hostnames/IPs to ping
NETWORK_TARGETS_TO_PING = os.getenv("NETWORK_TARGETS_TO_PING", "").split(',')
PING_COUNT = int(os.getenv("PING_COUNT", "5"))
LATENCY_WARN_MS = float(os.getenv("LATENCY_WARN_MS", "15.0"))
LATENCY_FAIL_MS = float(os.getenv("LATENCY_FAIL_MS", "50.0"))
PACKET_LOSS_WARN_PCT = float(os.getenv("PACKET_LOSS_WARN_PCT", "1.0"))
PACKET_LOSS_FAIL_PCT = float(os.getenv("PACKET_LOSS_FAIL_PCT", "5.0"))

# 5. Security Posture (Placeholders/Examples)
CHECK_SECURITY = os.getenv("CHECK_SECURITY", "false").lower() == "true"
# Path to Trivy binary (if installed)
TRIVY_PATH = os.getenv("TRIVY_PATH", shutil.which("trivy"))
# Comma-separated list of critical images to scan, e.g., "nginx:latest,myapp:prod"
CRITICAL_IMAGES_TO_SCAN = os.getenv("CRITICAL_IMAGES_TO_SCAN", "").split(',')
TRIVY_SEVERITY = os.getenv("TRIVY_SEVERITY", "HIGH,CRITICAL")
# Path to kube-bench binary or script (if installed)
KUBE_BENCH_PATH = os.getenv("KUBE_BENCH_PATH", shutil.which("kube-bench"))
# Max age for last OS update (in days) to avoid warning
MAX_OS_UPDATE_AGE_DAYS = int(os.getenv("MAX_OS_UPDATE_AGE_DAYS", "14"))

# 6. Backup Integrity
CHECK_BACKUPS = os.getenv("CHECK_BACKUPS", "false").lower() == "true"
# Comma-separated list of local backup dirs to check
LOCAL_BACKUP_DIRS = os.getenv("LOCAL_BACKUP_DIRS", "/backups/postgresql,/backups/files").split(',')
# File pattern within backup dirs, e.g., "*.gpg" or "*.sql.gz"
BACKUP_FILE_PATTERN = os.getenv("BACKUP_FILE_PATTERN", "*_????????_??????.*")
MAX_BACKUP_AGE_HOURS = int(os.getenv("MAX_BACKUP_AGE_HOURS", "26")) # Expect backups at least daily
# S3 Backup Check Config (Optional)
CHECK_S3_BACKUPS = os.getenv("CHECK_S3_BACKUPS", "false").lower() == "true"
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY")
S3_REGION = os.getenv("S3_REGION")
S3_BUCKET = os.getenv("S3_BUCKET")
S3_PREFIX = os.getenv("S3_PREFIX", "homelab-backups/") # Prefix where backups are stored

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("HealthCheck")

# --- Result Storage ---
health_results = [] # List to store dicts for each check result

# --- Helper Functions ---
def run_command(command, check=True, timeout=None, capture_output=True, shell=False, log_output=True, env=None):
    """Runs a shell command with logging and timeout."""
    logger.debug(f"Running command: {' '.join(command)}")
    try:
        process_env = os.environ.copy()
        if env: process_env.update(env)
        result = subprocess.run(
            command, stdout=subprocess.PIPE if capture_output else None,
            stderr=subprocess.PIPE if capture_output else None, check=check,
            text=True, timeout=timeout, shell=shell, env=process_env
        )
        stdout = result.stdout.strip() if capture_output and result.stdout else ""
        stderr = result.stderr.strip() if capture_output and result.stderr else ""
        if log_output:
            if stdout: logger.debug(f"Command stdout:\n{stdout}")
            if stderr: logger.debug(f"Command stderr:\n{stderr}") # Debug level for stderr on success
        return stdout, stderr
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out after {timeout}s: {' '.join(command)}")
        raise
    except subprocess.CalledProcessError as e:
        logger.error(f"Command failed with exit code {e.returncode}: {' '.join(command)}")
        if capture_output:
             stderr = e.stderr.strip() if e.stderr else ""
             if stderr: logger.error(f"Error output:\n{stderr}")
        raise
    except Exception as e:
        logger.error(f"Failed to run command {' '.join(command)}: {e}")
        raise

def query_prometheus(query):
    """Queries Prometheus API."""
    api_endpoint = f"{PROMETHEUS_URL}/api/v1/query"
    logger.debug(f"Querying Prometheus: {query}")
    try:
        response = requests.get(api_endpoint, params={'query': query}, timeout=15)
        response.raise_for_status()
        result = response.json()
        if result['status'] == 'success':
            return result['data']['result']
        else:
            logger.error(f"Prometheus query failed: {result.get('error', 'Unknown error')}")
            return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Error connecting to Prometheus at {PROMETHEUS_URL}: {e}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred during Prometheus query: {e}")
        return None

def add_result(check_name, status, message, details=None, recommendation=None):
    """Adds a result to the global list."""
    # Status: PASS, WARN, FAIL, SKIP, INFO
    logger.info(f"Check '{check_name}': {status} - {message}")
    if status == "WARN": logger.warning(f"Check '{check_name}': {status} - {message}")
    if status == "FAIL": logger.error(f"Check '{check_name}': {status} - {message}")

    health_results.append({
        "check": check_name,
        "status": status,
        "message": message,
        "details": details or {},
        "recommendation": recommendation or "",
        "timestamp": datetime.datetime.now().isoformat()
    })

# --- Health Check Modules ---

def check_system_resources():
    """Checks Node CPU, Memory, Disk via Prometheus."""
    check_name = "System Resources"
    logger.info(f"--- Starting Check: {check_name} ---")
    if not PROMETHEUS_URL:
        add_result(check_name, "SKIP", "Prometheus URL not configured.", recommendation="Set PROMETHEUS_URL environment variable.")
        return

    # 1. CPU Usage (Avg 5m)
    cpu_query = '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
    cpu_results = query_prometheus(cpu_query)
    if cpu_results is None:
        add_result(f"{check_name}.CPU", "FAIL", "Failed to query Prometheus for CPU usage.")
    else:
        for item in cpu_results:
            node = item['metric'].get('instance', 'unknown').split(':')[0]
            usage = float(item['value'][1])
            status, rec = "PASS", ""
            if usage >= NODE_CPU_FAIL_THRESHOLD:
                status = "FAIL"
                rec = f"Investigate high CPU usage on node {node}. Check running pods/processes."
            elif usage >= NODE_CPU_WARN_THRESHOLD:
                status = "WARN"
                rec = f"Monitor CPU usage on node {node}."
            add_result(f"{check_name}.CPU.{node}", status, f"Avg 5m CPU Usage: {usage:.2f}%", {"usage_percent": usage}, rec)

    # 2. Memory Usage (Current)
    mem_query = '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100'
    mem_results = query_prometheus(mem_query)
    if mem_results is None:
        add_result(f"{check_name}.Memory", "FAIL", "Failed to query Prometheus for Memory usage.")
    else:
        for item in mem_results:
            node = item['metric'].get('instance', 'unknown').split(':')[0]
            usage = float(item['value'][1])
            status, rec = "PASS", ""
            if usage >= NODE_MEM_FAIL_THRESHOLD:
                status = "FAIL"
                rec = f"Investigate high memory usage on node {node}. Check for memory leaks or resource needs."
            elif usage >= NODE_MEM_WARN_THRESHOLD:
                status = "WARN"
                rec = f"Monitor memory usage on node {node}."
            add_result(f"{check_name}.Memory.{node}", status, f"Current Memory Usage: {usage:.2f}%", {"usage_percent": usage}, rec)

    # 3. Disk Usage (Root FS)
    disk_query = '(1 - (node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})) * 100'
    disk_results = query_prometheus(disk_query)
    if disk_results is None:
        add_result(f"{check_name}.Disk", "FAIL", "Failed to query Prometheus for Disk usage.")
    else:
        for item in disk_results:
            node = item['metric'].get('instance', 'unknown').split(':')[0]
            usage = float(item['value'][1])
            status, rec = "PASS", ""
            if usage >= NODE_DISK_FAIL_THRESHOLD:
                status = "FAIL"
                rec = f"Clean up disk space on node {node} (root filesystem). Check logs, container images, old backups."
            elif usage >= NODE_DISK_WARN_THRESHOLD:
                status = "WARN"
                rec = f"Monitor disk usage on node {node} (root filesystem)."
            add_result(f"{check_name}.Disk.{node}", status, f"Root Disk Usage: {usage:.2f}%", {"usage_percent": usage}, rec)

def check_service_functionality():
    """Checks HTTP endpoints for status and response time."""
    check_name = "Service Functionality"
    logger.info(f"--- Starting Check: {check_name} ---")
    urls_to_check = [url for url in SERVICE_URLS_TO_CHECK if url]
    if not urls_to_check:
        add_result(check_name, "SKIP", "No service URLs configured.", recommendation="Set SERVICE_URLS_TO_CHECK environment variable.")
        return

    for url in urls_to_check:
        service_name = url.split('//')[1].split('/')[0] # Basic name extraction
        try:
            start_time = time.monotonic()
            response = requests.get(url, timeout=10, verify=False) # verify=False for self-signed certs, use carefully
            response_time_ms = (time.monotonic() - start_time) * 1000

            status, rec = "PASS", ""
            message = f"URL {url} returned status {response.status_code} in {response_time_ms:.0f}ms."
            details = {"url": url, "status_code": response.status_code, "response_time_ms": response_time_ms}

            if not response.ok: # Status code >= 400
                status = "FAIL"
                rec = f"Service at {url} returned error status {response.status_code}. Check service logs."
            elif response_time_ms >= SERVICE_RESPONSE_FAIL_MS:
                status = "FAIL"
                rec = f"Service response time for {url} is very high ({response_time_ms:.0f}ms). Investigate service performance."
            elif response_time_ms >= SERVICE_RESPONSE_WARN_MS:
                status = "WARN"
                rec = f"Service response time for {url} is high ({response_time_ms:.0f}ms). Monitor service performance."

            add_result(f"{check_name}.{service_name}", status, message, details, rec)

        except requests.exceptions.Timeout:
            add_result(f"{check_name}.{service_name}", "FAIL", f"Request to {url} timed out.", {"url": url}, f"Service at {url} is unresponsive or network issue exists.")
        except requests.exceptions.ConnectionError:
            add_result(f"{check_name}.{service_name}", "FAIL", f"Connection error for {url}.", {"url": url}, f"Service at {url} is down or unreachable.")
        except Exception as e:
            add_result(f"{check_name}.{service_name}", "FAIL", f"Error checking {url}: {e}", {"url": url}, f"Unexpected error checking service {url}.")

def check_database_health():
    """Checks PostgreSQL connection, simple query, and basic performance metrics."""
    check_name = "Database Health (PostgreSQL)"
    logger.info(f"--- Starting Check: {check_name} ---")
    if not CHECK_DB:
        add_result(check_name, "SKIP", "Database check not enabled.", recommendation="Set CHECK_DB=true to enable.")
        return
    if not all([PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE]):
        add_result(check_name, "FAIL", "PostgreSQL connection details incomplete.", recommendation="Set PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE.")
        return

    try:
        import psycopg2
        from psycopg2.extras import DictCursor
    except ImportError:
        add_result(check_name, "FAIL", "psycopg2 library not found.", recommendation="Install psycopg2 (`pip install psycopg2-binary`).")
        return

    conn = None
    try:
        # 1. Check Connection & Simple Query
        conn = psycopg2.connect(
            host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PASSWORD,
            dbname=PG_DATABASE, connect_timeout=10
        )
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
            result = cur.fetchone()
            if result and result[0] == 1:
                add_result(f"{check_name}.Connection", "PASS", f"Successfully connected to {PG_HOST} and executed simple query.")
            else:
                add_result(f"{check_name}.Connection", "FAIL", f"Connected to {PG_HOST} but simple query failed.", recommendation="Check database status and permissions.")
                return # Stop further DB checks if basic query fails

        # 2. Check Active Connections vs Max Connections
        with conn.cursor(cursor_factory=DictCursor) as cur:
             cur.execute("SELECT current_setting('max_connections') AS max_conn, count(*) AS active_conn FROM pg_stat_activity;")
             conn_stats = cur.fetchone()
             max_conn = int(conn_stats['max_conn'])
             active_conn = int(conn_stats['active_conn'])
             conn_pct = (active_conn / max_conn) * 100
             status, rec = "PASS", ""
             if conn_pct >= PG_MAX_CONNECTIONS_WARN_PCT: # Use only WARN for connections, FAIL is too disruptive
                  status = "WARN"
                  rec = f"High connection count ({active_conn}/{max_conn}). Consider increasing max_connections or optimizing connection pooling."
             add_result(f"{check_name}.Connections", status, f"Active connections: {active_conn}/{max_conn} ({conn_pct:.1f}%)", {"active": active_conn, "max": max_conn, "percent": conn_pct}, rec)


        # 3. Check for Slow Queries (requires pg_stat_statements)
        # Reuse logic from analyze_db_performance.py
        try:
            with conn.cursor(cursor_factory=DictCursor) as cur:
                cur.execute("""
                    SELECT query, mean_exec_time
                    FROM pg_stat_statements
                    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = %s)
                      AND calls > 10 -- Ignore queries run only a few times
                      AND mean_exec_time > %s
                    ORDER BY mean_exec_time DESC
                    LIMIT 5;
                """, (PG_DATABASE, PG_SLOW_QUERY_THRESHOLD_MS))
                slow_queries = cur.fetchall()
                if slow_queries:
                    details = [{"query": q['query'][:100]+"...", "avg_ms": q['mean_exec_time']} for q in slow_queries]
                    add_result(f"{check_name}.SlowQueries", "WARN", f"Found {len(slow_queries)} slow queries (avg > {PG_SLOW_QUERY_THRESHOLD_MS}ms).", details, "Analyze query plans using EXPLAIN ANALYZE and consider indexing.")
                else:
                    add_result(f"{check_name}.SlowQueries", "PASS", f"No slow queries found (avg > {PG_SLOW_QUERY_THRESHOLD_MS}ms).")
        except psycopg2.errors.UndefinedTable:
             add_result(f"{check_name}.SlowQueries", "INFO", "pg_stat_statements extension not enabled or accessible.", recommendation="Enable pg_stat_statements for slow query analysis.")
        except Exception as e:
             add_result(f"{check_name}.SlowQueries", "WARN", f"Error checking slow queries: {e}")


    except psycopg2.OperationalError as e:
        add_result(check_name, "FAIL", f"Failed to connect to PostgreSQL: {e}", recommendation="Check DB server status, network, credentials.")
    except Exception as e:
        add_result(check_name, "FAIL", f"Unexpected error during database check: {e}")
    finally:
        if conn:
            conn.close()

def check_network_connectivity():
    """Pings target hosts and checks latency/packet loss."""
    check_name = "Network Connectivity"
    logger.info(f"--- Starting Check: {check_name} ---")
    targets_to_ping = [t for t in NETWORK_TARGETS_TO_PING if t]
    if not targets_to_ping:
        add_result(check_name, "SKIP", "No network targets configured.", recommendation="Set NETWORK_TARGETS_TO_PING environment variable.")
        return

    # Reuse parsing logic from analyze_network_performance.py
    import re
    def parse_ping_output(output):
        loss_match = re.search(r'(\d+(\.\d+)?%)\s+packet\s+loss', output)
        rtt_match = re.search(r'rtt\s+min/avg/max/mdev\s*=\s*(\d+\.\d+)/(\d+\.\d+)/(\d+\.\d+)/(\d+\.\d+)\s*ms', output, re.IGNORECASE)
        if not rtt_match: rtt_match = re.search(r'round-trip\s+min/avg/max\s*=\s*(\d+\.\d+)/(\d+\.\d+)/(\d+\.\d+)\s*ms', output, re.IGNORECASE)
        packet_loss_str = loss_match.group(1) if loss_match else None
        packet_loss_pct = float(packet_loss_str.replace('%','')) if packet_loss_str else None
        avg_latency = float(rtt_match.group(2)) if rtt_match else None
        return packet_loss_pct, avg_latency

    for target in targets_to_ping:
        try:
            ping_cmd = ["ping", "-c", str(PING_COUNT), target]
            stdout, _ = run_command(ping_cmd, check=True, timeout=15, log_output=False)
            packet_loss, avg_latency = parse_ping_output(stdout)

            if packet_loss is None or avg_latency is None:
                 add_result(f"{check_name}.{target}", "WARN", f"Could not parse ping results for {target}.", {"output": stdout}, "Check ping command output format.")
                 continue

            status, rec = "PASS", ""
            message = f"Ping {target}: Loss={packet_loss:.1f}%, Avg Latency={avg_latency:.2f}ms"
            details = {"target": target, "packet_loss_percent": packet_loss, "avg_latency_ms": avg_latency}

            if packet_loss >= PACKET_LOSS_FAIL_PCT:
                status = "FAIL"
                rec = f"High packet loss to {target}. Check network hardware, cables, configuration."
            elif avg_latency >= LATENCY_FAIL_MS:
                 status = "FAIL"
                 rec = f"High latency to {target}. Check network load, switches, routing."
            elif packet_loss >= PACKET_LOSS_WARN_PCT:
                status = "WARN"
                rec = f"Elevated packet loss to {target}. Monitor network."
            elif avg_latency >= LATENCY_WARN_MS:
                 status = "WARN"
                 rec = f"Elevated latency to {target}. Monitor network."

            add_result(f"{check_name}.{target}", status, message, details, rec)

        except subprocess.TimeoutExpired:
             add_result(f"{check_name}.{target}", "FAIL", f"Ping to {target} timed out.", {"target": target}, "Target may be down or network blocked.")
        except subprocess.CalledProcessError:
             add_result(f"{check_name}.{target}", "FAIL", f"Ping command failed for {target} (e.g., unknown host).", {"target": target}, "Check DNS, routing, firewall.")
        except Exception as e:
             add_result(f"{check_name}.{target}", "FAIL", f"Error pinging {target}: {e}", {"target": target})

def check_security_posture():
    """Runs basic security checks (placeholders)."""
    check_name = "Security Posture"
    logger.info(f"--- Starting Check: {check_name} ---")
    if not CHECK_SECURITY:
        add_result(check_name, "SKIP", "Security checks not enabled.", recommendation="Set CHECK_SECURITY=true to enable.")
        return

    # 1. Trivy Scan (Example)
    images_to_scan = [img for img in CRITICAL_IMAGES_TO_SCAN if img]
    if TRIVY_PATH and images_to_scan:
        for image in images_to_scan:
            try:
                # Scan for specific severities, exit code 1 if vulnerabilities found
                trivy_cmd = [TRIVY_PATH, "image", "--severity", TRIVY_SEVERITY, "--exit-code", "1", "--no-progress", image]
                run_command(trivy_cmd, check=True, timeout=300)
                add_result(f"{check_name}.Trivy.{image.replace(':','_').replace('/','_')}", "PASS", f"No {TRIVY_SEVERITY} vulnerabilities found in {image}.")
            except subprocess.CalledProcessError as e:
                 # Trivy exits 1 if vulnerabilities are found with --exit-code 1
                 if e.returncode == 1:
                      add_result(f"{check_name}.Trivy.{image.replace(':','_').replace('/','_')}", "FAIL", f"Found {TRIVY_SEVERITY} vulnerabilities in {image}.", {"image": image}, "Update image or dependencies. Run Trivy manually for details.")
                 else:
                      add_result(f"{check_name}.Trivy.{image.replace(':','_').replace('/','_')}", "FAIL", f"Trivy scan failed for {image} with exit code {e.returncode}.", {"image": image}, "Check Trivy logs or run manually.")
            except Exception as e:
                 add_result(f"{check_name}.Trivy.{image.replace(':','_').replace('/','_')}", "FAIL", f"Error running Trivy scan for {image}: {e}", {"image": image})
    elif images_to_scan:
         add_result(f"{check_name}.Trivy", "SKIP", "Trivy path not found or not configured.", recommendation="Install Trivy and set TRIVY_PATH.")

    # 2. Kube-bench Scan (Placeholder)
    if KUBE_BENCH_PATH:
        add_result(f"{check_name}.KubeBench", "INFO", "Kube-bench check placeholder.", recommendation="Implement kube-bench execution and result parsing.")
        # try:
        #     # Needs careful configuration of target version, potentially running inside cluster
        #     kb_cmd = [KUBE_BENCH_PATH, "--json"] # Add version, config flags
        #     stdout, _ = run_command(kb_cmd, check=True, timeout=300)
        #     results = json.loads(stdout)
        #     # Parse results for failures/warnings based on CIS benchmarks
        #     # Add results based on parsing...
        # except Exception as e:
        #     add_result(f"{check_name}.KubeBench", "FAIL", f"Error running kube-bench: {e}")
    else:
         add_result(f"{check_name}.KubeBench", "SKIP", "kube-bench path not found.", recommendation="Install kube-bench and set KUBE_BENCH_PATH.")

    # 3. OS Update Age Check (Basic Example for Debian/Ubuntu)
    try:
        # Check apt history log timestamp
        apt_log_path = "/var/log/apt/history.log"
        if os.path.exists(apt_log_path):
            last_update_time = os.path.getmtime(apt_log_path)
            last_update_dt = datetime.datetime.fromtimestamp(last_update_time)
            age_days = (datetime.datetime.now() - last_update_dt).days
            status, rec = "PASS", ""
            if age_days > MAX_OS_UPDATE_AGE_DAYS:
                 status = "WARN"
                 rec = f"Last OS package update was {age_days} days ago. Consider running system updates."
            add_result(f"{check_name}.OSUpdateAge", status, f"Last OS update detected {age_days} days ago.", {"last_update": last_update_dt.isoformat(), "age_days": age_days}, rec)
        else:
             add_result(f"{check_name}.OSUpdateAge", "INFO", "Cannot determine last OS update time (apt log not found).")
    except Exception as e:
         add_result(f"{check_name}.OSUpdateAge", "WARN", f"Error checking OS update age: {e}")


def check_backup_integrity():
    """Checks existence and age of local and optionally S3 backups."""
    check_name = "Backup Integrity"
    logger.info(f"--- Starting Check: {check_name} ---")
    if not CHECK_BACKUPS:
        add_result(check_name, "SKIP", "Backup checks not enabled.", recommendation="Set CHECK_BACKUPS=true to enable.")
        return

    now = datetime.datetime.now()
    cutoff_time = now - datetime.timedelta(hours=MAX_BACKUP_AGE_HOURS)

    # 1. Check Local Backups
    local_dirs_to_check = [d for d in LOCAL_BACKUP_DIRS if d]
    if not local_dirs_to_check:
        add_result(f"{check_name}.Local", "SKIP", "No local backup directories configured.", recommendation="Set LOCAL_BACKUP_DIRS.")
    else:
        found_recent_local = False
        for backup_dir in local_dirs_to_check:
            if not os.path.isdir(backup_dir):
                add_result(f"{check_name}.Local.{os.path.basename(backup_dir)}", "FAIL", f"Backup directory not found: {backup_dir}", recommendation="Verify backup directory path and volume mounts.")
                continue

            latest_file = None
            latest_mtime = 0
            try:
                search_pattern = os.path.join(backup_dir, BACKUP_FILE_PATTERN)
                backup_files = glob.glob(search_pattern)
                if not backup_files:
                    add_result(f"{check_name}.Local.{os.path.basename(backup_dir)}", "FAIL", f"No backup files found matching pattern '{BACKUP_FILE_PATTERN}' in {backup_dir}", recommendation="Check backup job execution and file naming.")
                    continue

                for f in backup_files:
                    mtime = os.path.getmtime(f)
                    if mtime > latest_mtime:
                        latest_mtime = mtime
                        latest_file = f

                if latest_file:
                    latest_dt = datetime.datetime.fromtimestamp(latest_mtime)
                    age_hours = (now - latest_dt).total_seconds() / 3600
                    status, rec = "PASS", ""
                    if latest_dt < cutoff_time:
                        status = "FAIL"
                        rec = f"Latest backup is too old ({age_hours:.1f} hours). Check backup job execution."
                    else:
                         found_recent_local = True # Found at least one recent backup
                    add_result(f"{check_name}.Local.{os.path.basename(backup_dir)}", status, f"Latest backup: {os.path.basename(latest_file)} (Age: {age_hours:.1f} hours)", {"latest_file": latest_file, "age_hours": age_hours}, rec)
                # else: Handled by 'No backup files found' check above

            except Exception as e:
                 add_result(f"{check_name}.Local.{os.path.basename(backup_dir)}", "FAIL", f"Error checking backups in {backup_dir}: {e}")

    # 2. Check S3 Backups (Optional)
    if CHECK_S3_BACKUPS:
        if not all([S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET]):
             add_result(f"{check_name}.S3", "FAIL", "S3 configuration incomplete for backup check.", recommendation="Set S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET.")
        else:
            try:
                import boto3
                from botocore.exceptions import ClientError

                s3_client = boto3.client(
                    's3', aws_access_key_id=S3_ACCESS_KEY, aws_secret_access_key=S3_SECRET_KEY,
                    endpoint_url=S3_ENDPOINT_URL, region_name=S3_REGION
                )
                latest_s3_obj = None
                latest_s3_mtime = datetime.datetime.fromtimestamp(0, datetime.timezone.utc) # Timezone aware epoch

                paginator = s3_client.get_paginator('list_objects_v2')
                pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_PREFIX)
                for page in pages:
                    if 'Contents' in page:
                        for obj in page['Contents']:
                             # Basic check: find the most recently modified object in the prefix
                             if obj['LastModified'] > latest_s3_mtime:
                                  latest_s3_mtime = obj['LastModified']
                                  latest_s3_obj = obj['Key']

                if latest_s3_obj:
                    now_utc = datetime.datetime.now(datetime.timezone.utc)
                    age_hours_s3 = (now_utc - latest_s3_mtime).total_seconds() / 3600
                    status, rec = "PASS", ""
                    if latest_s3_mtime < (now_utc - datetime.timedelta(hours=MAX_BACKUP_AGE_HOURS)): # Compare UTC times
                        status = "FAIL"
                        rec = f"Latest S3 backup is too old ({age_hours_s3:.1f} hours). Check offsite backup job."
                    add_result(f"{check_name}.S3", status, f"Latest S3 backup object: {latest_s3_obj} (Age: {age_hours_s3:.1f} hours)", {"latest_object": latest_s3_obj, "age_hours": age_hours_s3}, rec)
                else:
                     add_result(f"{check_name}.S3", "FAIL", f"No backup objects found in s3://{S3_BUCKET}/{S3_PREFIX}", recommendation="Check offsite backup job execution.")

            except ImportError:
                 add_result(f"{check_name}.S3", "FAIL", "boto3 library not found.", recommendation="Install boto3 (`pip install boto3`).")
            except ClientError as e:
                 add_result(f"{check_name}.S3", "FAIL", f"S3 ClientError checking backups: {e}", recommendation="Check S3 credentials, endpoint, bucket name, and permissions.")
            except Exception as e:
                 add_result(f"{check_name}.S3", "FAIL", f"Error checking S3 backups: {e}")

    # 3. Backup Recoverability (Placeholder)
    add_result(f"{check_name}.Recoverability", "INFO", "Backup recoverability check placeholder.", recommendation="Implement periodic test restores (manual or scripted) to verify backup integrity.")


# --- Reporting ---
def generate_report():
    """Generates and saves the health check report."""
    logger.info("--- Generating Health Check Report ---")
    report_timestamp = datetime.datetime.now().strftime(TIMESTAMP_FORMAT)
    report_filename = f"health_report_{report_timestamp}.json"
    if not os.path.exists(REPORT_DIR):
        os.makedirs(REPORT_DIR)
    report_path = os.path.join(REPORT_DIR, report_filename)

    summary = {
        "overall_status": "PASS", # Assume PASS initially
        "timestamp": datetime.datetime.now().isoformat(),
        "total_checks": len(health_results),
        "pass_count": 0,
        "warn_count": 0,
        "fail_count": 0,
        "skip_count": 0,
        "info_count": 0,
    }
    final_status = "PASS"

    for result in health_results:
        status = result["status"]
        if status == "PASS": summary["pass_count"] += 1
        elif status == "WARN":
             summary["warn_count"] += 1
             if final_status == "PASS": final_status = "WARN" # Downgrade overall status
        elif status == "FAIL":
             summary["fail_count"] += 1
             final_status = "FAIL" # FAIL overrides WARN and PASS
        elif status == "SKIP": summary["skip_count"] += 1
        elif status == "INFO": summary["info_count"] += 1

    summary["overall_status"] = final_status

    full_report = {
        "summary": summary,
        "results": health_results
    }

    # Print Summary to Console
    logger.info("--- Health Check Summary ---")
    logger.info(f"Overall Status: {summary['overall_status']}")
    logger.info(f"Checks: Total={summary['total_checks']}, Pass={summary['pass_count']}, Warn={summary['warn_count']}, Fail={summary['fail_count']}, Skip={summary['skip_count']}")
    if summary["fail_count"] > 0:
         logger.error("FAILURES DETECTED:")
         for r in health_results:
              if r['status'] == 'FAIL': logger.error(f"  - {r['check']}: {r['message']} {r.get('recommendation','')}")
    if summary["warn_count"] > 0:
         logger.warning("WARNINGS DETECTED:")
         for r in health_results:
              if r['status'] == 'WARN': logger.warning(f"  - {r['check']}: {r['message']} {r.get('recommendation','')}")


    # Save Full Report JSON
    try:
        with open(report_path, 'w') as f:
            json.dump(full_report, f, indent=2)
        logger.info(f"Full health report saved to: {report_path}")
    except Exception as e:
        logger.error(f"Failed to save health report to {report_path}: {e}")

    return final_status

# --- Main Execution ---
if __name__ == "__main__":
    logger.info("=== Starting Comprehensive Homelab Health Check ===")
    start_run_time = datetime.datetime.now()

    # Run checks sequentially
    check_system_resources()
    check_service_functionality()
    check_database_health()
    check_network_connectivity()
    check_security_posture()
    check_backup_integrity()

    # Generate report and determine final status
    final_status = generate_report()

    end_run_time = datetime.datetime.now()
    run_duration = end_run_time - start_run_time
    logger.info(f"Health check run finished in {run_duration}.")
    logger.info(f"Exiting with status: {final_status}")

    # Exit with appropriate code for automation
    if final_status == "FAIL":
        sys.exit(1)
    # Consider exiting 0 even for WARN, depending on desired alerting behavior
    # elif final_status == "WARN":
    #     sys.exit(2) # Or 0
    else:
        sys.exit(0)

# --- Scheduling Notes ---
#
# This script can be run as a Kubernetes CronJob or systemd timer.
#
# 1.  **Containerization:**
#     - Create Dockerfile based on Python.
#     - Install dependencies: `requests`, `psycopg2-binary` (if CHECK_DB), `boto3` (if CHECK_S3_BACKUPS).
#     - Install command-line tools: `ping` (usually present), `gpg` (if checking encrypted backups), `trivy`, `kube-bench` (if CHECK_SECURITY).
#     - COPY script into image.
#     - Set ENTRYPOINT/CMD.
#
# 2.  **Kubernetes CronJob:**
#     - Define `CronJob` resource.
#     - Set schedule (e.g., `0 * * * *` for hourly).
#     - Use the container image.
#     - Configure environment variables (use Secrets for credentials like PG_PASSWORD, S3 keys).
#     - Mount a PVC for storing reports (`REPORT_DIR`).
#     - Consider resource limits/requests.
#     - Set `concurrencyPolicy: Forbid`.
#
# 3.  **Alerting:**
#     - The script logs to stdout/stderr. CronJob logs can be collected.
#     - For proactive alerting on FAIL/WARN status:
#       - Wrap the script execution in a shell script that checks the exit code and sends a notification (e.g., via curl to n8n/Healthchecks.io/Gotify).
#       - Or, configure log monitoring (e.g., Loki/Promtail) to trigger alerts based on log messages (e.g., "Overall Status: FAIL").
#       - Or, have the script directly push status to a monitoring endpoint.
