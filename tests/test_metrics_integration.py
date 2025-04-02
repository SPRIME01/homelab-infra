import pytest
import time
import random


@pytest.mark.metrics
def test_basic_metrics_collection(test_metrics):
    """Test that basic metrics collection works"""
    # Create a custom metric
    custom_counter = test_metrics.create_custom_metric(
        'test_custom_counter', 
        'A custom counter for testing', 
        'counter',
        ['test_type']
    )
    
    # Increment the counter a few times
    for _ in range(5):
        custom_counter.labels(test_type='unit').inc()
    
    # Record some resource usage
    test_metrics.record_resource_usage(
        'test_basic_metrics_collection',
        'memory_mb',
        random.uniform(50, 200)
    )
    
    # Simple assertion to verify the test completes
    assert True


@pytest.mark.metrics
def test_metrics_with_timings(test_metrics):
    """Test metrics collection with timing measurements"""
    # Create a custom histogram for timing
    timing_histogram = test_metrics.create_custom_metric(
        'test_operation_timing',
        'Timing for test operations',
        'histogram',
        ['operation']
    )
    
    # Measure execution time for a simulated database operation
    start = time.time()
    time.sleep(0.05)  # Simulate database query
    timing_histogram.labels(operation='db_query').observe(time.time() - start)
    
    # Measure execution time for a simulated API call
    start = time.time()
    time.sleep(0.1)  # Simulate API call
    timing_histogram.labels(operation='api_call').observe(time.time() - start)
    
    # Record CPU usage
    test_metrics.record_resource_usage(
        'test_metrics_with_timings',
        'cpu_percent',
        random.uniform(5, 30)
    )
    
    assert True


@pytest.mark.metrics
def test_complex_metrics_scenario(test_metrics):
    """Test a more complex metrics collection scenario"""
    # Create gauges to track simulated application metrics
    active_connections = test_metrics.create_custom_metric(
        'test_active_connections',
        'Active connections in the test',
        'gauge',
        ['endpoint']
    )
    
    # Simulate connection activity
    for endpoint in ['api', 'web', 'admin']:
        connections = random.randint(5, 50)
        active_connections.labels(endpoint=endpoint).set(connections)
        
        # Simulate some work with these connections
        time.sleep(0.01 * connections)
    
    # Create a success rate metric
    success_rate = test_metrics.create_custom_metric(
        'test_success_rate',
        'Success rate for operations',
        'gauge',
        ['operation']
    )
    
    # Simulate operation success rates
    operations = {
        'login': 0.99,
        'data_fetch': 0.95,
        'update': 0.90
    }
    
    for op, rate in operations.items():
        success_rate.labels(operation=op).set(rate)
    
    # Verify that metrics were properly recorded
    assert test_metrics.get_metric_value('test_total') is not None
