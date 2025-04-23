# Homelab Data Flow Diagram 🌊

This diagram illustrates the movement of different types of data through the homelab system.

```mermaid
graph TD
    %% Define Subgraphs for Clarity
    subgraph UserInput ["🗣️ User Input"]
        direction LR
        VoiceCmd(Voice Command)
        WebUI(Web UI / App)
    end

    subgraph IoT ["🏠 IoT Devices"]
        direction LR
        Sensors(Sensors / Devices)
    end

    subgraph SmartHome ["🤖 Smart Home"]
        direction LR
        HA(Home Assistant)
    end

    subgraph Messaging ["🐇 Messaging"]
        direction TB
        RMQ(RabbitMQ)
    end

    subgraph AIProcessing ["🧠 AI Processing"]
        direction TB
        STT(Speech-to-Text)
        NLU(Natural Language Understanding)
        TTS(Text-to-Speech)
        Triton(Triton Inference Server)
    end

    subgraph Automation ["⚙️ Automation"]
        direction TB
        N8N(n8n Workflow Engine)
    end

    subgraph Observability ["📊 Observability"]
        direction TB
        OTel(OTel Collector)
        Prom(Prometheus)
        Loki(Loki)
        Tempo(Tempo)
        Grafana(Grafana)
    end

    subgraph Storage ["💾 Storage"]
        direction TB
        Influx(InfluxDB - Metrics)
        LokiStore(Loki Storage - Logs)
        TempoStore(Tempo Storage - Traces)
        MinIO(MinIO - Models/Data)
        Longhorn(Longhorn - PVs)
    end

    subgraph AppServices ["🧩 App Services"]
        direction TB
        App1(App Service 1)
        App2(App Service 2)
    end

    %% Define Styles for Data Types
    linkStyle 0 stroke:#3498db,stroke-width:2px; %% Sensor Data
    linkStyle 1,2,3,4,5,6 stroke:#e67e22,stroke-width:2px; %% Voice Command Flow
    linkStyle 7,8,9,10,11,12 stroke:#9b59b6,stroke-width:2px; %% Event Bus Flow
    linkStyle 13,14,15,16,17,18,19,20,21 stroke:#f1c40f,stroke-width:2px; %% Telemetry Flow
    linkStyle 22,23,24,25,26,27 stroke:#2ecc71,stroke-width:2px; %% Automation Flow

    %% 1. Sensor Data Flow
    Sensors -- Sensor Reading --> HA;
    HA -- State Change Event --> RMQ;
    RMQ -- Sensor Data --> N8N;
    N8N -- Formatted Metric --> OTel;
    OTel -- Metric --> Prom;
    Prom -- Time Series Data --> Influx;

    %% 2. Voice Command Flow
    VoiceCmd -- Audio Stream --> HA;
    HA -- Audio --> STT(AI Service);
    STT -- Transcribed Text --> NLU(AI Service);
    NLU -- Intent/Entities --> HA;
    HA -- Action Command --> RMQ;
    HA -- Response Text --> TTS(AI Service);
    TTS -- Audio Response --> HA;

    %% 3. Event Bus Flow (RabbitMQ)
    HA -- Device Events --> RMQ;
    App1 -- Business Events --> RMQ;
    RMQ -- Event --> N8N;
    RMQ -- Event --> App2;
    RMQ -- Event --> OTel; %% For tracing/monitoring messages

    %% 4. Telemetry Flow
    HA -- Logs/Metrics/Traces --> OTel;
    Triton -- Logs/Metrics/Traces --> OTel;
    N8N -- Logs/Metrics/Traces --> OTel;
    App1 -- Logs/Metrics/Traces --> OTel;
    K8sNodes(["K8s Nodes/Infra"]) -- Logs/Metrics --> OTel;
    OTel -- Metrics --> Prom;
    OTel -- Logs --> Loki;
    OTel -- Traces --> Tempo;
    Prom -- Metrics --> Influx; %% Optional Remote Write
    Loki -- Logs --> LokiStore;
    Tempo -- Traces --> TempoStore;
    Grafana -- Query --> Prom;
    Grafana -- Query --> Loki;
    Grafana -- Query --> Tempo;
    Grafana -- Query --> Influx;

    %% 5. Automation Flow
    WebUI -- Trigger Webhook --> N8N;
    RMQ -- Trigger Event --> N8N;
    N8N -- API Call --> Triton;
    N8N -- API Call --> HA;
    N8N -- API Call --> App1;
    N8N -- Write Data --> MinIO;
    N8N -- Publish Event --> RMQ;

    %% General Storage Usage (Simplified)
    Triton --> MinIO; %% Load Models
    HA --> Longhorn; %% Config/Data PV
    N8N --> Longhorn; %% Workflow/Data PV
```

**Explanation:**

*   **Subgraphs:** Group related components visually (e.g., `UserInput`, `AIProcessing`).
*   **Nodes:** Represent services, data stores, or sources/sinks of data.
*   **Arrows:** Indicate the direction of data flow.
*   **Labels on Arrows:** Describe the type of data being transferred (e.g., `Sensor Reading`, `Audio Stream`, `Logs/Metrics/Traces`).
*   **`linkStyle`:** Defines different colors for arrows representing specific data flow types (Sensor Data, Voice Commands, Event Bus, Telemetry, Automation). You might need to adjust indices if you add/remove flows.

This diagram provides a visual overview of how key data types traverse the different subsystems within the homelab.
