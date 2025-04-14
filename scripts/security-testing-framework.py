#!/usr/bin/env python3
"""
Security Testing Framework for Homelab

This framework provides automated security testing capabilities for a homelab environment,
integrating various tools for penetration testing, vulnerability scanning, configuration audits,
and compliance checks.

Features:
- Automated web application penetration testing
- Container image vulnerability scanning
- Kubernetes configuration audits
- Compliance checks against standards
- Extensible architecture for adding new tools
- Reporting and alerting on findings
"""

import os
import sys
import json
import time
import uuid
import shutil
import argparse
import subprocess
import logging
import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Callable

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("/var/log/homelab/security-testing.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("homelab-security-testing")

# Default configuration
DEFAULT_CONFIG = {
    "general": {
        "results_dir": "/var/lib/homelab/security-testing-results",
        "max_report_age_days": 30,
        "alert_severity_threshold": "medium",  # low, medium, high, critical
    },
    "tools": {
        "zap": {
            "enabled": True,
            "path": "/usr/local/bin/zap.sh",  # Path to ZAP executable
            "api_key": "change-me",
            "target_urls": ["http://localhost:8080", "https://myapp.homelab.local"],
            "scan_type": "baseline",  # or "full"
        },
        "nikto": {
            "enabled": False,
            "path": "/usr/bin/nikto",
            "target_urls": ["http://localhost:8080"],
            "options": "-Tuning 1,2,3,4,5",
        },
        "trivy": {
            "enabled": True,
            "path": "/usr/local/bin/trivy",
            "image_targets": ["nginx:latest", "python:3.9-slim"],
            "severity": "HIGH,CRITICAL",
            "ignore_unfixed": True,
        },
        "grype": {
            "enabled": False,
            "path": "/usr/local/bin/grype",
            "image_targets": ["nginx:latest"],
            "scope": "all-layers",
        },
        "kube-bench": {
            "enabled": True,
            "path": "/usr/local/bin/kube-bench",
            "targets": ["master", "node", "etcd", "policies"],
            "version": "1.18", # Specify Kubernetes version if needed
        },
        "custom_audit": {
            "enabled": True,
            "scripts_dir": "/home/sprime01/homelab/homelab-infra/security-audits",
        },
        "openscap": {
            "enabled": False,
            "path": "/usr/bin/oscap",
            "profile": "xccdf_org.ssgproject.content_profile_standard",
            "content_file": "/usr/share/xml/scap/ssg/content/ssg-rhel8-ds.xml",
        },
    },
    "reporting": {
        "formats": ["json", "html"],
        "output_dir": "/var/lib/homelab/security-testing-reports",
    },
    "alerting": {
        "email": {
            "enabled": True,
            "smtp_server": "localhost",
            "smtp_port": 25,
            "sender": "security-testing@homelab.local",
            "recipients": ["admin@homelab.local"],
        },
        "slack": {
            "enabled": False,
            "webhook_url": "",
        }
    }
}

SEVERITY_MAP = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4
}

class SecurityFinding:
    """Represents a single security finding"""
    def __init__(self, tool: str, finding_id: str, description: str, severity: str,
                 target: str, details: Dict[str, Any] = None, remediation: str = None):
        self.tool = tool
        self.finding_id = finding_id
        self.description = description
        self.severity = severity.lower()
        self.target = target
        self.details = details or {}
        self.remediation = remediation
        self.timestamp = datetime.datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool": self.tool,
            "finding_id": self.finding_id,
            "description": self.description,
            "severity": self.severity,
            "target": self.target,
            "details": self.details,
            "remediation": self.remediation,
            "timestamp": self.timestamp.isoformat(),
        }

    def __str__(self) -> str:
        return f"[{self.severity.upper()}] {self.tool}: {self.description} (Target: {self.target})"

class TestResult:
    """Stores the results of a single test run"""
    def __init__(self, tool_name: str, start_time: datetime.datetime):
        self.tool_name = tool_name
        self.start_time = start_time
        self.end_time: Optional[datetime.datetime] = None
        self.status: str = "running"  # running, completed, failed
        self.findings: List[SecurityFinding] = []
        self.raw_output_file: Optional[str] = None
        self.error_message: Optional[str] = None

    def add_finding(self, finding: SecurityFinding):
        self.findings.append(finding)

    def complete(self, status: str = "completed"):
        self.status = status
        self.end_time = datetime.datetime.now()

    def fail(self, error_message: str):
        self.status = "failed"
        self.error_message = error_message
        self.end_time = datetime.datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "status": self.status,
            "findings_count": len(self.findings),
            "findings": [f.to_dict() for f in self.findings],
            "raw_output_file": self.raw_output_file,
            "error_message": self.error_message,
        }

class SecurityTestRunner:
    """Base class for running a specific security test tool"""
    def __init__(self, name: str, config: Dict[str, Any], results_dir: Path):
        self.name = name
        self.config = config
        self.results_dir = results_dir
        self.tool_path = config.get("path")

    def is_enabled(self) -> bool:
        return self.config.get("enabled", False)

    def check_tool_availability(self) -> bool:
        """Check if the tool executable exists and is executable"""
        if not self.tool_path:
            logger.warning(f"Tool path not configured for {self.name}")
            return False
        if not shutil.which(self.tool_path):
            logger.warning(f"Tool {self.name} not found at {self.tool_path} or not in PATH")
            return False
        return True

    def run(self) -> TestResult:
        """Run the security test and return results"""
        start_time = datetime.datetime.now()
        result = TestResult(self.name, start_time)
        tool_results_dir = self.results_dir / self.name / start_time.strftime("%Y%m%d-%H%M%S")
        tool_results_dir.mkdir(parents=True, exist_ok=True)
        result.raw_output_file = str(tool_results_dir / "raw_output.txt")

        if not self.is_enabled():
            result.complete("skipped")
            logger.info(f"Skipping disabled tool: {self.name}")
            return result

        if not self.check_tool_availability():
            result.fail(f"Tool not available at {self.tool_path}")
            return result

        logger.info(f"Running security test: {self.name}")
        try:
            self._execute_test(result, tool_results_dir)
            if result.status == "running": # If not already failed
                result.complete()
            logger.info(f"Finished security test: {self.name}")
        except Exception as e:
            logger.error(f"Error running test {self.name}: {e}", exc_info=True)
            result.fail(str(e))

        return result

    def _execute_test(self, result: TestResult, tool_results_dir: Path):
        """Execute the specific tool logic. Must be implemented by subclasses."""
        raise NotImplementedError

    def _run_command(self, cmd: List[str], output_file: str, timeout: int = 3600) -> Tuple[int, str, str]:
        """Helper to run external commands"""
        logger.debug(f"Running command: {' '.join(cmd)}")
        try:
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False # Don't raise exception on non-zero exit code
            )
            with open(output_file, "w") as f:
                f.write(f"Command: {' '.join(cmd)}\n")
                f.write(f"Return Code: {process.returncode}\n\n")
                f.write("--- STDOUT ---\n")
                f.write(process.stdout)
                f.write("\n--- STDERR ---\n")
                f.write(process.stderr)

            if process.returncode != 0:
                 logger.warning(f"Command '{cmd[0]}' exited with code {process.returncode}. Stderr: {process.stderr[:200]}...")

            return process.returncode, process.stdout, process.stderr
        except FileNotFoundError:
            logger.error(f"Command not found: {cmd[0]}")
            raise
        except subprocess.TimeoutExpired:
            logger.error(f"Command timed out after {timeout} seconds: {' '.join(cmd)}")
            raise
        except Exception as e:
            logger.error(f"Error running command {' '.join(cmd)}: {e}")
            raise

# --- Tool Specific Runners ---

class ZapRunner(SecurityTestRunner):
    def _execute_test(self, result: TestResult, tool_results_dir: Path):
        api_key = self.config.get("api_key", "change-me")
        scan_type = self.config.get("scan_type", "baseline")
        report_file_json = tool_results_dir / "zap_report.json"
        report_file_html = tool_results_dir / "zap_report.html"

        for target_url in self.config.get("target_urls", []):
            logger.info(f"Scanning target URL with ZAP: {target_url}")
            cmd = [
                self.tool_path,
                "-cmd",
                "-autorun", str(tool_results_dir / f"zap_autorun_{target_url.replace('://','_').replace('/','_')}.yaml"),
                "-config", f"api.key={api_key}"
            ]

            # Create autorun config file (simplified example)
            autorun_content = f"""
env:
  contexts:
    - name: {target_url}
      urls:
        - {target_url}
  parameters:
    failOnError: true
    failOnWarning: false
    progressToStdout: true
jobs:
  - type: {scan_type}
    parameters:
      context: {target_url}
  - type: report
    parameters:
      template: traditional-json
      reportDir: {tool_results_dir}
      reportFile: {report_file_json.name}
  - type: report
    parameters:
      template: traditional-html
      reportDir: {tool_results_dir}
      reportFile: {report_file_html.name}
"""
            autorun_file = tool_results_dir / f"zap_autorun_{target_url.replace('://','_').replace('/','_')}.yaml"
            with open(autorun_file, "w") as f:
                f.write(autorun_content)

            returncode, stdout, stderr = self._run_command(cmd, result.raw_output_file)

            if returncode != 0:
                result.fail(f"ZAP scan failed for {target_url}. Check raw output.")
                # Continue to next target if one fails? Or stop? For now, continue.
                continue

            # Parse ZAP JSON report
            if report_file_json.exists():
                try:
                    with open(report_file_json, 'r') as f:
                        zap_data = json.load(f)
                    for site in zap_data.get('site', []):
                        for alert in site.get('alerts', []):
                            severity_map = {"Informational": "low", "Low": "low", "Medium": "medium", "High": "high"}
                            finding = SecurityFinding(
                                tool=self.name,
                                finding_id=alert.get('pluginid'),
                                description=alert.get('name'),
                                severity=severity_map.get(alert.get('riskdesc', '').split(' ')[0], 'low'),
                                target=target_url,
                                details={
                                    "url": alert.get('instances', [{}])[0].get('uri', target_url),
                                    "param": alert.get('instances', [{}])[0].get('param'),
                                    "evidence": alert.get('instances', [{}])[0].get('evidence'),
                                    "cweid": alert.get('cweid'),
                                    "wascid": alert.get('wascid'),
                                },
                                remediation=alert.get('solution')
                            )
                            result.add_finding(finding)
                except (json.JSONDecodeError, KeyError) as e:
                    logger.error(f"Failed to parse ZAP report {report_file_json}: {e}")
                    result.fail(f"Failed to parse ZAP report for {target_url}")


class TrivyRunner(SecurityTestRunner):
    def _execute_test(self, result: TestResult, tool_results_dir: Path):
        severity = self.config.get("severity", "HIGH,CRITICAL")
        ignore_unfixed = self.config.get("ignore_unfixed", True)
        output_format = "json"
        report_file = tool_results_dir / "trivy_report.json"

        for image_target in self.config.get("image_targets", []):
            logger.info(f"Scanning image with Trivy: {image_target}")
            cmd = [
                self.tool_path,
                "image",
                "--format", output_format,
                "--output", str(report_file),
                "--severity", severity,
            ]
            if ignore_unfixed:
                cmd.append("--ignore-unfixed")
            cmd.append(image_target)

            # Run Trivy, allow non-zero exit code if vulnerabilities are found
            returncode, stdout, stderr = self._run_command(cmd, result.raw_output_file)

            # Trivy exits with 1 if vulnerabilities are found, which is expected.
            # Only fail if the exit code is something else or the report is missing.
            if returncode > 1:
                 result.fail(f"Trivy scan failed for {image_target} with exit code {returncode}. Check raw output.")
                 continue
            if not report_file.exists():
                 result.fail(f"Trivy report file not found for {image_target}.")
                 continue

            # Parse Trivy JSON report
            try:
                with open(report_file, 'r') as f:
                    trivy_data = json.load(f)

                if isinstance(trivy_data, list): # Trivy >= 0.21.0 wraps results in a list
                    scan_results = trivy_data[0] if trivy_data else {}
                else: # Older versions
                    scan_results = trivy_data

                for vuln in scan_results.get('Vulnerabilities', []):
                    finding = SecurityFinding(
                        tool=self.name,
                        finding_id=vuln.get('VulnerabilityID'),
                        description=f"{vuln.get('PkgName')}@{vuln.get('InstalledVersion')} - {vuln.get('Title', 'N/A')}",
                        severity=vuln.get('Severity', 'unknown').lower(),
                        target=f"{image_target} ({vuln.get('PkgName')})",
                        details={
                            "package": vuln.get('PkgName'),
                            "installed_version": vuln.get('InstalledVersion'),
                            "fixed_version": vuln.get('FixedVersion', 'N/A'),
                            "cvss": vuln.get('CVSS'),
                            "references": vuln.get('References', []),
                        },
                        remediation=f"Update {vuln.get('PkgName')} to version {vuln.get('FixedVersion')}" if vuln.get('FixedVersion') else "No fix available"
                    )
                    result.add_finding(finding)
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                logger.error(f"Failed to parse Trivy report {report_file}: {e}")
                result.fail(f"Failed to parse Trivy report for {image_target}")
            finally:
                # Clean up report file after parsing to save space? Optional.
                # report_file.unlink()
                pass


class KubeBenchRunner(SecurityTestRunner):
    def _execute_test(self, result: TestResult, tool_results_dir: Path):
        targets = self.config.get("targets", ["master", "node"])
        version_arg = ["--version", self.config["version"]] if "version" in self.config else []
        output_format = "json"
        report_file = tool_results_dir / "kube_bench_report.json"

        cmd = [
            self.tool_path,
            *targets,
            "--json",
            *version_arg
        ]

        # kube-bench needs to run inside the cluster or have access to kubeconfig
        # Assuming it's run where it has cluster access.
        # It outputs JSON directly to stdout.
        returncode, stdout, stderr = self._run_command(cmd, result.raw_output_file)

        if returncode != 0:
            result.fail(f"kube-bench execution failed. Check raw output.")
            return

        # Save JSON output to file
        with open(report_file, "w") as f:
            f.write(stdout)

        # Parse kube-bench JSON output
        try:
            kube_bench_data = json.loads(stdout)
            for control in kube_bench_data.get('Controls', []):
                for test in control.get('tests', []):
                    for result_item in test.get('results', []):
                        if result_item.get('status') == 'FAIL':
                            severity_map = {"INFO": "low", "WARN": "medium", "PASS": "none", "FAIL": "high"}
                            finding = SecurityFinding(
                                tool=self.name,
                                finding_id=result_item.get('test_number'),
                                description=result_item.get('test_desc'),
                                severity=severity_map.get(result_item.get('status'), 'medium'),
                                target=f"Kubernetes {' '.join(targets)}",
                                details={
                                    "control_id": control.get('id'),
                                    "control_text": control.get('text'),
                                    "scored": result_item.get('scored'),
                                    "reason": result_item.get('reason'),
                                },
                                remediation=result_item.get('remediation')
                            )
                            result.add_finding(finding)
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"Failed to parse kube-bench report: {e}")
            result.fail("Failed to parse kube-bench JSON output")


class CustomAuditRunner(SecurityTestRunner):
    def _execute_test(self, result: TestResult, tool_results_dir: Path):
        scripts_dir = Path(self.config.get("scripts_dir"))
        if not scripts_dir.is_dir():
            logger.warning(f"Custom audit scripts directory not found: {scripts_dir}")
            result.complete("skipped")
            return

        for script_path in scripts_dir.glob("*.sh"): # Assuming shell scripts for now
            if os.access(script_path, os.X_OK):
                logger.info(f"Running custom audit script: {script_path.name}")
                script_output_file = tool_results_dir / f"{script_path.stem}_output.txt"
                returncode, stdout, stderr = self._run_command([str(script_path)], str(script_output_file))

                if returncode != 0:
                    logger.warning(f"Custom audit script {script_path.name} failed with code {returncode}")
                    # Assume script outputs findings in a specific format (e.g., JSON lines)
                    # Or parse stdout/stderr based on convention
                    # For simplicity, let's just log the failure for now
                    finding = SecurityFinding(
                        tool=self.name,
                        finding_id=f"custom_{script_path.stem}_failed",
                        description=f"Custom audit script {script_path.name} failed",
                        severity="medium",
                        target="System/Configuration",
                        details={"script": str(script_path), "returncode": returncode, "stderr": stderr},
                        remediation="Check the script and its output file."
                    )
                    result.add_finding(finding)
                else:
                    # Example: Parse JSON output if script produces it
                    try:
                        findings_data = json.loads(stdout)
                        if isinstance(findings_data, list):
                            for item in findings_data:
                                finding = SecurityFinding(
                                    tool=f"{self.name}_{script_path.stem}",
                                    finding_id=item.get("id", uuid.uuid4().hex[:8]),
                                    description=item.get("description", "N/A"),
                                    severity=item.get("severity", "medium").lower(),
                                    target=item.get("target", "System/Configuration"),
                                    details=item.get("details", {}),
                                    remediation=item.get("remediation")
                                )
                                result.add_finding(finding)
                    except json.JSONDecodeError:
                        # If not JSON, maybe parse line by line based on a convention
                        logger.debug(f"Custom script {script_path.name} did not output valid JSON.")
                        pass # Handle other formats if needed
            else:
                logger.warning(f"Custom audit script {script_path.name} is not executable, skipping.")


# --- Framework Core ---

class SecurityTestingFramework:
    """Main class for orchestrating security tests"""
    def __init__(self, config_path: Optional[str] = None):
        self.config = DEFAULT_CONFIG.copy()
        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    user_config = json.load(f)
                    self._merge_configs(self.config, user_config)
                logger.info(f"Loaded configuration from {config_path}")
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Error loading config file {config_path}: {e}")

        self.results_dir = Path(self.config["general"]["results_dir"])
        self.reports_dir = Path(self.config["reporting"]["output_dir"])
        self._init_dirs()

        self.runners: List[SecurityTestRunner] = self._initialize_runners()

    def _merge_configs(self, base: Dict, update: Dict) -> None:
        """Recursively merge configuration dictionaries"""
        for key, value in update.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._merge_configs(base[key], value)
            else:
                base[key] = value

    def _init_dirs(self) -> None:
        """Initialize results and reports directories"""
        self.results_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def _initialize_runners(self) -> List[SecurityTestRunner]:
        """Initialize all configured test runners"""
        runners = []
        tool_configs = self.config.get("tools", {})

        runner_map = {
            "zap": ZapRunner,
            "trivy": TrivyRunner,
            "kube-bench": KubeBenchRunner,
            "custom_audit": CustomAuditRunner,
            # Add other runners like NiktoRunner, GrypeRunner, OpenScapRunner here
        }

        for name, config in tool_configs.items():
            if name in runner_map:
                runner_class = runner_map[name]
                runners.append(runner_class(name, config, self.results_dir))
            else:
                logger.warning(f"No runner found for configured tool: {name}")

        return runners

    def run_all_tests(self) -> List[TestResult]:
        """Run all enabled security tests"""
        all_results: List[TestResult] = []
        logger.info("Starting security test suite run")

        for runner in self.runners:
            if runner.is_enabled():
                result = runner.run()
                all_results.append(result)
            else:
                logger.debug(f"Skipping disabled runner: {runner.name}")

        logger.info("Finished security test suite run")
        return all_results

    def generate_reports(self, results: List[TestResult]) -> List[str]:
        """Generate reports from test results"""
        report_files = []
        report_formats = self.config["reporting"]["formats"]
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        report_basename = f"security_report_{timestamp}"

        all_findings = [finding for result in results for finding in result.findings]
        summary_data = {
            "run_timestamp": timestamp,
            "total_tests": len(results),
            "tests_run": [r.to_dict() for r in results],
            "total_findings": len(all_findings),
            "findings_by_severity": {
                "critical": sum(1 for f in all_findings if f.severity == 'critical'),
                "high": sum(1 for f in all_findings if f.severity == 'high'),
                "medium": sum(1 for f in all_findings if f.severity == 'medium'),
                "low": sum(1 for f in all_findings if f.severity == 'low'),
            },
            "all_findings": [f.to_dict() for f in all_findings]
        }

        if "json" in report_formats:
            json_report_path = self.reports_dir / f"{report_basename}.json"
            try:
                with open(json_report_path, "w") as f:
                    json.dump(summary_data, f, indent=2)
                report_files.append(str(json_report_path))
                logger.info(f"Generated JSON report: {json_report_path}")
            except IOError as e:
                logger.error(f"Failed to write JSON report: {e}")

        if "html" in report_formats:
            html_report_path = self.reports_dir / f"{report_basename}.html"
            try:
                # Basic HTML report generation
                html_content = self._generate_html_report(summary_data)
                with open(html_report_path, "w") as f:
                    f.write(html_content)
                report_files.append(str(html_report_path))
                logger.info(f"Generated HTML report: {html_report_path}")
            except IOError as e:
                logger.error(f"Failed to write HTML report: {e}")

        return report_files

    def _generate_html_report(self, data: Dict[str, Any]) -> str:
        """Generates a simple HTML report"""
        # Basic styling
        html = """
<!DOCTYPE html>
<html>
<head>
<title>Security Test Report</title>
<style>
  body { font-family: sans-serif; margin: 20px; }
  h1, h2, h3 { color: #333; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background-color: #f2f2f2; }
  .severity-critical { color: #dc3545; font-weight: bold; }
  .severity-high { color: #ff4500; font-weight: bold; }
  .severity-medium { color: #ffc107; }
  .severity-low { color: #17a2b8; }
  .status-failed { color: #dc3545; }
  .status-completed { color: #28a745; }
  pre { background-color: #eee; padding: 10px; border-radius: 5px; overflow-x: auto; }
</style>
</head>
<body>
"""
        html += f"<h1>Security Test Report - {data['run_timestamp']}</h1>"

        # Summary
        html += "<h2>Summary</h2>"
        html += f"<p>Total Tests Run: {data['total_tests']}</p>"
        html += f"<p>Total Findings: {data['total_findings']}</p>"
        html += "<ul>"
        for severity, count in data['findings_by_severity'].items():
            html += f"<li><span class='severity-{severity}'>{severity.capitalize()}: {count}</span></li>"
        html += "</ul>"

        # Test Run Details
        html += "<h2>Test Run Details</h2>"
        html += "<table><tr><th>Tool</th><th>Status</th><th>Start Time</th><th>End Time</th><th>Findings</th><th>Error</th></tr>"
        for test in data['tests_run']:
            status_class = f"status-{test['status']}" if test['status'] in ['completed', 'failed'] else ""
            html += f"<tr><td>{test['tool_name']}</td><td class='{status_class}'>{test['status']}</td><td>{test['start_time']}</td><td>{test.get('end_time', 'N/A')}</td><td>{test['findings_count']}</td><td>{test.get('error_message') or ''}</td></tr>"
        html += "</table>"

        # Findings Details
        html += "<h2>Findings Details</h2>"
        if data['all_findings']:
            html += "<table><tr><th>Severity</th><th>Tool</th><th>Description</th><th>Target</th><th>Details</th><th>Remediation</th></tr>"
            # Sort findings by severity
            sorted_findings = sorted(data['all_findings'], key=lambda x: SEVERITY_MAP.get(x['severity'], 0), reverse=True)
            for finding in sorted_findings:
                details_str = json.dumps(finding.get('details', {}), indent=2)
                remediation_str = finding.get('remediation') or 'N/A'
                html += f"""
<tr>
  <td class='severity-{finding['severity']}'>{finding['severity'].capitalize()}</td>
  <td>{finding['tool']}</td>
  <td>{finding['description']}</td>
  <td>{finding['target']}</td>
  <td><pre>{details_str}</pre></td>
  <td><pre>{remediation_str}</pre></td>
</tr>
"""
            html += "</table>"
        else:
            html += "<p>No findings reported.</p>"

        html += "</body></html>"
        return html

    def send_alerts(self, results: List[TestResult]) -> None:
        """Send alerts based on findings"""
        alert_threshold_str = self.config["general"]["alert_severity_threshold"]
        alert_threshold = SEVERITY_MAP.get(alert_threshold_str, 2) # Default to medium

        critical_findings = []
        for result in results:
            for finding in result.findings:
                if SEVERITY_MAP.get(finding.severity, 0) >= alert_threshold:
                    critical_findings.append(finding)

        if not critical_findings:
            logger.info("No findings met the alert threshold.")
            return

        logger.warning(f"Found {len(critical_findings)} findings meeting alert threshold ({alert_threshold_str})")

        subject = f"[ALERT] Security Test Findings ({len(critical_findings)} issues)"
        message_body = f"Security testing found {len(critical_findings)} issues meeting or exceeding the '{alert_threshold_str}' severity threshold:\n\n"
        for finding in critical_findings:
            message_body += f"- [{finding.severity.upper()}] {finding.tool}: {finding.description} (Target: {finding.target})\n"
        message_body += "\nPlease review the full report for details."

        # Send Email
        email_config = self.config["alerting"].get("email", {})
        if email_config.get("enabled"):
            self._send_email_alert(subject, message_body, email_config)

        # Send Slack
        slack_config = self.config["alerting"].get("slack", {})
        if slack_config.get("enabled") and slack_config.get("webhook_url"):
            self._send_slack_alert(subject, message_body, slack_config)

    def _send_email_alert(self, subject: str, message: str, config: Dict[str, Any]):
        """Sends an email alert."""
        try:
            import smtplib
            from email.mime.text import MIMEText

            msg = MIMEText(message)
            msg['Subject'] = subject
            msg['From'] = config["sender"]
            msg['To'] = ", ".join(config["recipients"])

            with smtplib.SMTP(config["smtp_server"], config["smtp_port"]) as smtp:
                smtp.send_message(msg)
            logger.info(f"Sent email alert to {config['recipients']}")
        except Exception as e:
            logger.error(f"Failed to send email alert: {e}", exc_info=True)

    def _send_slack_alert(self, subject: str, message: str, config: Dict[str, Any]):
        """Sends a Slack alert."""
        try:
            payload = {
                "attachments": [
                    {
                        "color": "danger", # Use danger color for alerts
                        "title": subject,
                        "text": message,
                        "footer": "Homelab Security Testing",
                        "ts": int(time.time())
                    }
                ]
            }
            webhook_url = config["webhook_url"]
            subprocess.run(
                ["curl", "-s", "-X", "POST",
                 "--data-urlencode", f"payload={json.dumps(payload)}",
                 webhook_url],
                check=True, capture_output=True
            )
            logger.info("Sent Slack alert")
        except Exception as e:
            logger.error(f"Failed to send Slack alert: {e}", exc_info=True)

    def cleanup_old_results(self) -> None:
        """Remove old result directories"""
        max_age_days = self.config["general"]["max_report_age_days"]
        cutoff_time = time.time() - (max_age_days * 86400)
        cleaned_count = 0

        for item in self.results_dir.iterdir():
            if item.is_dir():
                try:
                    # Check directory modification time or parse timestamp from name
                    dir_time = item.stat().st_mtime
                    if dir_time < cutoff_time:
                        shutil.rmtree(item)
                        logger.debug(f"Removed old results directory: {item}")
                        cleaned_count += 1
                except Exception as e:
                    logger.error(f"Failed to clean up results directory {item}: {e}")

        logger.info(f"Cleaned up {cleaned_count} old result sets.")


def main():
    parser = argparse.ArgumentParser(description="Homelab Security Testing Framework")
    parser.add_argument("--config", help="Path to configuration file")
    parser.add_argument("--run", action="store_true", help="Run all enabled tests")
    parser.add_argument("--report", action="store_true", help="Generate reports from latest results (Not implemented yet)")
    parser.add_argument("--alert", action="store_true", help="Send alerts based on latest results (Not implemented yet)")
    parser.add_argument("--cleanup", action="store_true", help="Clean up old results and reports")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument("--list-tools", action="store_true", help="List configured tools and their status")

    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    framework = SecurityTestingFramework(config_path=args.config)

    if args.list_tools:
        print("Configured Security Test Tools:")
        for runner in framework.runners:
            status = "enabled" if runner.is_enabled() else "disabled"
            tool_found = runner.check_tool_availability() if runner.is_enabled() else "N/A"
            print(f"  - {runner.name}: {status} (Tool Found: {tool_found})")
        sys.exit(0)

    if args.run:
        results = framework.run_all_tests()
        report_files = framework.generate_reports(results)
        print(f"Reports generated: {', '.join(report_files)}")
        framework.send_alerts(results)

    if args.cleanup:
        framework.cleanup_old_results()
        # Add cleanup for reports directory too if needed

    if not (args.run or args.cleanup or args.list_tools):
         parser.print_help()
         print("\nSpecify an action like --run or --cleanup.")


if __name__ == "__main__":
    main()
