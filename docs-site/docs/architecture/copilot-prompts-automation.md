# GitHub Copilot Prompts for Homelab Automation & Integration

This guide provides example prompts for GitHub Copilot to assist with common automation and integration tasks in a homelab environment, focusing on tools like n8n, Home Assistant, webhooks, and custom scripts.

## 1. n8n Custom Nodes and Workflows

Prompts for developing custom nodes and generating workflow logic snippets for n8n.

1.  **Generate the boilerplate for a basic n8n regular node:**
    *   **Prompt:** `// Generate the TypeScript boilerplate for a basic n8n regular node named 'MyCustomService' with one operation 'get' and one string parameter 'itemId'.`
    *   **Explanation:** Creates the fundamental structure (`*.node.ts` file) for a new n8n node, including class definition, properties, description, and execute method outline.
    *   **Customization:** Change the node name (`MyCustomService`), display name, operation names (`get`), parameter names (`itemId`), types, and descriptions.

2.  **Add credential fields to an n8n node:**
    *   **Prompt:** `// Add credential fields to the n8n node description for credentials named 'myApiCredentials' requiring 'apiKey' and 'apiSecret' fields.`
    *   **Explanation:** Modifies the node description to specify the required credentials, allowing users to select pre-configured credentials in the n8n UI.
    *   **Customization:** Change the credential name (`myApiCredentials`) and the required field names (`apiKey`, `apiSecret`). Ensure corresponding credential types are defined separately.

3.  **Implement the execute method for an API call in an n8n node:**
    *   **Prompt:** `// Implement the execute method for the 'get' operation in the 'MyCustomService' n8n node. Retrieve the 'apiKey' from credentials, get the 'itemId' parameter, make a GET request to 'https://api.example.com/items/{itemId}' using the 'apiKey' in an 'X-API-Key' header, and return the JSON response.`
    *   **Explanation:** Fills in the core logic of the node's operation, handling credential retrieval, parameter access, making an external API call using `this.helpers.request`, and formatting the output.
    *   **Customization:** Adjust the API endpoint URL, HTTP method, header names, parameter handling, and response processing.

4.  **Generate n8n workflow JSON for a simple webhook trigger and HTTP request:**
    *   **Prompt:** `// Generate n8n workflow JSON: Trigger with a webhook, then use an HTTP Request node to POST the incoming webhook body to 'http://localhost:5000/data'.`
    *   **Explanation:** Creates the JSON representation of a simple n8n workflow, useful for programmatic workflow creation or understanding the structure.
    *   **Customization:** Change the trigger type, webhook path/method, HTTP Request node URL, method, authentication, and body content (using n8n expressions).

5.  **Create an n8n Function node snippet to transform data:**
    *   **Prompt:** `// JavaScript code for an n8n Function node: Take an input item with 'firstName' and 'lastName', combine them into a 'fullName', and add a 'processedAt' timestamp.`
    *   **Explanation:** Generates JavaScript code to be pasted into an n8n Function or Function Item node for custom data manipulation.
    *   **Customization:** Modify the input properties, transformation logic, and output structure based on the preceding node's data.

6.  **Add error handling within an n8n node's execute method:**
    *   **Prompt:** `// Add try...catch block to the 'MyCustomService' node's execute method to handle potential API request errors and throw an n8n NodeApiError.`
    *   **Explanation:** Implements basic error handling to catch issues during the API call and report them correctly within the n8n execution flow.
    *   **Customization:** Add more specific error checking based on status codes or response content.

## 2. Home Assistant Integrations and Automations

Prompts for creating custom components, Lovelace cards, and automation YAML for Home Assistant.

1.  **Generate boilerplate for a Home Assistant custom sensor integration:**
    *   **Prompt:** `// Python boilerplate for a Home Assistant custom sensor integration named 'homelab_monitor'. Create a sensor entity 'sensor.homelab_cpu_usage'.`
    *   **Explanation:** Creates the basic directory structure (`custom_components/homelab_monitor/`) and files (`__init__.py`, `manifest.json`, `sensor.py`) for a new integration that provides sensor entities.
    *   **Customization:** Change the domain name (`homelab_monitor`), entity IDs, and the logic within `sensor.py` to fetch actual data.

2.  **Define the `manifest.json` for a Home Assistant custom integration:**
    *   **Prompt:** `// Generate manifest.json for a Home Assistant custom integration 'homelab_monitor' depending on the 'http' integration, with code owner '@my_github_user', and documentation link.`
    *   **Explanation:** Creates the metadata file required by Home Assistant to load and manage the custom integration.
    *   **Customization:** Update domain, name, dependencies, code owner, documentation/issue tracker links, and version.

3.  **Create a Home Assistant automation YAML triggered by a state change:**
    *   **Prompt:** `// Home Assistant automation YAML: Trigger when 'sensor.office_temperature' goes above 25 degrees Celsius for 5 minutes. Action: call service 'notify.mobile_app_my_phone' with a message.`
    *   **Explanation:** Generates YAML configuration for an automation rule within Home Assistant.
    *   **Customization:** Change the trigger entity ID, threshold, `for` duration, action service call, and message content.

4.  **Generate a Home Assistant automation using a time pattern trigger:**
    *   **Prompt:** `// Home Assistant automation YAML: Trigger every weekday at 8:00 AM. Action: turn on 'light.kitchen_main'.`
    *   **Explanation:** Creates an automation based on a specific time schedule.
    *   **Customization:** Modify the `trigger.platform` (`time_pattern`, `time`), time/pattern, and the action(s).

5.  **Create a Home Assistant template sensor YAML:**
    *   **Prompt:** `// Home Assistant template sensor YAML configuration: Create a sensor 'sensor.combined_power' that sums the states of 'sensor.plug_a_power' and 'sensor.plug_b_power'. Set unit_of_measurement to 'W'.`
    *   **Explanation:** Defines a new sensor whose state is derived from the states of other entities using Jinja2 templating.
    *   **Customization:** Change the sensor name, state template logic (Jinja2), unit of measurement, and other sensor properties.

6.  **Generate a basic Lovelace custom card JavaScript boilerplate:**
    *   **Prompt:** `// JavaScript boilerplate for a basic Home Assistant Lovelace custom card named 'homelab-status-card'. Include setConfig and set hass methods.`
    *   **Explanation:** Creates the starting structure for a custom UI element in the Home Assistant frontend.
    *   **Customization:** Implement the card's HTML structure (`getCardSize`, `render` or similar methods) and logic to display data based on the `hass` object and configuration.

7.  **Write a Python script using `hass-client` to interact with Home Assistant API:**
    *   **Prompt:** `// Python script using hass-client websocket library to connect to Home Assistant at 'http://homeassistant.local:8123' with a long-lived access token, subscribe to state changes of 'binary_sensor.doorbell', and print changes.`
    *   **Explanation:** Creates an external script to interact with the Home Assistant WebSocket API for real-time events or service calls.
    *   **Customization:** Change the HA URL, access token source, entity IDs to subscribe to, and the event handling logic.

## 3. Webhook Handlers and API Integrations

Prompts for creating simple web servers or functions to handle incoming webhooks or interact with external APIs.

1.  **Create a basic Python Flask webhook handler:**
    *   **Prompt:** `// Python Flask app to listen for POST requests on '/webhook/github'. Verify the X-Hub-Signature-256 header using a secret stored in an environment variable 'GITHUB_WEBHOOK_SECRET'. Print the JSON payload.`
    *   **Explanation:** Sets up a simple web server using Flask to receive and validate incoming webhooks (e.g., from GitHub).
    *   **Customization:** Change the route, HTTP method, validation logic (signature header, secret source), and payload processing.

2.  **Create a basic Node.js Express webhook handler:**
    *   **Prompt:** `// Node.js Express app to listen for POST requests on '/webhook/stripe'. Use express.raw body parser for signature verification. Verify the 'Stripe-Signature' header using the stripe library and a secret from 'STRIPE_WEBHOOK_SECRET' env var. Log the event type.`
    *   **Explanation:** Similar to the Flask example but using Node.js/Express, including specific middleware for raw body access needed by some verification libraries (like Stripe's).
    *   **Customization:** Change route, validation library/logic, secret source, and event processing.

3.  **Write a Python script using `requests` to call an external API:**
    *   **Prompt:** `// Python script using the requests library to make a GET request to 'https://api.openweathermap.org/data/2.5/weather' with query parameters 'q=London,uk' and 'appid' (from 'OPENWEATHER_API_KEY' env var). Print the temperature from the JSON response.`
    *   **Explanation:** Simple script to fetch data from a REST API.
    *   **Customization:** Change the URL, HTTP method, query parameters, headers, authentication method, and response parsing logic.

4.  **Generate a Python function to send a message via a Discord webhook:**
    *   **Prompt:** `// Python function 'send_discord_message' that takes a message string and sends it as a POST request to a Discord webhook URL stored in the 'DISCORD_WEBHOOK_URL' environment variable.`
    *   **Explanation:** Creates a reusable function for sending notifications to Discord.
    *   **Customization:** Modify the function signature, webhook URL source, and payload structure (e.g., add embeds).

5.  **Create a simple API endpoint using FastAPI:**
    *   **Prompt:** `// Python FastAPI app with a GET endpoint '/status' that returns a JSON response {'status': 'ok', 'version': '1.0'}.`
    *   **Explanation:** Sets up a minimal API using the modern FastAPI framework.
    *   **Customization:** Add more routes, request/response models (using Pydantic), dependencies, etc.

## 4. Scheduled Tasks and Maintenance Scripts

Prompts for creating scripts typically run via cron or systemd timers for maintenance or periodic actions.

1.  **Generate a shell script to prune old Docker images and volumes:**
    *   **Prompt:** `// Shell script to run 'docker image prune -af' and 'docker volume prune -f'. Add logging to a file /var/log/docker_prune.log.`
    *   **Explanation:** Basic maintenance script for cleaning up unused Docker resources.
    *   **Customization:** Adjust pruning filters (e.g., `docker image prune -af --filter "until=24h"`), logging location, and add error handling.

2.  **Create a Python script to back up a directory to cloud storage (conceptual):**
    *   **Prompt:** `// Python script using a hypothetical 'cloud_storage_client' library to compress a local directory '/data/important' into a timestamped zip file and upload it to a bucket 'my-homelab-backups'. Delete local backups older than 7 days.`
    *   **Explanation:** Outlines the logic for a backup script. You would replace the hypothetical library with a specific one (e.g., `boto3` for S3, `google-cloud-storage` for GCS).
    *   **Customization:** Specify the actual source directory, backup destination (bucket, path), compression format, retention policy, and implement using the correct cloud storage SDK.

3.  **Generate a systemd timer unit file to run a script daily:**
    *   **Prompt:** `// Generate a systemd timer unit file 'mytask.timer' to run 'mytask.service' daily at 3:00 AM. Make it persistent.`
    *   **Explanation:** Creates the `.timer` file used by systemd to schedule jobs. Requires a corresponding `.service` file.
    *   **Customization:** Change the `OnCalendar` specification (see `systemd.time` man page), `Unit` name, and persistence setting.

4.  **Generate a systemd service unit file to execute a script:**
    *   **Prompt:** `// Generate a systemd service unit file 'mytask.service' to execute the script '/usr/local/bin/my_maintenance_script.sh' as the user 'homelab_svc'.`
    *   **Explanation:** Creates the `.service` file defining the command to be run by the timer (or manually).
    *   **Customization:** Change the `Description`, `ExecStart` command path, `User`, and add other directives like `WorkingDirectory` or environment variables.

5.  **Write a Python script to check website availability:**
    *   **Prompt:** `// Python script that takes a list of URLs, makes a HEAD request to each, checks for a 2xx status code, and logs any failures to stderr.`
    *   **Explanation:** Simple monitoring script to check if web services are responding.
    *   **Customization:** Provide the list of URLs, adjust timeout values, change request method (e.g., GET), and modify logging/alerting logic.

## 5. Cross-Service Integration Patterns

Prompts illustrating how to connect different services within the homelab.

1.  **Webhook handler (Flask) that triggers an n8n workflow:**
    *   **Prompt:** `// Python Flask endpoint '/trigger/n8n/workflow1' that receives a POST request and forwards its JSON payload to an n8n webhook URL stored in 'N8N_WORKFLOW1_URL' env var.`
    *   **Explanation:** Acts as a simple proxy or adapter to trigger an n8n workflow from a service that might not directly support calling arbitrary webhooks easily.
    *   **Customization:** Change the endpoint route, n8n webhook URL source, add authentication/validation if needed.

2.  **n8n workflow that updates a Home Assistant entity:**
    *   **Prompt:** `// n8n Function node JavaScript: Get temperature from input data. Use the 'Home Assistant' node API (assuming node is connected) to call service 'input_number.set_value' on entity 'input_number.external_temp' with the temperature value.`
    *   **Explanation:** Shows how to use the n8n Home Assistant node (or potentially an HTTP Request node calling the HA API directly) to push data *into* Home Assistant. Requires a configured Home Assistant node in n8n.
    *   **Customization:** Change the service to call, entity ID, and data payload according to the Home Assistant service definition.

3.  **Home Assistant automation that sends data to an MQTT broker:**
    *   **Prompt:** `// Home Assistant automation YAML: Trigger when 'sensor.room_humidity' changes. Action: call 'mqtt.publish' service with topic 'homelab/sensors/room/humidity' and payload template containing the sensor's new state.`
    *   **Explanation:** Pushes state changes from Home Assistant to an MQTT broker, allowing other services (Node-RED, custom scripts, IoT devices) to react. Requires the MQTT integration to be configured in HA.
    *   **Customization:** Change the trigger entity, MQTT topic, and payload template.

4.  **Python script consuming MQTT messages and calling a custom API:**
    *   **Prompt:** `// Python script using paho-mqtt client: Connect to MQTT broker at 'mqtt.local', subscribe to topic 'homelab/actions/#'. On receiving a message, call a POST request to a local API endpoint 'http://localhost:5001/action' with the message payload.`
    *   **Explanation:** Listens for messages on MQTT (potentially published by Home Assistant or other services) and triggers an action via a custom API call.
    *   **Customization:** Change MQTT broker address, topic, API endpoint URL, HTTP method, and payload processing logic.

5.  **n8n workflow triggered by MQTT, filtering data, and sending Discord notification:**
    *   **Prompt:** `// n8n workflow description: Trigger via MQTT node listening to 'homelab/alerts/#'. Use IF node to check if payload JSON contains 'level' == 'critical'. If true, use Discord node to send formatted message from payload to a specific channel.`
    *   **Explanation:** Demonstrates a multi-step integration: reacting to an MQTT event, applying conditional logic, and performing a notification action.
    *   **Customization:** Change MQTT topic, IF node condition logic, Discord node configuration (webhook/bot token, channel), and message formatting.
