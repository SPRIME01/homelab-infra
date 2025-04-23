import subprocess
import socket
import time
import threading
import logging
import os
from typing import List, Dict, Tuple, Optional

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

class NetworkTestFramework:
    def __init__(self, components: List[str], external_targets: List[str], dns_servers: Optional[List[str]] = None):
        """
        components: List of hostnames/IPs of internal components to test.
        external_targets: List of external hostnames/IPs to test.
        dns_servers: Optional list of DNS servers to use for resolution tests.
        """
        self.components = components
        self.external_targets = external_targets
        self.dns_servers = dns_servers or ["8.8.8.8", "1.1.1.1"]

    # 1. Connectivity Testing
    def test_connectivity(self, port: int = 80, timeout: float = 2.0) -> Dict[str, bool]:
        results = {}
        for host in self.components:
            try:
                with socket.create_connection((host, port), timeout=timeout):
                    results[host] = True
            except Exception as e:
                logging.warning(f"Connectivity test failed for {host}:{port} - {e}")
                results[host] = False
        return results

    # 2. DNS Resolution Verification
    def test_dns_resolution(self, hostnames: List[str]) -> Dict[str, bool]:
        results = {}
        for hostname in hostnames:
            try:
                socket.gethostbyname(hostname)
                results[hostname] = True
            except Exception as e:
                logging.warning(f"DNS resolution failed for {hostname} - {e}")
                results[hostname] = False
        return results

    # 3. Latency and Throughput Measurement
    def measure_latency(self, host: str, count: int = 4) -> Optional[float]:
        try:
            output = subprocess.check_output(["ping", "-c", str(count), host], universal_newlines=True)
            for line in output.splitlines():
                if "avg" in line or "Average" in line:
                    # Linux: rtt min/avg/max/mdev = 0.026/0.026/0.026/0.000 ms
                    avg = line.split('/')[4]
                    return float(avg)
            return None
        except Exception as e:
            logging.warning(f"Latency measurement failed for {host} - {e}")
            return None

    def measure_throughput(self, host: str, port: int = 5201, duration: int = 5) -> Optional[float]:
        # Requires iperf3 server running on target
        try:
            output = subprocess.check_output(
                ["iperf3", "-c", host, "-p", str(port), "-t", str(duration), "-J"],
                universal_newlines=True
            )
            import json
            result = json.loads(output)
            bps = result["end"]["sum_received"]["bits_per_second"]
            mbps = bps / 1e6
            return mbps
        except Exception as e:
            logging.warning(f"Throughput measurement failed for {host}:{port} - {e}")
            return None

    # 4. Network Policy Validation
    def validate_network_policy(self, src: str, dst: str, port: int) -> bool:
        # Try to connect from src to dst:port (requires running this test from src node)
        # Here, we just attempt from the current host for demonstration
        try:
            with socket.create_connection((dst, port), timeout=2.0):
                logging.info(f"Network policy allows {src} -> {dst}:{port}")
                return True
        except Exception as e:
            logging.info(f"Network policy blocks {src} -> {dst}:{port} ({e})")
            return False

    # 5. External Access Testing
    def test_external_access(self, port: int = 443) -> Dict[str, bool]:
        results = {}
        for host in self.external_targets:
            try:
                with socket.create_connection((host, port), timeout=3.0):
                    results[host] = True
            except Exception as e:
                logging.warning(f"External access test failed for {host}:{port} - {e}")
                results[host] = False
        return results

    # 6. Failover Testing (if applicable)
    def test_failover(self, vip: str, port: int = 80, failover_action=None, timeout: int = 60) -> bool:
        """
        vip: Virtual IP or load balancer address.
        failover_action: Callable to trigger failover (e.g., stop primary node).
        timeout: Seconds to wait for failover.
        """
        try:
            # Check initial connectivity
            with socket.create_connection((vip, port), timeout=3.0):
                logging.info(f"Initial connectivity to VIP {vip}:{port} OK.")
            if failover_action:
                failover_action()
                logging.info("Failover action triggered. Waiting for failover...")
                start = time.time()
                while time.time() - start < timeout:
                    try:
                        with socket.create_connection((vip, port), timeout=3.0):
                            logging.info(f"Failover successful, VIP {vip}:{port} is reachable.")
                            return True
                    except Exception:
                        time.sleep(2)
                logging.warning(f"Failover test failed: VIP {vip}:{port} not reachable after {timeout}s.")
                return False
            return True
        except Exception as e:
            logging.warning(f"Failover test failed: {e}")
            return False

    # Run all tests (one-time validation)
    def run_all_tests(self):
        logging.info("Running connectivity tests...")
        conn_results = self.test_connectivity()
        logging.info(f"Connectivity results: {conn_results}")

        logging.info("Running DNS resolution tests...")
        dns_results = self.test_dns_resolution(self.components + self.external_targets)
        logging.info(f"DNS results: {dns_results}")

        logging.info("Measuring latency to all components...")
        for host in self.components:
            latency = self.measure_latency(host)
            logging.info(f"Latency to {host}: {latency} ms" if latency else f"Latency to {host}: failed")

        logging.info("Measuring throughput to all components (requires iperf3 servers)...")
        for host in self.components:
            throughput = self.measure_throughput(host)
            logging.info(f"Throughput to {host}: {throughput} Mbps" if throughput else f"Throughput to {host}: failed")

        logging.info("Testing external access...")
        ext_results = self.test_external_access()
        logging.info(f"External access results: {ext_results}")

    # Periodic health checks
    def run_periodic_health_checks(self, interval_sec: int = 300):
        def loop():
            while True:
                logging.info("Starting periodic health check...")
                self.run_all_tests()
                time.sleep(interval_sec)
        t = threading.Thread(target=loop, daemon=True)
        t.start()

# --- Example Usage ---

if __name__ == "__main__":
    # Example configuration (replace with your actual component hostnames/IPs)
    components = ["192.168.1.10", "192.168.1.20", "postgresql.databases.svc", "redis.caches.svc"]
    external_targets = ["8.8.8.8", "1.1.1.1", "github.com"]

    framework = NetworkTestFramework(components, external_targets)

    # One-time validation
    framework.run_all_tests()

    # Periodic health checks (uncomment to enable)
    # framework.run_periodic_health_checks(interval_sec=600)
