# 🔗 Data Integration Endpoints

APIs designed to facilitate data movement, transformation, and synchronization between different homelab services. Often implemented via n8n webhooks or custom microservices.

---

## Example: Ingest Sensor Data 🌡️💧

An endpoint (likely an n8n webhook) to receive sensor readings from IoT devices or Home Assistant and forward them to InfluxDB.

**Webhook URL:** `http://n8n.automation.svc.cluster.local/webhook/ingest-sensor-data` *(or external n8n URL)*

### Endpoint: `/webhook/ingest-sensor-data`

*   **Method:** `POST`
*   **Description:** Receives sensor data points and queues them for insertion into time-series database. 📈
*   **Authentication:** Uses n8n's built-in webhook authentication (e.g., Basic Auth configured in the workflow, or relies on network isolation). Check the specific n8n workflow settings. 🔐
*   **Request Body:** Flexible, but often expects a specific JSON structure.
    ```json
    // Example 1: Single reading
    {
      "device_id": "living-room-sensor",
      "measurement": "temperature",
      "value": 22.5,
      "timestamp": 1678886400 // Optional: Unix timestamp (seconds)
    }

    // Example 2: Multiple readings
    [
      {
        "device_id": "kitchen-sensor",
        "measurement": "humidity",
        "value": 55.2
      },
      {
        "device_id": "kitchen-sensor",
        "measurement": "pressure",
        "value": 1012.1
      }
    ]
    ```
*   **Response Body (Success - 200 OK):** Typically a simple confirmation.
    ```json
    {
      "message": "Data received successfully"
    }
    ```
*   **Response Body (Error - 400 Bad Request):**
    ```json
    {
      "error": "Invalid data format"
    }
    ```
*   **Example (using curl):**
    ```bash
    # Assuming Basic Auth configured in n8n workflow
    N8N_USER="user"
    N8N_PASS="pass"
    N8N_URL="http://n8n.automation.svc.cluster.local/webhook/ingest-sensor-data" # Or external URL

    curl -X POST "$N8N_URL" \
         -u "$N8N_USER:$N8N_PASS" \
         -H "Content-Type: application/json" \
         -d '{ "device_id": "living-room-sensor", "measurement": "temperature", "value": 22.5 }'
    ```

*(Diagram Placeholder: Sensor/Home Assistant -> n8n Webhook -> InfluxDB)*

---

*(Add other data integration APIs/Webhooks here)*
