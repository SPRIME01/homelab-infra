import os
import socket
import datetime
import logging
from typing import Dict, Any, Optional

from loguru import logger
from logging_loki import LokiHandler
import pytest

# Configure default logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


class TestLogManager:
    """
    Manages logging for test suites with Loki integration.
    This allows centralized log aggregation and analysis of test runs.
    """

    def __init__(self, loki_url: Optional[str] = None, test_run_id: Optional[str] = None):
        self.loki_url = loki_url or os.environ.get("LOKI_URL", "http://localhost:3100/loki/api/v1/push")
        self.test_run_id = test_run_id or os.environ.get(
            "TEST_RUN_ID", datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        )
        self.hostname = socket.gethostname()
        self._configure_logging()

    def _configure_logging(self) -> None:
        # Check if we can connect to Loki
        if self._check_loki_connection():
            # Create a handler for python's logging
            loki_handler = LokiHandler(
                url=self.loki_url,
                tags={"host": self.hostname, "test_run_id": self.test_run_id},
                version="1",
            )

            # Add handler to root logger
            root_logger = logging.getLogger()
            root_logger.addHandler(loki_handler)

            # Configure loguru logger to also send to Loki
            logger.configure(
                handlers=[
                    {"sink": loki_handler, "format": "{time} - {name} - {level} - {message}"}
                ]
            )

            logger.info(f"Loki logging configured for test run {self.test_run_id}")
        else:
            logger.warning("Loki connection failed, falling back to console logging only")

    def _check_loki_connection(self) -> bool:
        """Check if we can connect to the Loki server"""
        try:
            import requests
            response = requests.get(
                self.loki_url.replace("/push", ""),
                timeout=2
            )
            return response.status_code < 400
        except Exception as e:
            logger.warning(f"Failed to connect to Loki: {str(e)}")
            return False

    def add_test_metadata(self, metadata: Dict[str, Any]) -> None:
        """Add additional metadata to logs for the current test run"""
        logger.bind(**metadata)

    def get_logs_for_test(self, test_name: str, minutes: int = 30) -> Dict[str, Any]:
        """Query Loki for logs related to a specific test"""
        try:
            import requests
            end_time = datetime.datetime.now()
            start_time = end_time - datetime.timedelta(minutes=minutes)

            # Convert to nanoseconds since unix epoch
            start_ts = int(start_time.timestamp() * 1_000_000_000)
            end_ts = int(end_time.timestamp() * 1_000_000_000)

            # Query Loki
            query_url = self.loki_url.replace("/push", "/query_range")
            query_params = {
                "query": f'{{test_run_id="{self.test_run_id}", test="{test_name}"}}',
                "start": start_ts,
                "end": end_ts,
                "limit": 1000,
            }

            response = requests.get(query_url, params=query_params)
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to query Loki: {response.status_code} {response.text}")
                return {"error": f"Query failed: {response.status_code}"}

        except Exception as e:
            logger.exception(f"Error querying Loki: {str(e)}")
            return {"error": str(e)}

    def log_test_result(self, test_name: str, result: str, duration_ms: int) -> None:
        """Log test execution result with metrics"""
        logger.info(
            f"Test {test_name} finished with result: {result}",
            test=test_name,
            result=result,
            duration_ms=duration_ms,
            test_run_id=self.test_run_id,
        )


# Create a pytest fixture for the log manager
@pytest.fixture(scope="session")
def test_log_manager():
    """Pytest fixture to provide a TestLogManager instance"""
    log_manager = TestLogManager()
    yield log_manager


@pytest.fixture(scope="function")
def test_logger(request, test_log_manager):
    """Fixture to log test execution with proper metadata"""
    test_name = request.node.name
    test_log_manager.add_test_metadata({"test": test_name})

    logger.info(f"Starting test: {test_name}")
    start_time = datetime.datetime.now()

    yield logger

    # Log test completion with duration
    duration = datetime.datetime.now() - start_time
    duration_ms = int(duration.total_seconds() * 1000)
    result = "passed" if not request.node.rep_call.failed else "failed"
    test_log_manager.log_test_result(test_name, result, duration_ms)


# Pytest hook to capture test results
@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    setattr(item, f"rep_{rep.when}", rep)
