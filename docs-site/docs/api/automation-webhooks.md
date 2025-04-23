# 🤖 Automation Webhooks

Webhooks exposed by automation platforms like n8n and Home Assistant to trigger workflows or actions from external events or other services.

---

## 1. n8n Webhooks ⚡

n8n allows creating custom webhooks to trigger workflows.

*   **URL Structure:** Typically `http://<n8n-host>/webhook/<workflow-path>` or `http://<n8n-host>/webhook-test/<workflow-path>` for testing.
*   **Authentication:** Configured per workflow (Basic Auth, Header Auth, or none if relying on network security). 🔐
*   **Method:** Usually `POST`, but configurable within n8n.
*   **Request/Response:** Defined entirely by the specific n8n workflow design.

**Example: Trigger `daily-report` Workflow**

*   **Webhook URL:** `http://n8n.automation.svc.cluster.local/webhook/reports/daily`
*   **Method:** `POST`
*   **Authentication:** Requires `X-Trigger-Token` header with value from Vault (`secret/homelab/n8n/triggers`).
*   **Request Body (Optional):** Can accept parameters to customize the report.
    ```json
    {
      "recipient": "admin@homelab.local",
      "include_debug": false
    }
    ```
*   **Response Body:** Defined by the workflow (e.g., confirmation message).
    ```json
    { "message": "Daily report generation triggered." }
    ```
*   **Example `curl`:**
    ```bash
    TRIGGER_TOKEN="your-n8n-trigger-token"
    N8N_URL="http://n8n.automation.svc.cluster.local/webhook/reports/daily"

    curl -X POST "$N8N_URL" \
         -H "Content-Type: application/json" \
         -H "X-Trigger-Token: $TRIGGER_TOKEN" \
         -d '{ "recipient": "admin@homelab.local" }'
    ```

---

## 2. Home Assistant Webhooks 🏠

Home Assistant can receive webhooks to trigger automations.

*   **URL Structure:** `http://<home-assistant-host>/api/webhook/<webhook_id>`
*   **Authentication:** Relies on the secrecy of the `<webhook_id>`. Generate unique IDs per integration. 🤫
*   **Method:** Usually `POST`, but can also support `PUT`. `GET` is supported for simple triggers without data.
*   **Request Body:** Can be JSON or form data, processed by the automation trigger configuration.

**Example: Notify on Security Alert**

*   **Webhook ID:** `external_security_alert_trigger` (configured in HA Automations UI)
*   **Webhook URL:** `http://homeassistant.home.svc.cluster.local:8123/api/webhook/external_security_alert_trigger`
*   **Method:** `POST`
*   **Authentication:** None (relies on webhook ID secrecy and network access).
*   **Request Body:** JSON payload describing the alert.
    ```json
    {
      "source_system": "Firewall",
      "severity": "High",
      "message": "Potential intrusion detected from 1.2.3.4"
    }
    ```
*   **Response Body:** Home Assistant typically returns `200 OK` immediately if the webhook ID is valid, regardless of automation execution success.
*   **Example `curl`:**
    ```bash
    HA_URL="http://homeassistant.home.svc.cluster.local:8123/api/webhook/external_security_alert_trigger"

    curl -X POST "$HA_URL" \
         -H "Content-Type: application/json" \
         -d '{ "source_system": "Firewall", "severity": "High", "message": "Potential intrusion detected from 1.2.3.4" }'
    ```

*(Diagram Placeholder: External Service/Script -> Webhook URL (n8n/HA) -> Automation Trigger)*

---

*(Add other automation webhooks here)*
