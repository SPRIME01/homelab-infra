# ✨ Custom AI Service APIs

This section documents APIs for custom AI applications developed specifically for this homelab.

*(Add documentation for each custom service below)*

---

## Example Service: Image Tagger 🖼️🏷️

A service that receives an image URL and returns relevant tags using a custom model pipeline.

**Base URL (Internal):** `http://image-tagger.ai-custom.svc.cluster.local:5000`

### Endpoint: `/tag`

*   **Method:** `POST`
*   **Description:** Submits an image URL for tagging. 📸
*   **Authentication:** Requires API Key in `X-API-Key` header. Get key from Vault (`secret/homelab/api-keys`). 🔑
*   **Request Body:**
    ```json
    {
      "image_url": "https://example.com/image.jpg",
      "confidence_threshold": 0.7 // Optional: Minimum confidence for tags
    }
    ```
*   **Response Body (Success - 200 OK):**
    ```json
    {
      "image_url": "https://example.com/image.jpg",
      "tags": [
        {"tag": "cat", "confidence": 0.95},
        {"tag": "indoor", "confidence": 0.88},
        {"tag": "fluffy", "confidence": 0.72}
      ]
    }
    ```
*   **Response Body (Error - 400 Bad Request):**
    ```json
    {
      "error": "Invalid image_url provided"
    }
    ```
*   **Response Body (Error - 401 Unauthorized):**
    ```json
    {
      "error": "Invalid or missing API Key"
    }
    ```
*   **Example:**
    ```bash
    API_KEY="your-secret-api-key"
    IMAGE_URL="https://example.com/image.jpg"

    curl -X POST http://image-tagger.ai-custom.svc.cluster.local:5000/tag \
         -H "Content-Type: application/json" \
         -H "X-API-Key: $API_KEY" \
         -d '{ "image_url": "'"$IMAGE_URL"'", "confidence_threshold": 0.7 }'
    ```

*(Diagram Placeholder: Client -> API Gateway (Auth) -> Image Tagger Service -> Triton/Model -> Response)*

---

*(Add other custom AI service APIs here following a similar structure)*
