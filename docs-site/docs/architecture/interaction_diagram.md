# Homelab User Interaction Diagram 🧑‍💻🗣️📱

This diagram shows the various ways users and external systems interact with the homelab environment.

```mermaid
graph LR
    %% Define Actors
    User(👤 User)
    Admin(🧑‍💻 Admin)
    ExtSystem(☁️ External System)
    VoiceAssistant(🗣️ Voice Assistant Device)
    MobileDevice(📱 Mobile Device)

    %% Define Entrypoints & Security
    subgraph Internet ["🌐 Internet"]
        Cloudflare(Cloudflare Tunnel/Proxy)
    end

    subgraph HomelabNetwork ["🏠 Homelab Network"]
        Ingress(🚦 Ingress Controller)
        AuthN(🔑 Authentication Service / SSO)
        K8sAPI(☸️ K8s API Server)
        Vault(🔒 Vault API)
        SSH(💻 SSH Access)

        subgraph Services ["🧩 Services"]
            Grafana(📈 Grafana)
            N8N(⚙️ n8n)
            HA(🏡 Home Assistant)
            OtherSvc(🌐 Other Web Service)
            APISvc(🔌 Custom API Service)
        end
    end

    %% Define Styles
    linkStyle default stroke:#aaa,stroke-width:1px;
    style Cloudflare fill:#f9a825,stroke:#f57f17,stroke-width:2px;
    style AuthN fill:#e91e63,stroke:#c2185b,stroke-width:2px;
    style K8sAPI fill:#326CE5,stroke:#1e88e5,stroke-width:2px;
    style Vault fill:#ff4500,stroke:#e65100,stroke-width:2px;
    style SSH fill:#757575,stroke:#424242,stroke-width:2px;

    %% 1. Direct Web Access (User)
    User -- HTTPS --> Cloudflare;
    Cloudflare -- Encrypted Tunnel --> Ingress;
    Ingress -- Needs Auth? --> AuthN;
    AuthN -- Authenticated --> Ingress;
    Ingress -- Route --> Grafana;
    Ingress -- Route --> N8N;
    Ingress -- Route --> HA;
    Ingress -- Route --> OtherSvc;

    %% 2. Voice Commands (User via Device)
    User -- Voice --> VoiceAssistant;
    VoiceAssistant -- Intent/Audio --> HA;
    HA -- Process Command --> K8sAPI; %% Potentially triggers actions on other services via RMQ/API (See Data Flow)

    %% 3. Mobile App Interactions (User via Device)
    User -- App UI --> MobileDevice;
    MobileDevice -- HTTPS (App API) --> Cloudflare; %% Or direct if on local WiFi
    Cloudflare -- Tunnel --> Ingress;
    Ingress -- Route --> HA; %% Often HA Companion App

    %% 4. Administrative Access (Admin)
    Admin -- HTTPS (kubectl) --> K8sAPI; %% Requires Kubeconfig/Auth
    Admin -- SSH --> SSH; %% Requires SSH Key/Password
    SSH -- Access --> Nodes(["🖥️ Nodes"]);
    Admin -- HTTPS --> Grafana; %% Via Cloudflare/Ingress + AuthN
    Admin -- HTTPS --> Vault; %% Via Ingress + AuthN or Direct + Token
    Admin -- HTTPS --> N8N; %% Via Cloudflare/Ingress + AuthN

    %% 5. API Access (External System)
    ExtSystem -- HTTPS (Webhook/API Call) --> Cloudflare;
    Cloudflare -- Tunnel --> Ingress;
    Ingress -- Needs API Key/Token? --> AuthN; %% Or handled by service
    AuthN -- Authorized --> Ingress;
    Ingress -- Route --> N8N; %% Webhook Trigger
    Ingress -- Route --> HA; %% Webhook Trigger
    Ingress -- Route --> APISvc; %% Custom API Endpoint

```

**Explanation:**

*   **Actors:** Represent the entities initiating interactions (User, Admin, External System, Devices).
*   **Entrypoints:** Show how interactions enter the homelab (Cloudflare Tunnel, SSH).
*   **Authentication:** The `AuthN` node represents authentication points (SSO, service-specific login, API key validation). Interactions often pass through this.
*   **Services:** Represent the backend applications users interact with.
*   **Arrows:** Show the flow of requests and responses.
*   **Subgraphs:** Group related components visually (Internet, Homelab Network, Services).
*   **Styling:** Highlights key security and entrypoint components.

This diagram clarifies the different pathways for interaction, highlighting the role of Cloudflare Tunnels for external access, Ingress for internal routing, and various authentication mechanisms.
