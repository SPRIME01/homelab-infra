# Runbook: Investigating and Resolving Alerts

This runbook provides a structured approach to investigating alerts generated by the monitoring system (Prometheus/Alertmanager).

## 1. Alert Triage

-   [ ] **Acknowledge:** Acknowledge the alert in Alertmanager or the notification channel to signal investigation is underway.
-   [ ] **Identify:** Determine the affected system, service, or component.
-   [ ] **Assess Severity:** Understand the potential impact based on the alert's severity level (e.g., Critical, Warning).
-   [ ] **Check for Duplicates/Related Alerts:** See if other alerts fired simultaneously, indicating a broader issue.

## 2. Initial Investigation (Use Alert Metadata)

-   [ ] **Review Alert Details:** Read the alert description, annotations, and labels carefully.
-   [ ] **Check Alert Source:** Note the specific metric and threshold that triggered the alert.
-   [ ] **Examine Timestamps:** Note when the alert started firing.

## 3. Gather Context (Dashboards and Logs)

-   [ ] **Consult Relevant Dashboards:**
    -   Open the Grafana dashboard linked in the alert (if available).
    -   Check the System Overview dashboard.
    -   Check the specific service dashboard (e.g., Kubernetes, RabbitMQ, application-specific).
    -   Look for correlating patterns around the time the alert fired (resource spikes, errors, latency increases).
-   [ ] **Check Logs:**
    -   Query logs (e.g., using Loki/Grafana Explore) for the affected component(s) around the time of the alert.
    -   Look for errors, warnings, or unusual activity.
    -   Filter logs based on relevant identifiers (pod name, node name, trace ID).

## 4. Hypothesis and Verification

-   [ ] **Formulate Hypothesis:** Based on the alert, dashboard data, and logs, form a hypothesis about the root cause.
    *   *Example: High CPU -> Check specific pod resource usage -> Check application logs for errors.*
    *   *Example: Disk Full -> Check node disk usage -> Identify large files/directories -> Check application writing data.*
    *   *Example: Service Down -> Check pod status -> Check pod logs -> Check dependencies (DB, MQ).*
-   [ ] **Test Hypothesis:** Use commands (`kubectl`, `ssh`, service-specific tools) or further log/metric analysis to confirm or refute the hypothesis.

## 5. Remediation

-   [ ] **Identify Fix:** Determine the appropriate action to resolve the issue.
    *   Restarting a pod/service.
    *   Scaling resources (CPU, memory, replicas).
    *   Clearing disk space.
    *   Rolling back a recent change.
    *   Applying a configuration fix.
    *   Fixing a bug in application code.
-   [ ] **Apply Fix:** Execute the remediation steps carefully.
-   [ ] **Verify Resolution:**
    *   Confirm the alert stops firing in Alertmanager.
    *   Check dashboards and metrics to ensure the condition has returned to normal.
    *   Perform functional checks on the affected service.

## 6. Post-Mortem / Follow-up (for significant issues)

-   [ ] **Document:** Record the alert, investigation steps, root cause, and resolution.
-   [ ] **Identify Prevention:** Determine if changes are needed to prevent recurrence (e.g., adjust alert thresholds, increase resources permanently, fix underlying bugs, improve monitoring).
-   [ ] **Update Runbooks/Documentation:** Improve documentation based on lessons learned.
-   [ ] **Create Follow-up Tasks:** Assign tasks for preventative measures if needed.
