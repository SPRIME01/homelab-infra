# 🛠️ Internal Utility APIs

Helper APIs for common internal tasks, potentially exposed by small custom services or scripts.

---

## Example: DNS Management API 🌐

A simple API to add/remove internal DNS records (e.g., in Pi-hole or CoreDNS via a custom plugin). **Use with extreme caution!**

**Base URL (Internal):** `http://dns-manager.infra.svc.cluster.local:9090`

### Endpoint: `/records`

*   **Method:** `POST`
*   **Description:** Add a new internal DNS record. ➕
*   **Authentication:** Requires Basic Auth (credentials stored in Vault `secret/homelab/dns-manager`). 🔒
*   **Request Body:**
    ```json
    {
      "hostname": "new-service.homelab.local",
      "ip_address": "192.168.1.150",
      "record_type": "A" // Optional, defaults to A
    }
    ```
*   **Response Body (Success - 201 Created):**
    ```json
    {
      "message": "Record created successfully",
      "record": {
        "hostname": "new-service.homelab.local",
        "ip_address": "192.168.1.150",
        "record_type": "A"
      }
    }
    ```
*   **Response Body (Error - 400 Bad Request):** Invalid input.
*   **Response Body (Error - 409 Conflict):** Record already exists.
*   **Example:**
    ```bash
    DNS_USER="admin"
    DNS_PASS="secretpass"
    DNS_URL="http://dns-manager.infra.svc.cluster.local:9090/records"

    curl -X POST "$DNS_URL" \
         -u "$DNS_USER:$DNS_PASS" \
         -H "Content-Type: application/json" \
         -d '{ "hostname": "new-service.homelab.local", "ip_address": "192.168.1.150" }'
    ```

### Endpoint: `/records/{hostname}`

*   **Method:** `DELETE`
*   **Description:** Remove an internal DNS record. ➖
*   **Authentication:** Requires Basic Auth (same as POST). 🔒
*   **Request:** None (hostname in URL)
*   **Response Body (Success - 204 No Content):** Record deleted.
*   **Response Body (Error - 404 Not Found):** Record does not exist.
*   **Example:**
    ```bash
    DNS_USER="admin"
    DNS_PASS="secretpass"
    HOSTNAME="new-service.homelab.local"
    DNS_URL="http://dns-manager.infra.svc.cluster.local:9090/records/$HOSTNAME"

    curl -X DELETE "$DNS_URL" -u "$DNS_USER:$DNS_PASS"
    ```

*(Diagram Placeholder: Script/Admin -> DNS Manager API -> CoreDNS/Pi-hole)*

---

*(Add other internal utility APIs here)*
