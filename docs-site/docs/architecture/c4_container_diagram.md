# Homelab Architecture - C4 Container Diagram 🏗️

This diagram illustrates the container-level architecture of the homelab, showing the major software components running on the physical nodes and their interactions.

```plantuml
@startuml C4_Homelab_Container_Diagram
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

!define BeelinkColor #ADD8E6
!define JetsonColor #90EE90
!define HAColor #FFD700
!define K8sColor #326CE5
!define AIColor #FF69B4
!define ObservabilityColor #FFA500
!define DataMeshColor #DDA0DD
!define AutomationColor #87CEEB
!define SecurityColor #FF4500
!define StorageColor #A9A9A9
!define NetworkColor #CCCCCC

' Actors / Persons
Person(admin, "🏠 Homelab Admin", "Manages and uses the homelab services.")
System_Ext(iot_devices, "📱 IoT Devices", "Sensors, lights, etc. interacting with Home Assistant.")
System_Ext(external_services, "☁️ External Services", "Cloud APIs, external data sources.")

' Boundaries for Physical Nodes
Boundary(control_node, "🖥️ Beelink SEi8 (Control Node)", "WSL2 on Windows | 192.168.1.10 / 10.0.1.10") {
    ' K3s Control Plane Components
    Container(k3s_server, "🚀 K3s Server", "Kubernetes API, Scheduler, Controller", "Manages cluster state", $sprite="k8s", $color=K8sColor)
    Container(etcd, "📦 etcd", "Distributed Key-Value Store", "Stores K3s cluster state", $sprite="database", $color=K8sColor)

    ' Shared Services running on Control Node
    Container(rabbitmq, "🐇 RabbitMQ", "Message Broker", "Decouples services, event bus", $sprite="rabbitmq", $color=DataMeshColor)
    Container(n8n, "⚙️ n8n", "Workflow Automation", "Automates tasks via workflows", $sprite="gear", $color=AutomationColor)
    Container(vault, "🔑 Vault", "Secrets Management", "Manages secrets and credentials", $sprite="lock", $color=SecurityColor)
    Container(prometheus, "📊 Prometheus", "Metrics Collection", "Scrapes and stores metrics", $sprite="monitoring", $color=ObservabilityColor)
    Container(alertmanager, "🚨 Alertmanager", "Alert Handling", "Manages and routes alerts", $sprite="alarm", $color=ObservabilityColor)
    Container(grafana, "📈 Grafana", "Visualization", "Dashboards for metrics and logs", $sprite="dashboard", $color=ObservabilityColor)
    Container(loki, "📜 Loki", "Log Aggregation", "Collects and indexes logs", $sprite="search", $color=ObservabilityColor)
    Container(influxdb, "⏳ InfluxDB", "Time Series DB", "Long-term metrics storage", $sprite="database", $color=ObservabilityColor)
    Container(longhorn_ui, "💾 Longhorn UI", "Storage Mgmt", "Manages persistent volumes", $sprite="storage", $color=StorageColor)
}

Boundary(ai_node, "🧠 Jetson AGX Orin (AI Node)", "Ubuntu | 192.168.1.20 / 10.0.2.20") {
    Container(k3s_agent_ai, "🛰️ K3s Agent", "Kubernetes Node Agent", "Runs workloads, managed by K3s Server", $sprite="k8s", $color=K8sColor)
    Container(triton, "🔱 Triton Inference Server", "AI Model Serving", "Serves various AI models (ONNX, TensorRT)", $sprite="robot", $color=AIColor)
    Container(ray_cluster, "☀️ Ray Cluster", "Distributed Compute", "For distributed AI training/processing", $sprite="cluster", $color=AIColor)
    Container(minio, "🪣 MinIO", "S3 Object Storage", "Stores AI models, datasets, artifacts", $sprite="storage", $color=StorageColor)
    Container(otlp_collector_ai, "📡 OTel Collector (DaemonSet)", "Telemetry Collection", "Collects metrics, logs, traces from node/pods", $sprite="otel", $color=ObservabilityColor)
    Container(node_exporter_ai, "📟 Node Exporter", "Node Metrics", "Exposes hardware/OS metrics", $sprite="monitoring", $color=ObservabilityColor)
    Container(longhorn_vols_ai, "💾 Longhorn Volumes", "Distributed Block Storage", "Provides PVs for pods", $sprite="storage", $color=StorageColor)

}

Boundary(ha_node, "💡 HA Yellow (HA Node)", "Home Assistant OS | 192.168.1.30 / 10.0.3.30") {
    Container(k3s_agent_ha, "🛰️ K3s Agent", "Kubernetes Node Agent", "Runs workloads, managed by K3s Server", $sprite="k8s", $color=K8sColor)
    Container(home_assistant, "🏡 Home Assistant Core", "Smart Home Hub", "Manages IoT devices, automations", $sprite="home", $color=AutomationColor)
    Container(zigbee2mqtt, "🐝 Zigbee2MQTT", "Zigbee Gateway", "Connects Zigbee devices via MQTT", $sprite="zigbee", $color=AutomationColor)
    Container(zwavejsui, "🌊 Z-Wave JS UI", "Z-Wave Gateway", "Connects Z-Wave devices via MQTT/WS", $sprite="zwave", $color=AutomationColor)
    Container(otlp_collector_ha, "📡 OTel Collector (DaemonSet)", "Telemetry Collection", "Collects metrics, logs, traces from node/pods", $sprite="otel", $color=ObservabilityColor)
    Container(node_exporter_ha, "📟 Node Exporter", "Node Metrics", "Exposes hardware/OS metrics", $sprite="monitoring", $color=ObservabilityColor)
    Container(longhorn_vols_ha, "💾 Longhorn Volumes", "Distributed Block Storage", "Provides PVs for pods", $sprite="storage", $color=StorageColor)
}

' Kubernetes Cluster Wide Components (often run across multiple nodes via DaemonSets/Deployments)
Boundary(k8s_cluster, "☸️ Kubernetes Cluster Services") {
    Container(coredns, "🌐 CoreDNS", "Cluster DNS", "Provides service discovery", $sprite="dns", $color=K8sColor)
    Container(ingress, "🚦 Ingress Controller", "API Gateway", "Exposes services externally/internally", $sprite="gateway", $color=K8sColor)
    Container(longhorn_manager, "💾 Longhorn Manager (DS)", "Storage Orchestration", "Manages volume replicas, snapshots", $sprite="storage", $color=StorageColor)
    Container(net_policy, "🛡️ Network Policies", "Network Segmentation", "Controls traffic flow between pods", $sprite="firewall", $color=SecurityColor)
    ' Note: OTel Collector & Node Exporter are shown within node boundaries as DaemonSets
}

' Relationships
' Admin Interactions
Rel_D(admin, grafana, "Views Dashboards 📊", "HTTPS")
Rel_D(admin, longhorn_ui, "Manages Storage 💾", "HTTPS")
Rel_D(admin, home_assistant, "Controls Devices 💡", "HTTPS")
Rel_D(admin, n8n, "Manages Workflows ⚙️", "HTTPS")
Rel_D(admin, vault, "Manages Secrets 🔑", "HTTPS/CLI")
Rel_D(admin, k3s_server, "Manages Cluster (kubectl) 🚀", "HTTPS")

' K3s Core Interactions
Rel_D(k3s_server, etcd, "Stores State 💾", "gRPC")
Rel_D(k3s_agent_ai, k3s_server, "Registers, gets instructions 🛰️", "HTTPS")
Rel_D(k3s_agent_ha, k3s_server, "Registers, gets instructions 🛰️", "HTTPS")
Rel_D(k3s_server, coredns, "Manages service DNS records 🌐", "API")
Rel_D(k3s_server, ingress, "Manages ingress resources 🚦", "API")
Rel_D(k3s_server, longhorn_manager, "Orchestrates volumes 💾", "API")

' Observability Flow
Rel_D(node_exporter_ai, prometheus, "Exposes Node Metrics 📟", "HTTP")
Rel_D(node_exporter_ha, prometheus, "Exposes Node Metrics 📟", "HTTP")
' Assume Prometheus scrapes K3s components, Triton, RabbitMQ, etc. (omitted for clarity)
Rel_D(prometheus, alertmanager, "Sends Alerts 🔥", "HTTP")
Rel_D(alertmanager, grafana, "Displays Alerts 🚨", "API")
Rel_D(alertmanager, n8n, "Sends Alert Notifications ➡️", "Webhook") ' Example notification channel
Rel_D(otlp_collector_ai, loki, "Sends Logs 📜", "gRPC/HTTP")
Rel_D(otlp_collector_ha, loki, "Sends Logs 📜", "gRPC/HTTP")
' Assume OTel collectors send metrics to Prometheus/InfluxDB (omitted for clarity)
Rel_D(grafana, prometheus, "Queries Metrics 📊", "HTTP")
Rel_D(grafana, loki, "Queries Logs 📜", "HTTP")
Rel_D(grafana, influxdb, "Queries Metrics ⏳", "HTTP")
Rel_D(prometheus, influxdb, "Writes Long-Term Metrics 💾", "Remote Write") ' Optional

' AI Workflow
Rel_D(n8n, triton, "Sends Inference Requests 🤖", "HTTP/gRPC")
Rel_D(triton, minio, "Loads Models 💾", "S3 API")
Rel_D(ray_cluster, minio, "Reads/Writes Data/Models 💾", "S3 API")
Rel_D(triton, k3s_server, "Uses GPU resources via device plugin 🔌", "K8s API") ' Implicit via scheduling

' Data Mesh / Automation
Rel_D(home_assistant, rabbitmq, "Publishes Device State Events 💡", "AMQP")
Rel_D(zigbee2mqtt, rabbitmq, "Publishes/Subscribes Zigbee Events 🐝", "MQTT (via adapter) / AMQP")
Rel_D(zwavejsui, rabbitmq, "Publishes/Subscribes Z-Wave Events 🌊", "MQTT (via adapter) / AMQP")
Rel_D(n8n, rabbitmq, "Consumes/Publishes Events ⚙️", "AMQP")
Rel_D(iot_devices, home_assistant, "Sends sensor data / Receives commands 📲", "Zigbee/Z-Wave/WiFi")
Rel_D(zigbee2mqtt, iot_devices, "Communicates 🐝", "Zigbee")
Rel_D(zwavejsui, iot_devices, "Communicates 🌊", "Z-Wave")
Rel_D(home_assistant, external_services, "Integrates with Cloud APIs ☁️", "HTTPS")
Rel_D(n8n, external_services, "Integrates with Cloud APIs ☁️", "HTTPS")
Rel_D(n8n, home_assistant, "Controls HA Entities 🏠", "API/WebSocket")

' Storage Interactions
Rel_D(longhorn_manager, longhorn_vols_ai, "Manages Volume Replicas 💾", "Internal")
Rel_D(longhorn_manager, longhorn_vols_ha, "Manages Volume Replicas 💾", "Internal")
' Pods (Triton, DBs, HA, etc.) use Longhorn Volumes (omitted for clarity)

' Security Interactions
Rel_D(n8n, vault, "Reads Secrets 🔑", "API")
Rel_D(triton, vault, "Reads Secrets 🔑", "API") ' e.g., for accessing secured resources
Rel_D(home_assistant, vault, "Reads Secrets 🔑", "API")
' Network Policies applied by K3s API (implicit)

' DNS / Ingress
Rel_D(grafana, ingress, "Exposed via Ingress 🚦", "HTTP") ' Example external exposure
Rel_D(home_assistant, ingress, "Exposed via Ingress 🚦", "HTTP") ' Example external exposure
' All internal services use CoreDNS for discovery (omitted for clarity)

' Legend
LAYOUT_WITH_LEGEND()

@enduml
```

**Explanation:**

1.  **`!include C4_Container.puml`**: Imports the C4 model definitions for PlantUML.
2.  **`!define`**: Sets up color variables for different subsystems for visual grouping.
3.  **`Person(...)` / `System_Ext(...)`**: Defines external users and systems interacting with the homelab.
4.  **`Boundary(node_alias, "Node Name", "Details | IP Addresses") { ... }`**: Creates visual boundaries for each physical node, containing the containers running on them. IP addresses/segments are included in the boundary description.
5.  **`Container(alias, "Name", "Technology", "Description", $sprite, $color)`**: Defines individual software containers (applications, services, databases).
    *   `$sprite`: Adds an icon (requires PlantUML stdlib).
    *   `$color`: Assigns a background color based on the defined variables.
6.  **`Boundary(k8s_cluster, ...) { ... }`**: Groups cluster-wide services that might run across multiple nodes (like CoreDNS, Ingress).
7.  **`Rel_D(source, destination, "Description Label ✏️", "Protocol/Technology")`**: Defines directed relationships (data flows) between components. Emojis are added to the labels.
8.  **`LAYOUT_WITH_LEGEND()`**: Automatically arranges the diagram and adds a legend explaining the C4 notation.

This diagram provides a detailed view of the software components, their locations on the physical hardware, and how they interact within the homelab environment.
