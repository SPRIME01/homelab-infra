# Homelab Network Architecture

This diagram illustrates the network architecture of the homelab environment, showing the flow of traffic from external access through internal services and connections to external resources.

```mermaid
graph TD
    subgraph External Access
        Internet[Internet User] -- HTTPS/TLS --> CF[Cloudflare]
        CF -- Cloudflare Tunnel (TLS) --> CNI[Cloudflare Tunnel Ingress]
    end

    subgraph Kubernetes Cluster (k8s.local)
        CNI -- HTTPS/TLS --> APIGW[Internal API Gateway (e.g., Traefik/Nginx)]

        subgraph Namespace: default
            CoreDNS[CoreDNS]
        end

        subgraph Namespace: automation
            HA[Home Assistant]
        end

        subgraph Namespace: ai
            Triton[Triton Inference Server]
            Ray[Ray Cluster]
        end

        subgraph Namespace: data
            PostgreSQL[PostgreSQL]
            Redis[Redis]
            RabbitMQ[RabbitMQ]
        end

        subgraph Namespace: monitoring
            Prometheus[Prometheus]
            Grafana[Grafana]
        end

        APIGW -- HTTPS/TLS --> HA
        APIGW -- HTTPS/TLS --> Grafana
        APIGW -- gRPC/HTTP --> Triton
        APIGW -- HTTP --> Ray

        HA --> RabbitMQ
        HA --> PostgreSQL
        HA --> CoreDNS

        Triton --> CoreDNS
        Ray --> CoreDNS
        Ray --> RabbitMQ

        Prometheus -- Scrapes --> HA
        Prometheus -- Scrapes --> Triton
        Prometheus -- Scrapes --> Ray
        Prometheus -- Scrapes --> PostgreSQL
        Prometheus -- Scrapes --> Redis
        Prometheus -- Scrapes --> RabbitMQ
        Prometheus -- Scrapes --> APIGW
        Prometheus -- Scrapes --> CoreDNS

        Grafana --> Prometheus
        Grafana --> PostgreSQL

        %% Internal Service-to-Service Communication
        %% Assuming internal communication might not always be TLS, but could be
        HA -.-> ExternalResources[External APIs/Services]
        Triton -.-> ExternalResources
        Ray -.-> ExternalResources

        %% DNS Resolution
        subgraph DNS Resolution Flow
            HA -- DNS Query --> CoreDNS
            Triton -- DNS Query --> CoreDNS
            Ray -- DNS Query --> CoreDNS
            PostgreSQL -- DNS Query --> CoreDNS
            Redis -- DNS Query --> CoreDNS
            RabbitMQ -- DNS Query --> CoreDNS
            Prometheus -- DNS Query --> CoreDNS
            Grafana -- DNS Query --> CoreDNS
            APIGW -- DNS Query --> CoreDNS
            CoreDNS -- Forward Query --> UpstreamDNS[Upstream DNS (e.g., Router/ISP/Public)]
        end

    end

    style CF fill:#f9a03c,stroke:#333,stroke-width:2px
    style CNI fill:#f0f0f0,stroke:#333,stroke-width:1px
    style APIGW fill:#add8e6,stroke:#333,stroke-width:2px
    style CoreDNS fill:#e6e6fa,stroke:#333,stroke-width:1px
```

**Diagram Legend:**

*   `-- HTTPS/TLS -->`: Secure connection over HTTPS/TLS.
*   `-- Cloudflare Tunnel (TLS) -->`: Secure connection via Cloudflare Tunnel.
*   `-->`: Standard network connection (potentially internal HTTP/TCP/gRPC).
*   `-.->`: Connection to external resources.
*   **Boxes**: Represent services, components, or namespaces.
*   **Subgraphs**: Group related components (e.g., within a namespace or the cluster).
*   **Colors**: Used to highlight key components (Cloudflare, API Gateway, CoreDNS).
```
