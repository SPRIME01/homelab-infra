import os
import time
import threading
from typing import Dict, Any, Optional, List

import pytest
from prometheus_client import Counter, Gauge, Histogram, Summary, start_http_server, REGISTRY


class TestMetricsManager:
    """
    Manages test metrics collection and reporting to Prometheus.
    """
    
    def __init__(self, start_server: bool = False, port: int = 8000):
        """
        Initialize metrics manager.
        
        Args:
            start_server: Whether to start a metrics server
            port: Port to expose metrics on (if start_server is True)
        """
        self._metrics = {}
        
        # Define standard metrics
        self.test_total = Counter(
            'test_total', 
            'Total number of tests run', 
            ['test_name', 'test_file', 'role']
        )
        self.test_success = Counter(
            'test_success', 
            'Number of successful tests', 
            ['test_name', 'test_file', 'role']
        )
        self.test_failure = Counter(
            'test_failure', 
            'Number of failed tests', 
            ['test_name', 'test_file', 'role']
        )
        self.test_duration = Histogram(
            'test_duration_seconds', 
            'Test execution duration in seconds',
            ['test_name', 'test_file', 'role'], 
            buckets=[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0]
        )
        self.resource_usage = Gauge(
            'test_resource_usage',
            'Resource usage during test',
            ['test_name', 'resource_type']
        )
        
        # Start metrics server if requested
        self._server_thread = None
        if start_server:
            self._start_server(port)
            
    def _start_server(self, port: int) -> None:
        """Start a metrics server in a background thread"""
        def server_thread():
            start_http_server(port)
            while True:
                time.sleep(1)
        
        self._server_thread = threading.Thread(target=server_thread, daemon=True)
        self._server_thread.start()
        
    def record_test_start(self, test_name: str, test_file: str, role: str = "unknown") -> None:
        """Record the start of a test"""
        self.test_total.labels(test_name=test_name, test_file=test_file, role=role).inc()
        
    def record_test_result(self, test_name: str, test_file: str, role: str, success: bool, duration: float) -> None:
        """Record the result of a test"""
        if success:
            self.test_success.labels(test_name=test_name, test_file=test_file, role=role).inc()
        else:
            self.test_failure.labels(test_name=test_name, test_file=test_file, role=role).inc()
            
        self.test_duration.labels(test_name=test_name, test_file=test_file, role=role).observe(duration)
        
    def record_resource_usage(self, test_name: str, resource_type: str, value: float) -> None:
        """Record resource usage during a test"""
        self.resource_usage.labels(test_name=test_name, resource_type=resource_type).set(value)
        
    def create_custom_metric(self, name: str, description: str, metric_type: str = "counter", 
                            labels: List[str] = None) -> Any:
        """Create a custom metric"""
        labels = labels or []
        if name in self._metrics:
            return self._metrics[name]
            
        if metric_type.lower() == "counter":
            self._metrics[name] = Counter(name, description, labels)
        elif metric_type.lower() == "gauge":
            self._metrics[name] = Gauge(name, description, labels)
        elif metric_type.lower() == "histogram":
            self._metrics[name] = Histogram(name, description, labels)
        elif metric_type.lower() == "summary":
            self._metrics[name] = Summary(name, description, labels)
        else:
            raise ValueError(f"Unknown metric type: {metric_type}")
            
        return self._metrics[name]
        
    def get_metric_value(self, name: str) -> Optional[float]:
        """Get the current value of a metric"""
        if name not in self._metrics:
            return None
            
        try:
            return REGISTRY.get_sample_value(name)
        except Exception:
            return None


# Create a pytest fixture for the metrics manager
@pytest.fixture(scope="session")
def metrics_manager():
    """Pytest fixture to provide a TestMetricsManager instance"""
    # Determine if we should start a metrics server
    start_server = os.environ.get("START_METRICS_SERVER", "false").lower() == "true"
    port = int(os.environ.get("METRICS_PORT", "8000"))
    
    manager = TestMetricsManager(start_server=start_server, port=port)
    yield manager


@pytest.fixture(scope="function")
def test_metrics(request, metrics_manager):
    """Fixture to track test metrics automatically"""
    test_name = request.node.name
    test_file = request.node.fspath.basename
    
    # Try to determine the role from the path
    path_parts = str(request.node.fspath).split('/')
    role = "unknown"
    for i, part in enumerate(path_parts):
        if part == "roles" and i + 1 < len(path_parts):
            role = path_parts[i + 1]
            break
    
    # Record test start
    metrics_manager.record_test_start(test_name, test_file, role)
    start_time = time.time()
    
    yield metrics_manager
    
    # Record test result
    duration = time.time() - start_time
    passed = not hasattr(request.node, "rep_call") or not request.node.rep_call.failed
    metrics_manager.record_test_result(test_name, test_file, role, passed, duration)


# Pytest hook to ensure the fixtures work properly
@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    setattr(item, f"rep_{rep.when}", rep)
