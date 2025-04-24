import socket
import time

import dns.resolver
import dns.reversename
import pytest

# --- Configuration (adjust for your homelab) ---
INTERNAL_DNS_NAMES = [
    "postgresql.databases.svc",
    "redis.caches.svc",
    "rabbitmq.messaging.svc",
]
EXTERNAL_DNS_NAMES = [
    "github.com",
    "cloudflare.com",
    "google.com",
]
REVERSE_DNS_IPS = [
    "8.8.8.8",
    "1.1.1.1",
]
DNS_SERVER = "127.0.0.1"  # Local DNS server for testing
DNSSEC_DOMAIN = "cloudflare.com"  # Known DNSSEC-enabled domain

# --- Helpers ---


def resolve_name(name, server=DNS_SERVER):
    resolver = dns.resolver.Resolver()
    resolver.nameservers = [server]
    try:
        answer = resolver.resolve(name)
        return [str(r) for r in answer]
    except Exception:
        return []


def reverse_lookup(ip, server=DNS_SERVER):
    resolver = dns.resolver.Resolver()
    resolver.nameservers = [server]
    try:
        rev_name = dns.reversename.from_address(ip)
        answer = resolver.resolve(rev_name, "PTR")
        return [str(r) for r in answer]
    except Exception:
        return []


def resolve_with_timing(name, server=DNS_SERVER):
    resolver = dns.resolver.Resolver()
    resolver.nameservers = [server]
    start = time.time()
    try:
        resolver.resolve(name)
        elapsed = time.time() - start
        return elapsed
    except Exception:
        return None


def check_dnssec(domain, server=DNS_SERVER):
    resolver = dns.resolver.Resolver()
    resolver.nameservers = [server]
    try:
        answer = resolver.resolve(domain, "DNSKEY", raise_on_no_answer=False)
        return bool(answer.rrset)
    except Exception:
        return False


# --- Tests ---


def test_internal_dns_resolution():
    for name in INTERNAL_DNS_NAMES:
        result = resolve_name(name)
        assert result, f"Internal DNS resolution failed for {name}"


def test_external_dns_resolution():
    for name in EXTERNAL_DNS_NAMES:
        result = resolve_name(name, server="8.8.8.8")
        assert result, f"External DNS resolution failed for {name}"


def test_reverse_dns_lookup():
    for ip in REVERSE_DNS_IPS:
        result = reverse_lookup(ip)
        assert result, f"Reverse DNS lookup failed for {ip}"


def test_dns_caching_performance():
    name = EXTERNAL_DNS_NAMES[0]
    # First query (cold cache)
    t1 = resolve_with_timing(name)
    # Second query (should be cached)
    t2 = resolve_with_timing(name)
    assert t1 is not None and t2 is not None, "DNS timing failed"
    assert t2 <= t1, f"DNS caching not effective: t1={t1:.3f}s, t2={t2:.3f}s"


def test_dnssec_support():
    result = check_dnssec(DNSSEC_DOMAIN, server="8.8.8.8")
    assert result, f"DNSSEC not supported or not validated for {DNSSEC_DOMAIN}"


# --- Reporting ---
# Pytest will output detailed pass/fail results for each test.
