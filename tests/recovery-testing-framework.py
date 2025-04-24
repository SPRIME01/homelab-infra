#!/usr/bin/env python3

import json
import logging
import os
import subprocess
import sys
import time
from abc import ABC, abstractmethod
from datetime import datetime, timedelta

# --- Configuration ---
KUBECTL_CONTEXT = os.getenv(
    "KUBECTL_CONTEXT", "homelab-cluster"
)  # Context for test cluster if different
RECOVERY_SCRIPT_DIR = os.getenv(
    "RECOVERY_SCRIPT_DIR", "../scripts/recovery"
)  # Path to recovery scripts
REPORT_DIR = os.getenv("REPORT_DIR", "./recovery_test_reports")
DEFAULT_TIMEOUT = int(
    os.getenv("DEFAULT_TIMEOUT", "300")
)  # Default timeout for steps in seconds

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("RecoveryTester")

# --- Safety Warning ---
logger.critical("=" * 60)
logger.critical("🚨 SAFETY WARNING 🚨")
logger.critical("This framework simulates failures and runs recovery actions.")
logger.critical(
    "Running this against a PRODUCTION environment is EXTREMELY RISKY and can cause DATA LOSS or OUTAGES."
)
logger.critical(
    "ONLY run this in a DEDICATED, ISOLATED test environment or during scheduled maintenance with full backups."
)
logger.critical("Review simulation steps carefully before execution.")
logger.critical("=" * 60)
time.sleep(5)  # Give user time to read warning


# --- Helper Functions ---
def run_command(command, check=True, timeout=None, capture_output=True, shell=False):
    """Runs a shell command with logging and timeout."""
    logger.info(f"Running command: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE if capture_output else None,
            stderr=subprocess.PIPE if capture_output else None,
            check=check,
            text=True,
            timeout=timeout,
            shell=shell,  # Use shell=True cautiously
        )
        if capture_output:
            stdout_log = result.stdout.strip() if result.stdout else ""
            stderr_log = result.stderr.strip() if result.stderr else ""
            if stdout_log:
                logger.info(f"Command stdout:\n{stdout_log}")
            if stderr_log:
                logger.warning(f"Command stderr:\n{stderr_log}")
            return stdout_log, stderr_log
        return None, None  # If not capturing output
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out after {timeout}s: {' '.join(command)}")
        raise
    except subprocess.CalledProcessError as e:
        logger.error(
            f"Command failed with exit code {e.returncode}: {' '.join(command)}"
        )
        if capture_output:
            if e.stderr:
                logger.error(f"Error output:\n{e.stderr.strip()}")
        raise
    except Exception as e:
        logger.error(f"Failed to run command {' '.join(command)}: {e}")
        raise


# --- Abstract Base Classes ---
class FailureScenario(ABC):
    """Abstract base class for defining failure scenarios."""

    def __init__(self, name, description):
        self.name = name
        self.description = description
        self.logger = logging.getLogger(f"Scenario.{name}")

    @abstractmethod
    def simulate(self):
        """Implement the logic to simulate the failure."""
        pass

    @abstractmethod
    def cleanup(self):
        """Implement logic to clean up simulation effects (if possible/safe)."""
        pass


class RecoveryProcedure(ABC):
    """Abstract base class for defining recovery procedures."""

    def __init__(self, name, description, script_path=None):
        self.name = name
        self.description = description
        self.script_path = script_path  # Path to the actual recovery script
        self.logger = logging.getLogger(f"Recovery.{name}")

    @abstractmethod
    def execute(self):
        """Implement the logic to execute the recovery procedure."""
        pass


class ValidationStep(ABC):
    """Abstract base class for validation steps."""

    def __init__(self, name, description):
        self.name = name
        self.description = description
        self.logger = logging.getLogger(f"Validation.{name}")

    @abstractmethod
    def validate(self):
        """Implement logic to validate recovery. Return True if successful, False otherwise."""
        pass


# --- Concrete Implementations (Examples) ---


# == Failure Scenarios ==
class StopDeploymentScenario(FailureScenario):
    """Simulates failure by scaling a deployment to 0 replicas."""

    def __init__(self, name, description, namespace, deployment_name):
        super().__init__(name, description)
        self.namespace = namespace
        self.deployment_name = deployment_name
        self.original_replicas = None

    def simulate(self):
        self.logger.warning(
            f"Simulating failure: Scaling deployment '{self.namespace}/{self.deployment_name}' to 0 replicas."
        )
        try:
            # Get original replica count
            stdout, _ = run_command(
                [
                    "kubectl",
                    "get",
                    "deployment",
                    self.deployment_name,
                    "-n",
                    self.namespace,
                    "--context",
                    KUBECTL_CONTEXT,
                    "-o",
                    "jsonpath={.spec.replicas}",
                ]
            )
            self.original_replicas = int(stdout) if stdout.isdigit() else 1
            self.logger.info(f"Original replica count: {self.original_replicas}")

            # Scale down
            run_command(
                [
                    "kubectl",
                    "scale",
                    "deployment",
                    self.deployment_name,
                    "--replicas=0",
                    "-n",
                    self.namespace,
                    "--context",
                    KUBECTL_CONTEXT,
                ]
            )
            # Wait briefly for scale down to initiate
            time.sleep(10)
            self.logger.info("Simulation complete: Deployment scaled down.")
        except Exception as e:
            self.logger.error(f"Failed to simulate failure: {e}")
            raise

    def cleanup(self):
        if self.original_replicas is not None:
            self.logger.info(
                f"Cleaning up simulation: Scaling deployment '{self.namespace}/{self.deployment_name}' back to {self.original_replicas} replicas."
            )
            try:
                run_command(
                    [
                        "kubectl",
                        "scale",
                        "deployment",
                        self.deployment_name,
                        f"--replicas={self.original_replicas}",
                        "-n",
                        self.namespace,
                        "--context",
                        KUBECTL_CONTEXT,
                    ]
                )
            except Exception as e:
                self.logger.error(f"Failed to cleanup simulation: {e}")
        else:
            self.logger.warning("Cleanup skipped: Original replica count not recorded.")


# Add more scenarios: DeletePodScenario, NetworkPolicyScenario (apply blocking policy), etc.
# Be extremely careful with node-level or storage-level simulations.


# == Recovery Procedures ==
class ExecuteScriptRecovery(RecoveryProcedure):
    """Executes a specified recovery script."""

    def __init__(self, name, description, script_name, script_args=None, env_vars=None):
        script_full_path = os.path.join(RECOVERY_SCRIPT_DIR, script_name)
        super().__init__(name, description, script_full_path)
        self.script_args = script_args or []
        self.env_vars = env_vars or {}

    def execute(self):
        self.logger.info(
            f"Executing recovery script: {self.script_path} with args {self.script_args}"
        )
        if not os.path.exists(self.script_path):
            raise FileNotFoundError(f"Recovery script not found: {self.script_path}")

        command = ["python3", self.script_path] + self.script_args
        # Prepare environment variables
        script_env = os.environ.copy()
        script_env.update(self.env_vars)
        script_env["KUBECTL_CONTEXT"] = KUBECTL_CONTEXT  # Ensure context is passed

        try:
            # Run the script - assume script exits 0 on success, non-zero on failure
            run_command(command, check=True, timeout=DEFAULT_TIMEOUT)  # Use check=True
            self.logger.info("Recovery script executed successfully.")
        except subprocess.CalledProcessError as e:
            self.logger.error(f"Recovery script failed with exit code {e.returncode}.")
            raise  # Re-raise to indicate recovery failure
        except Exception as e:
            self.logger.error(f"Failed to execute recovery script: {e}")
            raise


# == Validation Steps ==
class DeploymentReadyValidation(ValidationStep):
    """Validates if a deployment has the desired number of ready replicas."""

    def __init__(
        self,
        name,
        description,
        namespace,
        deployment_name,
        expected_replicas=None,
        min_ready_percent=100,
    ):
        super().__init__(name, description)
        self.namespace = namespace
        self.deployment_name = deployment_name
        self.expected_replicas = (
            expected_replicas  # Optional: check against specific number
        )
        self.min_ready_percent = min_ready_percent

    def validate(self):
        self.logger.info(
            f"Validating deployment '{self.namespace}/{self.deployment_name}' readiness..."
        )
        try:
            stdout, _ = run_command(
                [
                    "kubectl",
                    "get",
                    "deployment",
                    self.deployment_name,
                    "-n",
                    self.namespace,
                    "--context",
                    KUBECTL_CONTEXT,
                    "-o",
                    "json",
                ],
                timeout=60,
            )
            if not stdout:
                self.logger.error("Failed to get deployment status.")
                return False

            deployment = json.loads(stdout)
            spec_replicas = deployment.get("spec", {}).get("replicas", 0)
            ready_replicas = deployment.get("status", {}).get("readyReplicas", 0)

            target_replicas = (
                self.expected_replicas
                if self.expected_replicas is not None
                else spec_replicas
            )

            if (
                target_replicas == 0
            ):  # If expecting 0 replicas (e.g., testing scale down)
                is_valid = ready_replicas == 0
            elif (
                spec_replicas == 0
            ):  # If spec is 0 but we expect > 0 (should not happen in recovery)
                is_valid = False
            else:
                ready_percent = (ready_replicas / spec_replicas) * 100
                is_valid = (
                    ready_replicas >= target_replicas
                    and ready_percent >= self.min_ready_percent
                )

            if is_valid:
                self.logger.info(
                    f"Validation successful: {ready_replicas}/{spec_replicas} replicas ready."
                )
                return True
            else:
                self.logger.error(
                    f"Validation failed: {ready_replicas}/{spec_replicas} replicas ready. Expected >= {target_replicas} and >= {self.min_ready_percent}%."
                )
                return False
        except Exception as e:
            self.logger.error(f"Validation failed with error: {e}")
            return False


# Add more validation steps: ServiceEndpointCheck, DatabaseQueryCheck, etc.


# --- Recovery Tester Class ---
class RecoveryTester:
    def __init__(self, report_dir=REPORT_DIR):
        self.report_dir = report_dir
        self.results = []
        if not os.path.exists(self.report_dir):
            os.makedirs(self.report_dir)

    def run_test(
        self,
        scenario: FailureScenario,
        procedure: RecoveryProcedure,
        validations: list[ValidationStep],
    ):
        """Runs a single recovery test case."""
        start_time = datetime.now()
        test_name = f"{scenario.name}__{procedure.name}"
        logger.info(f"--- Starting Test: {test_name} ---")
        result = {
            "test_name": test_name,
            "scenario": scenario.name,
            "procedure": procedure.name,
            "start_time": start_time.isoformat(),
            "steps": [],
            "success": False,
            "total_duration_seconds": None,
            "recovery_duration_seconds": None,
        }

        simulate_success = False
        recovery_success = False
        validation_success = False
        simulation_start_time = None
        recovery_start_time = None
        recovery_end_time = None

        try:
            # 1. Simulate Failure
            step_start = time.monotonic()
            logger.info(f"Step 1: Simulating failure '{scenario.name}'...")
            simulation_start_time = datetime.now()
            scenario.simulate()
            simulate_success = True
            result["steps"].append(
                {
                    "step": "simulate",
                    "name": scenario.name,
                    "success": True,
                    "duration": time.monotonic() - step_start,
                    "error": None,
                }
            )
            logger.info("Simulation step completed.")

            # 2. Execute Recovery
            step_start = time.monotonic()
            logger.info(f"Step 2: Executing recovery procedure '{procedure.name}'...")
            recovery_start_time = datetime.now()
            procedure.execute()
            recovery_success = True
            recovery_end_time = datetime.now()
            result["steps"].append(
                {
                    "step": "recover",
                    "name": procedure.name,
                    "success": True,
                    "duration": time.monotonic() - step_start,
                    "error": None,
                }
            )
            logger.info("Recovery execution step completed.")

            # 3. Validate Recovery
            logger.info("Step 3: Validating recovery...")
            all_validations_passed = True
            validation_step_results = []
            for validation in validations:
                step_start = time.monotonic()
                logger.info(f"Running validation: '{validation.name}'...")
                step_success = validation.validate()
                validation_step_results.append(
                    {
                        "step": "validate",
                        "name": validation.name,
                        "success": step_success,
                        "duration": time.monotonic() - step_start,
                        "error": None if step_success else "Validation check failed",
                    }
                )
                if not step_success:
                    all_validations_passed = False
                    # Optionally stop further validations on first failure
                    # break
            result["steps"].extend(validation_step_results)
            validation_success = all_validations_passed
            logger.info(
                f"Validation step completed. Overall success: {validation_success}"
            )

        except Exception as e:
            step_name = "unknown"
            current_step_result = {
                "success": False,
                "duration": time.monotonic() - step_start,
                "error": str(e),
            }
            if not simulate_success:
                step_name = "simulate"
                current_step_result["name"] = scenario.name
            elif not recovery_success:
                step_name = "recover"
                current_step_result["name"] = procedure.name
                recovery_end_time = datetime.now()  # Record end time even on failure
            else:  # Error during validation phase
                step_name = "validate"
                # Error is already captured in validation_step_results if it was a validation failure
                # This catches errors *running* the validation code itself.
                if not any(
                    s["step"] == "validate" and s["error"] for s in result["steps"]
                ):
                    result["steps"].append(
                        {
                            "step": "validate",
                            "name": "framework_error",
                            **current_step_result,
                        }
                    )

            logger.error(f"Test failed during step '{step_name}': {e}")
            # Ensure failed step is recorded if not already
            if not any(
                s["step"] == step_name and not s["success"] for s in result["steps"]
            ):
                # Find the step dict if it exists, update it, otherwise add it
                step_dict = next(
                    (s for s in result["steps"] if s["step"] == step_name), None
                )
                if step_dict:
                    step_dict.update(current_step_result)
                else:
                    # Need a name if adding fresh
                    name = (
                        scenario.name
                        if step_name == "simulate"
                        else procedure.name
                        if step_name == "recover"
                        else "validation_framework"
                    )
                    result["steps"].append(
                        {"step": step_name, "name": name, **current_step_result}
                    )

        finally:
            # 4. Cleanup Simulation
            step_start = time.monotonic()
            logger.info("Step 4: Cleaning up simulation...")
            try:
                scenario.cleanup()
                result["steps"].append(
                    {
                        "step": "cleanup",
                        "name": scenario.name,
                        "success": True,
                        "duration": time.monotonic() - step_start,
                        "error": None,
                    }
                )
                logger.info("Cleanup step completed.")
            except Exception as e:
                logger.error(f"Cleanup failed: {e}")
                result["steps"].append(
                    {
                        "step": "cleanup",
                        "name": scenario.name,
                        "success": False,
                        "duration": time.monotonic() - step_start,
                        "error": str(e),
                    }
                )

            end_time = datetime.now()
            result["end_time"] = end_time.isoformat()
            result["success"] = (
                simulate_success and recovery_success and validation_success
            )
            result["total_duration_seconds"] = (end_time - start_time).total_seconds()
            if recovery_start_time and recovery_end_time:
                # RTO approximation: time from start of recovery to end of recovery execution
                # More accurate RTO includes validation time until service is confirmed usable.
                result["recovery_duration_seconds"] = (
                    recovery_end_time - recovery_start_time
                ).total_seconds()

            self.results.append(result)
            logger.info(
                f"--- Test Finished: {test_name} | Success: {result['success']} | Duration: {result['total_duration_seconds']:.2f}s ---"
            )
            self.save_report(test_name, result)

    def save_report(self, test_name, result_data):
        """Saves the result of a single test to a JSON file."""
        report_filename = f"{test_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_path = os.path.join(self.report_dir, report_filename)
        logger.info(f"Saving report to {report_path}")
        try:
            with open(report_path, "w") as f:
                json.dump(result_data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save report {report_path}: {e}")

    def generate_summary_report(self):
        """Generates a summary of all test runs."""
        logger.info("--- Recovery Test Summary ---")
        total_tests = len(self.results)
        successful_tests = sum(1 for r in self.results if r["success"])
        failed_tests = total_tests - successful_tests

        logger.info(f"Total Tests Run: {total_tests}")
        logger.info(f"Successful Tests: {successful_tests}")
        logger.info(f"Failed Tests: {failed_tests}")

        for i, result in enumerate(self.results):
            status = "✅ SUCCESS" if result["success"] else "❌ FAILED"
            duration = result.get("total_duration_seconds", "N/A")
            recovery_duration = result.get("recovery_duration_seconds", "N/A")
            logger.info(f"\nTest {i+1}: {result['test_name']}")
            logger.info(f"  Status: {status}")
            logger.info(
                f"  Total Duration: {duration:.2f}s"
                if isinstance(duration, float)
                else f"  Total Duration: {duration}"
            )
            logger.info(
                f"  Recovery Duration: {recovery_duration:.2f}s"
                if isinstance(recovery_duration, float)
                else f"  Recovery Duration: {recovery_duration}"
            )
            if not result["success"]:
                failed_step = next(
                    (s for s in result["steps"] if not s["success"]), None
                )
                if failed_step:
                    logger.warning(
                        f"  Failed Step: {failed_step['step']} - {failed_step['name']}"
                    )
                    if failed_step["error"]:
                        logger.warning(f"    Error: {failed_step['error']}")

        # Save summary (optional)
        summary_path = os.path.join(self.report_dir, "summary_report.json")
        try:
            with open(summary_path, "w") as f:
                json.dump(self.results, f, indent=2)
            logger.info(f"Summary report saved to {summary_path}")
        except Exception as e:
            logger.error(f"Failed to save summary report: {e}")


# --- Test Definitions ---
def define_test_cases():
    """Define the specific test cases to run."""
    test_cases = []

    # Test Case 1: Simulate App Deployment Failure and Recover
    app_ns = "default"  # Namespace of your test app
    app_deploy = "my-test-app"  # Name of a sample deployment

    scenario1 = StopDeploymentScenario(
        name="StopTestApp",
        description=f"Stop deployment {app_deploy} by scaling to 0",
        namespace=app_ns,
        deployment_name=app_deploy,
    )
    recovery1 = ExecuteScriptRecovery(
        name="RecoverServiceScript",
        description="Run the generic service recovery script",
        script_name="recover_service.py",
        # Pass specific target or let script check all/configured ones
        env_vars={"TARGET_SERVICES": f"{app_ns}/{app_deploy}"},
    )
    validation1 = DeploymentReadyValidation(
        name="ValidateTestAppReady",
        description=f"Check if {app_deploy} has ready replicas",
        namespace=app_ns,
        deployment_name=app_deploy,
        min_ready_percent=100,  # Expect full recovery
    )
    test_cases.append(
        {"scenario": scenario1, "procedure": recovery1, "validations": [validation1]}
    )

    # Add more test cases here...
    # Example: Test Node Failure Alert (if recover_node just alerts)
    # scenario2 = SimulateNodeNotReady(...) # Needs careful implementation
    # recovery2 = ExecuteScriptRecovery(name="DetectNodeFailure", script_name="recover_node.py")
    # validation2 = AlertReceivedValidation(...) # Needs way to check if alert was sent/received

    return test_cases


# --- Main Execution ---
if __name__ == "__main__":
    logger.info("Initializing Recovery Testing Framework...")
    tester = RecoveryTester()
    test_definitions = define_test_cases()

    if not test_definitions:
        logger.warning("No test cases defined. Exiting.")
        sys.exit(0)

    logger.info(f"Found {len(test_definitions)} test cases to run.")

    for test_case in test_definitions:
        try:
            tester.run_test(
                scenario=test_case["scenario"],
                procedure=test_case["procedure"],
                validations=test_case["validations"],
            )
        except Exception as e:
            logger.critical(
                f"Unhandled exception during test execution for {test_case.get('scenario',{}).name}: {e}",
                exc_info=True,
            )
            # Optionally record this critical failure in the report
            tester.results.append(
                {
                    "test_name": f"{test_case.get('scenario',{}).name}__{test_case.get('procedure',{}).name}",
                    "scenario": test_case.get("scenario", {}).name,
                    "procedure": test_case.get("procedure", {}).name,
                    "start_time": datetime.now().isoformat(),
                    "steps": [
                        {
                            "step": "framework",
                            "name": "critical_error",
                            "success": False,
                            "error": str(e),
                        }
                    ],
                    "success": False,
                    "end_time": datetime.now().isoformat(),
                }
            )

    tester.generate_summary_report()

    # Exit with non-zero code if any test failed
    if any(not r["success"] for r in tester.results):
        logger.error("One or more recovery tests failed.")
        sys.exit(1)
    else:
        logger.info("All recovery tests passed.")
        sys.exit(0)
