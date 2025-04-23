import socket
import subprocess
import pytest
import requests

# --- Configuration (adjust for your homelab) ---
INTERNAL_SERVICES = [
    {"name": "postgresql", "host": "postgresql.databases.svc", "port": 5432},
    {"name": "redis", "host": "redis.caches.svc", "port": 6379},
    {"name": "rabbitmq", "host": "rabbitmq.messaging.svc", "port": 5672},
]
INTERNAL_DNS_NAMES = [
    "postgresql.databases.svc",
    "redis.caches.svc",
    "rabbitmq.messaging.svc",
]
CLOUDFLARE_TUNNEL_URLS = [
    "https://ha.yourdomain.com",
    # Add more tunnel URLs as needed
]
API_GATEWAY_URLS = [
    "http://api-gateway.ai.svc",
    # Add more if needed
]
SERVICE_MESH_ENDPOINTS = [
    # Example: ("service-a.mesh.svc", 8080)
]
SECURE_ENDPOINTS = [
    {"url": "https://ha.yourdomain.com", "expect_tls": True},
    # Add more endpoints to check for TLS, headers, etc.
]

# --- Helpers ---

def can_connect(host, port, timeout=2):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False

def resolve_dns(name):
    try:
        socket.gethostbyname(name)
        return True
    except Exception:
        return False

def check_tls(url):
    try:
        resp = requests.get(url, timeout=5, verify=True)
        return resp.url.startswith("https://") and resp.status_code < 500
    except Exception:
        return False

def check_headers(url, header, expected_value):
    try:
        resp = requests.get(url, timeout=5)
        return resp.headers.get(header) == expected_value
    except Exception:
        return False

# --- Tests ---

def test_internal_service_discovery_and_dns():
    for svc in INTERNAL_SERVICES:
        assert resolve_dns(svc["host"]), f"DNS resolution failed for {svc['host']}"
        assert can_connect(svc["host"], svc["port"]), f"Cannot connect to {svc['name']} at {svc['host']}:{svc['port']}"

def test_internal_dns_resolution():
    for name in INTERNAL_DNS_NAMES:
        assert resolve_dns(name), f"DNS resolution failed for {name}"

@pytest.mark.parametrize("url", CLOUDFLARE_TUNNEL_URLS)
def test_external_access_cloudflare_tunnel(url):
    try:
        resp = requests.get(url, timeout=10)
        assert resp.status_code in (200, 401, 403), f"Unexpected status code {resp.status_code} for {url}"
    except Exception as e:
        pytest.fail(f"External access via Cloudflare Tunnel failed for {url}: {e}")

def test_network_policy_enforcement():
    # This is a basic check: try to connect to a port that should be blocked by NetworkPolicy
    # Adjust host/port to a known-blocked combination in your environment
    blocked_host = "redis.caches.svc"
    blocked_port = 12345  # Port not allowed by policy
    assert not can_connect(blocked_host, blocked_port), f"NetworkPolicy failed: unexpected access to {blocked_host}:{blocked_port}"

@pytest.mark.skipif(not SERVICE_MESH_ENDPOINTS, reason="Service mesh endpoints not configured")
def test_service_mesh_functionality():
    for host, port in SERVICE_MESH_ENDPOINTS:
        assert can_connect(host, port), f"Service mesh routing failed for {host}:{port}"

@pytest.mark.parametrize("url", API_GATEWAY_URLS)
def test_api_gateway_routing(url):
    try:
        resp = requests.get(url, timeout=5)
        assert resp.status_code in (200, 401, 403), f"API Gateway routing failed for {url} (status {resp.status_code})"
    except Exception as e:
        pytest.fail(f"API Gateway routing failed for {url}: {e}")

@pytest.mark.parametrize("endpoint", SECURE_ENDPOINTS)
def test_security_of_network_communication(endpoint):
    url = endpoint["url"]
    expect_tls = endpoint.get("expect_tls", False)
    assert check_tls(url) == expect_tls, f"TLS check failed for {url}"
    # Example: Check for security headers
    # assert check_headers(url, "Strict-Transport-Security", "max-age=..."), f"HSTS header missing for {url}"

# --- Reporting ---
# Pytest will output detailed pass/fail results for each test.
