# 🧠 Triton Inference Server API

Access deployed AI models via the Triton Inference Server. Triton exposes standard KServe v2 protocol endpoints.

**Base URL (Internal):** `http://triton-inference-server.ai-services.svc.cluster.local:8000` (HTTP) / `http://triton-inference-server.ai-services.svc.cluster.local:8001` (GRPC)

*(Note: External access might be configured via Ingress with a different URL)*

## Key Endpoints 🎯

### 1. Server Health (`/v2/health/live` and `/v2/health/ready`)

*   **Method:** `GET`
*   **Description:** Check if the server is running and ready to accept requests. Essential for health checks. ✅
*   **Authentication:** None typically required.
*   **Request:** None
*   **Response:** `200 OK` if healthy.
*   **Example:**
    ```bash
    curl http://<triton-host>:8000/v2/health/live
    curl http://<triton-host>:8000/v2/health/ready
    ```

### 2. Model Ready (`/v2/models/{model_name}/versions/{model_version}/ready`)

*   **Method:** `GET`
*   **Description:** Check if a specific model version is loaded and ready for inference. 🧐
*   **Authentication:** None typically required.
*   **Request:** None (model name/version in URL)
*   **Response:** `200 OK` if ready. `404 Not Found` otherwise.
*   **Example:**
    ```bash
    # Check readiness of version 1 of 'my-image-classifier' model
    curl http://<triton-host>:8000/v2/models/my-image-classifier/versions/1/ready
    ```

### 3. Model Metadata (`/v2/models/{model_name}/versions/{model_version}`)

*   **Method:** `GET`
*   **Description:** Get metadata about a model, including its inputs and outputs. 📝
*   **Authentication:** None typically required.
*   **Request:** None
*   **Response:** JSON describing model name, versions, platform, inputs, outputs.
    ```json
    {
      "name": "my-image-classifier",
      "versions": ["1"],
      "platform": "onnxruntime_onnx",
      "inputs": [
        { "name": "input_image", "datatype": "FP32", "shape": [ -1, 3, 224, 224 ] }
      ],
      "outputs": [
        { "name": "output_probabilities", "datatype": "FP32", "shape": [ -1, 1000 ] }
      ]
    }
    ```
*   **Example:**
    ```bash
    curl http://<triton-host>:8000/v2/models/my-image-classifier/versions/1
    ```

### 4. Model Inference (`/v2/models/{model_name}/versions/{model_version}/infer`)

*   **Method:** `POST`
*   **Description:** Send data to a model for inference. This is the core endpoint! ✨
*   **Authentication:** None typically required for internal access. May require auth if exposed externally.
*   **Request Body:** JSON following the KServe v2 inference protocol.
    ```json
    {
      "id": "optional-inference-id-123",
      "inputs": [
        {
          "name": "input_image", // Matches model metadata input name
          "shape": [ 1, 3, 224, 224 ], // Batch size 1, 3 channels, 224x224 pixels
          "datatype": "FP32",
          "data": [ ... flat list of image pixel data ... ]
        }
        // Add other inputs if the model requires them
      ],
      "outputs": [
        {
          "name": "output_probabilities" // Optional: Request specific outputs
        }
      ]
    }
    ```
*   **Response Body:** JSON with inference results.
    ```json
    {
      "id": "optional-inference-id-123",
      "model_name": "my-image-classifier",
      "model_version": "1",
      "outputs": [
        {
          "name": "output_probabilities",
          "shape": [ 1, 1000 ],
          "datatype": "FP32",
          "data": [ ... flat list of output probabilities ... ]
        }
      ]
    }
    ```
*   **Example:**
    ```bash
    # (Assuming request.json contains the valid request body)
    curl -X POST http://<triton-host>:8000/v2/models/my-image-classifier/versions/1/infer \
         -H "Content-Type: application/json" \
         -d @request.json
    ```

*(Diagram Placeholder: A simple diagram showing a client sending a request to Triton, which routes it to the correct model backend.)*
