#!/usr/bin/env python3

import os
import logging
import sys
import subprocess
import re
import statistics

# --- Configuration ---
# Comma-separated list of node hostnames/IPs to test connectivity between
NODE_TARGETS = os.getenv("NODE_TARGETS", "").split(',') # e.g., "node1.homelab,node2.homelab,node3.homelab"
PING_COUNT = int(os.getenv("PING_COUNT", "10"))
PING_TIMEOUT = int(os.getenv("PING_TIMEOUT", "10")) # Overall timeout for ping command in seconds
LATENCY_HIGH_THRESHOLD_MS = float(os.getenv("LATENCY_HIGH_THRESHOLD_MS", "10.0")) # Avg latency threshold
PACKET_LOSS_HIGH_THRESHOLD_PCT = float(os.getenv("PACKET_LOSS_HIGH_THRESHOLD_PCT", "1.0")) # % packet loss

# iperf3 configuration (optional, requires iperf3 installed on nodes)
DO_IPERF_TEST = os.getenv("DO_IPERF_TEST", "false").lower() == "true"
IPERF_PORT = os.getenv("IPERF_PORT", "5201")
IPERF_DURATION = int(os.getenv("IPERF_DURATION", "10")) # Duration of iperf test in seconds
SSH_USER = os.getenv("SSH_USER", "your_ssh_user") # User for running iperf3 server/client
SSH_OPTIONS = os.getenv("SSH_OPTIONS", "-o StrictHostKeyChecking=no")

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("NetworkAnalyzer")

# --- Helper Functions ---
def run_local_command(command, check=True, timeout=None):
    """Runs a local shell command."""
    cmd_str = ' '.join(command)
    logger.info(f"Running local command: {cmd_str}")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            text=True,
            timeout=timeout
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        if stdout: logger.info(f"Command stdout:\n{stdout}")
        if stderr: logger.warning(f"Command stderr:\n{stderr}")
        return stdout, stderr
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out after {timeout}s: {cmd_str}")
        raise
    except subprocess.CalledProcessError as e:
        logger.error(f"Command failed with exit code {e.returncode}: {cmd_str}")
        if e.stderr: logger.error(f"Error output:\n{e.stderr.strip()}")
        raise
    except Exception as e:
        logger.error(f"Failed to run command {cmd_str}: {e}")
        raise

def run_remote_command(node, command_str, check=True, timeout=60):
    """Runs a command on a remote node via SSH."""
    ssh_cmd = ["ssh"] + SSH_OPTIONS.split() + [f"{SSH_USER}@{node}", command_str]
    # Use run_local_command to execute the ssh command itself
    return run_local_command(ssh_cmd, check=check, timeout=timeout)

def parse_ping_output(output):
    """Parses the output of the standard ping command."""
    loss_match = re.search(r'(\d+(\.\d+)?)%\s+packet\s+loss', output)
    # Look for rtt min/avg/max/mdev line
    rtt_match = re.search(r'rtt\s+min/avg/max/mdev\s*=\s*(\d+\.\d+)/(\d+\.\d+)/(\d+\.\d+)/(\d+\.\d+)\s*ms', output, re.IGNORECASE)
    # Alternative for some ping versions (e.g., busybox)
    if not rtt_match:
         rtt_match = re.search(r'round-trip\s+min/avg/max\s*=\s*(\d+\.\d+)/(\d+\.\d+)/(\d+\.\d+)\s*ms', output, re.IGNORECASE)

    packet_loss = float(loss_match.group(1)) if loss_match else None
    avg_latency = float(rtt_match.group(2)) if rtt_match else None

    return packet_loss, avg_latency

# --- Analysis Functions ---

def analyze_ping_latency_loss():
    """Performs ping tests between nodes to check latency and packet loss."""
    logger.info("--- Analyzing Inter-Node Network Latency and Packet Loss (Ping) ---")
    recommendations = []
    nodes = [n for n in NODE_TARGETS if n]
    if len(nodes) < 2:
        logger.warning("Need at least two NODE_TARGETS defined to perform inter-node ping tests. Skipping.")
        return recommendations

    # Assumes the script runs on one of the nodes or a machine that can ping all targets
    logger.info(f"Testing connectivity between nodes: {', '.join(nodes)}")

    results = {} # Store results to avoid duplicate messages

    for source_node in nodes: # Conceptually, though we run ping from the script's location
        for target_node in nodes:
            if source_node == target_node:
                continue

            pair_key = tuple(sorted((source_node, target_node)))
            if pair_key in results: continue # Already tested this pair

            logger.info(f"Pinging {target_node} from current host (representing {source_node})...")
            try:
                # Use -W for timeout per ping, -w for overall deadline
                ping_cmd = ["ping", "-c", str(PING_COUNT), f"-W{PING_TIMEOUT//PING_COUNT}", target_node]
                stdout, _ = run_local_command(ping_cmd, check=True, timeout=PING_TIMEOUT + 2) # Allow slight buffer
                packet_loss, avg_latency = parse_ping_output(stdout)

                results[pair_key] = {"loss": packet_loss, "latency": avg_latency}

                if packet_loss is None or avg_latency is None:
                     logger.warning(f"Could not parse ping results for {target_node}.")
                     continue

                logger.info(f"Ping {source_node} -> {target_node}: Loss={packet_loss:.1f}%, Avg Latency={avg_latency:.3f}ms")

                if packet_loss > PACKET_LOSS_HIGH_THRESHOLD_PCT:
                    rec = f"High packet loss ({packet_loss:.1f}%) detected between {source_node} and {target_node} (>{PACKET_LOSS_HIGH_THRESHOLD_PCT}%). Check network hardware, cables, and configurations."
                    logger.warning(rec)
                    recommendations.append(rec)
                if avg_latency > LATENCY_HIGH_THRESHOLD_MS:
                    rec = f"High average latency ({avg_latency:.3f}ms) detected between {source_node} and {target_node} (>{LATENCY_HIGH_THRESHOLD_MS}ms). Check network load, switches, and potential bottlenecks."
                    logger.warning(rec)
                    recommendations.append(rec)

            except subprocess.TimeoutExpired:
                 logger.error(f"Ping command to {target_node} timed out.")
                 recommendations.append(f"Ping to {target_node} timed out. Node might be down or network blocked.")
                 results[pair_key] = {"loss": 100.0, "latency": None} # Assume 100% loss on timeout
            except subprocess.CalledProcessError:
                 logger.error(f"Ping command to {target_node} failed (e.g., unknown host, network unreachable).")
                 recommendations.append(f"Ping to {target_node} failed. Check DNS, routing, and firewall rules.")
                 results[pair_key] = {"loss": 100.0, "latency": None} # Assume 100% loss on failure
            except Exception as e:
                 logger.error(f"Error during ping test to {target_node}: {e}")
                 recommendations.append(f"Unexpected error pinging {target_node}: {e}")
                 results[pair_key] = {"loss": None, "latency": None}

    return recommendations

def analyze_iperf_throughput():
    """Performs iperf3 tests between nodes for throughput analysis."""
    logger.info("--- Analyzing Inter-Node Network Throughput (iperf3) ---")
    recommendations = []
    nodes = [n for n in NODE_TARGETS if n]
    if len(nodes) < 2:
        logger.warning("Need at least two NODE_TARGETS defined for iperf3 tests. Skipping.")
        return recommendations
    if not SSH_USER:
         logger.warning("SSH_USER not set. Cannot run remote iperf3 commands. Skipping.")
         return recommendations

    logger.warning("iperf3 tests require iperf3 installed on all target nodes and SSH access.")
    logger.warning(f"Ensure port {IPERF_PORT} is open between nodes.")

    results = {}

    for server_node in nodes:
        iperf_server_cmd = f"iperf3 -s -p {IPERF_PORT} -1" # Run server for one connection
        server_proc = None
        try:
            # Start iperf3 server in background on the server node
            logger.info(f"Starting iperf3 server on {server_node}...")
            # Run in background, don't wait for it to finish here
            ssh_cmd = ["ssh"] + SSH_OPTIONS.split() + [f"{SSH_USER}@{server_node}", iperf_server_cmd + " &"]
            subprocess.Popen(ssh_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(2) # Give server a moment to start

            for client_node in nodes:
                if client_node == server_node:
                    continue

                pair_key = tuple(sorted((server_node, client_node)))
                if pair_key in results: continue

                logger.info(f"Running iperf3 client on {client_node} connecting to {server_node}...")
                iperf_client_cmd = f"iperf3 -c {server_node} -p {IPERF_PORT} -t {IPERF_DURATION} -J" # -J for JSON output

                try:
                    stdout, stderr = run_remote_command(client_node, iperf_client_cmd, timeout=IPERF_DURATION + 15)
                    if not stdout:
                         logger.warning(f"iperf3 client on {client_node} produced no output.")
                         continue

                    try:
                         iperf_result = json.loads(stdout)
                         # Extract sender throughput at the end
                         if 'end' in iperf_result and 'sum_sent' in iperf_result['end']:
                              bits_per_second = iperf_result['end']['sum_sent']['bits_per_second']
                              gbps = bits_per_second / 1e9
                              logger.info(f"iperf3 {client_node} -> {server_node}: Throughput = {gbps:.2f} Gbits/sec")
                              results[pair_key] = gbps
                              # Add recommendation logic based on expected throughput (e.g., link speed)
                              # Example: if gbps < 0.8: # For a 1Gbps link
                              #    rec = f"Low throughput ({gbps:.2f} Gbps) detected between {client_node} and {server_node}. Expected closer to 1 Gbps. Check NIC settings, cables, switch ports."
                              #    logger.warning(rec)
                              #    recommendations.append(rec)
                         else:
                              logger.warning(f"Could not parse throughput from iperf3 JSON output for {client_node} -> {server_node}")
                              logger.debug(f"iperf3 output:\n{stdout}")

                    except json.JSONDecodeError:
                         logger.error(f"Failed to parse iperf3 JSON output from {client_node}.")
                         logger.debug(f"iperf3 output:\n{stdout}")
                    except Exception as parse_e:
                         logger.error(f"Error processing iperf3 result for {client_node} -> {server_node}: {parse_e}")

                except Exception as client_e:
                     logger.error(f"iperf3 client test failed for {client_node} -> {server_node}: {client_e}")
                     recommendations.append(f"iperf3 test failed between {client_node} and {server_node}. Check connectivity, firewall, and iperf3 installation.")

        finally:
            # Attempt to kill the iperf3 server process - best effort
            logger.info(f"Attempting to stop iperf3 server on {server_node}...")
            try:
                 # Use pkill, may require sudo depending on user
                 run_remote_command(server_node, f"pkill -f 'iperf3 -s -p {IPERF_PORT}'", check=False, timeout=10)
            except Exception as kill_e:
                 logger.warning(f"Failed to kill iperf3 server on {server_node}: {kill_e}. Manual cleanup might be needed.")

    return recommendations

# --- Main Execution ---
def main():
    logger.info("=== Starting Network Performance Analysis ===")
    all_recommendations = []

    ping_recs = analyze_ping_latency_loss()
    all_recommendations.extend(ping_recs)

    if DO_IPERF_TEST:
        iperf_recs = analyze_iperf_throughput()
        all_recommendations.extend(iperf_recs)
    else:
        logger.info("Skipping iperf3 throughput tests as DO_IPERF_TEST is false.")

    logger.info("--- Analysis Summary ---")
    if not all_recommendations:
        logger.info("No major network performance issues found based on current checks and thresholds.")
    else:
        logger.warning("Potential Network Optimization Areas Found:")
        for i, rec in enumerate(all_recommendations):
            print(f"{i+1}. {rec}")

    logger.info("=== Network Performance Analysis Finished ===")

if __name__ == "__main__":
     # Check for ping
    if subprocess.run(["ping", "-c", "1", "127.0.0.1"], capture_output=True, check=False).returncode != 0:
         logger.critical("ping command not found or failed to run. Please install it.")
         sys.exit(2)
    if DO_IPERF_TEST:
         # Check for ssh locally, assume iperf3 exists remotely
         if subprocess.run(["ssh", "-V"], capture_output=True, check=False).returncode != 0:
              logger.critical("ssh command not found or failed to run. Please install it.")
              sys.exit(2)

     main()
