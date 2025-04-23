# Homelab Component Relationship Diagram 🧩

This diagram shows the high-level relationships and dependencies between the major subsystems in the homelab.

```plantuml
@startuml Homelab_Component_Relationships

!theme vibrant

' Define Components (Subsystems)
package "Orchestration & Infrastructure" <<Cloud>> #lightblue {
  [Kubernetes (K3s)] as K8s <<k8s>>
  [Infrastructure (Nodes, Network)] as Infra <<server>>
  [Storage (Longhorn, MinIO)] as Storage <<database>>
}

package "AI & Data Processing" <<Brain>> #pink {
  [AI Services (Triton, Ray)] as AIServices <<robot>>
  [Data Processing Pipelines] as DataProc <<gear>>
}

package "Messaging & Integration" <<Network>> #plum {
  [Data Mesh (RabbitMQ)] as DataMesh <<rabbitmq>>
  [API Gateway (Ingress)] as APIGW <<gateway>>
}

package "Observability" <<Eye>> #orange {
  [Monitoring (Prometheus)] as Monitoring <<monitoring>>
  [Logging (Loki)] as Logging <<search>>
  [Tracing (Tempo/OTel)] as Tracing <<trace>>
  [Visualization (Grafana)] as Visualization <<dashboard>>
}

package "Automation" <<Robot>> #skyblue {
  [Workflow Engine (n8n)] as Workflow <<gear>>
  [Smart Home (Home Assistant)] as SmartHome <<home>>
}

package "Security" <<Shield>> #tomato {
  [Secrets Mgmt (Vault)] as Secrets <<lock>>
  [Network Security (Policies)] as NetSec <<firewall>>
  [AuthN/AuthZ] as Auth <<users>>
}

' Define Relationship Styles
skinparam Arrow {
  Color #666666
  FontColor #444444
  FontSize 10
}
skinparam component {
  ArrowColor #555555
  BorderColor #555555
}

' Relationships

' Kubernetes & Infrastructure Dependencies
K8s --|> Infra : Runs On / Depends On
K8s ..> Storage : Manages / Uses >
Storage --|> Infra : Runs On / Depends On
APIGW --|> K8s : Managed By >
NetSec --|> K8s : Implemented By >

' AI Dependencies
AIServices --|> K8s : Deployed On >
AIServices ..> Storage : Loads Models / Data <
AIServices ..> DataMesh : Consumes Tasks / Publishes Results > : AMQP/Events
DataProc --|> K8s : Deployed On >
DataProc ..> Storage : Reads/Writes Data <
DataProc ..> DataMesh : Consumes/Publishes Data > : AMQP/Events
DataProc ..> AIServices : Uses Inference > : API Calls

' Messaging Dependencies
DataMesh --|> K8s : Deployed On >
APIGW ..> DataMesh : Forwards Events < : Webhooks
Workflow ..> DataMesh : Consumes/Publishes Events > : AMQP
SmartHome ..> DataMesh : Publishes Events > : MQTT/AMQP
AIServices ..> DataMesh : Pub/Sub > : AMQP

' Observability Relationships
Monitoring ..> K8s : Scrapes Metrics < : Kube API, cAdvisor
Monitoring ..> Infra : Scrapes Metrics < : Node Exporter
Monitoring ..> AIServices : Scrapes Metrics < : App Exporters
Monitoring ..> DataMesh : Scrapes Metrics < : RabbitMQ Exporter
Logging ..> K8s : Collects Logs < : OTel/Fluentd DS
Logging ..> Infra : Collects Logs < : OTel/Fluentd DS
Logging ..> AIServices : Collects Logs < : OTel/Fluentd DS
Tracing ..> AIServices : Collects Traces < : OTel SDK
Tracing ..> Workflow : Collects Traces < : OTel SDK
Visualization ..> Monitoring : Queries Metrics < : PromQL
Visualization ..> Logging : Queries Logs < : LogQL
Visualization ..> Tracing : Queries Traces < : Tempo API

' Automation Relationships
Workflow --|> K8s : Deployed On >
SmartHome --|> K8s : Deployed On >
Workflow ..> SmartHome : Controls Devices < : API Calls
Workflow ..> AIServices : Uses AI Models < : API Calls
Workflow ..> APIGW : Triggered By < : Webhooks
SmartHome ..> APIGW : Triggered By < : Webhooks

' Security Relationships
Secrets --|> K8s : Deployed On >
NetSec --|> K8s : Enforced By >
Auth --|> K8s : Integrated With (RBAC) >
Auth ..> APIGW : Secures Endpoints <
AIServices ..> Secrets : Reads Credentials > : Vault API
Workflow ..> Secrets : Reads Credentials > : Vault API
SmartHome ..> Secrets : Reads Credentials > : Vault API
Monitoring ..> NetSec : Monitors Policies < : e.g., Cilium Metrics
Logging ..> Auth : Collects Audit Logs <

@enduml
```

**Explanation of Notation:**

*   **Components:** Represented by rectangles grouped into packages (subsystems). Icons (`<<icon>>`) help identify component types.
*   **Packages:** Group related components (e.g., "Observability", "AI & Data Processing").
*   **Arrows:** Indicate relationships between components.
    *   `--|>` (Inheritance/Realization): Strong dependency, "Runs On" or "Implemented By". (e.g., K8s runs on Infra).
    *   `..>` (Dotted Dependency): Weaker dependency, "Uses", "Communicates With", "Manages", "Monitors", "Secures", "Reads/Writes", "Pub/Sub". Labels clarify the specific interaction.
*   **Labels:** Describe the nature of the relationship (e.g., `Loads Models / Data`, `Scrapes Metrics`, `Secures Endpoints`). Emojis add visual cues.
*   **Cardinality/Direction:** Arrows show the direction of dependency or primary data flow/initiation. `<` and `>` symbols near labels sometimes further clarify directionality (e.g., `Scrapes Metrics <`).

This diagram helps visualize the interconnectedness of the homelab subsystems and understand the key dependencies and communication paths.
