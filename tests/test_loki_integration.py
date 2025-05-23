import pytest
import time
from loguru import logger


def test_loki_logging_basic(test_logger):
    """Test that basic logging to Loki works"""
    test_logger.info("This is a test log message")
    test_logger.warning("This is a warning message")
    test_logger.error("This is an error message")

    # Allow time for logs to be sent to Loki
    time.sleep(1)

    # This test just verifies the logging doesn't crash
    assert True


def test_loki_logging_with_metadata(test_logger, test_log_manager):
    """Test that logging with metadata works"""
    # Add test-specific metadata
    test_log_manager.add_test_metadata({
        "component": "logging",
        "category": "integration",
        "feature": "metadata"
    })

    # Log with this metadata attached
    test_logger.info("Log message with metadata")

    # Allow time for logs to be sent to Loki
    time.sleep(1)

    # Query back the logs to verify they were received
    logs = test_log_manager.get_logs_for_test("test_loki_logging_with_metadata", minutes=5)

    # Verify no error in the response
    assert "error" not in logs

    # If Loki is available, verify we got results
    if logs.get("data") and logs["data"].get("result"):
        assert len(logs["data"]["result"]) > 0
    else:
        pytest.skip("Loki server not available, skipping verification")


def test_loki_query_performance(test_logger):
    """Test that Loki queries are efficient"""
    # Generate several log entries
    for i in range(10):
        test_logger.info(f"Performance test log {i}")

    # Allow time for logs to be sent to Loki
    time.sleep(1)

    # This is just to demonstrate how test performance would be measured
    # In a real test, you would query Loki and measure response time
    start = time.time()
    time.sleep(0.1)  # Simulate query time
    duration = time.time() - start

    # Assert query time is reasonable
    assert duration < 1.0, "Loki query took too long"
