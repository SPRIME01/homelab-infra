# 🚀 Homelab API Documentation Hub 🌐

Welcome to the central hub for all internal API documentation within the homelab! 🎉

This section provides details on how various services communicate and how you can interact with them programmatically.

**Explore the APIs:**

*   [🧠 Triton Inference Server](./triton.md): Access AI models for inference.
*   [✨ Custom AI Services](./custom-ai.md): Interact with bespoke AI applications built in-house.
*   [🔗 Data Integration Endpoints](./data-integration.md): APIs for moving and transforming data between services.
*   [🤖 Automation Webhooks](./automation-webhooks.md): Trigger workflows in n8n, Home Assistant, etc.
*   [🛠️ Internal Utility APIs](./internal-utility.md): Helper APIs for common internal tasks.

**General Concepts:**

*   **Authentication:** Most internal APIs require authentication. Refer to the specific API documentation for details (often involves API keys or internal network trust). 🔑
*   **Base URLs:** Service discovery within Kubernetes typically uses `http://<service-name>.<namespace>.svc.cluster.local:<port>`. External access points (Ingress) will have different URLs.
*   **Formats:** APIs primarily use JSON for request and response bodies. 📄

Happy coding! 💻
