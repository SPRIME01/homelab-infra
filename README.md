# 🏠 Homelab Infrastructure Repository

This repository contains Infrastructure as Code (IaC) for managing a personal homelab environment using Kubernetes (K3s), Ansible, and Pulumi.

## 🎯 Overview

Managing infrastructure for:
- 🖥️ Control Node: Beelink SEi8 (WSL2 + K3s)
- 🤖 AI Node: NVIDIA Jetson AGX Orin
- 🏡 Home Automation: Home Assistant Yellow

## 📋 Prerequisites

- WSL2 on Windows 10/11
- Docker Desktop
- Kubernetes CLI (kubectl)
- Ansible 9+
- Pulumi CLI
- Python 3.10+
- Git

## 🚀 Getting Started

1. Clone the repository:
```bash
git clone https://github.com/SPRIME01/homelab-infra.git
cd homelab-infra
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your settings
```

## 📁 Repository Structure

```
homelab-infra/
├── ansible/         # 🔧 Ansible playbooks and roles for node configuration
├── kubernetes/      # ⚙️ K3s manifests and configurations
├── pulumi/          # 🌐 Pulumi IaC code for infrastructure provisioning
├── scripts/         # 📜 Utility scripts for testing, deployment, etc.
├── monitoring/      # 📊 Prometheus, Grafana, and Loki configurations
├── tests/           # ✅ Test suites (Molecule, Testinfra, Pytest)
└── docs/            # 📚 Documentation
```

## 🔄 Workflow

1. **Infrastructure Provisioning**: Use Pulumi to provision base infrastructure (K3s cluster, storage, core services).
2. **Node Configuration**: Configure nodes using Ansible playbooks for system-level settings and application deployment.
3. **Application Deployment**: Deploy applications and services using K3s manifests.
4. **Automated Testing**: Run Molecule, Testinfra, and Pytest suites to validate infrastructure and application state.
5. **Continuous Monitoring**: Monitor system performance, application health, and test results using Prometheus, Grafana, and Loki.

---

## 🧪 Testing Strategy

The project employs a comprehensive testing strategy using Molecule, Testinfra, and Pytest. Key aspects include:

* **Molecule**: Role-based testing with Docker driver, ensuring idempotency and proper configuration.
* **Testinfra**: Verification of infrastructure state, Kubernetes resources, and service configurations.
* **Pytest**: Unit and integration tests for Pulumi deployments, logging, and metrics.
* **Pre-commit Hooks**: Automated code quality checks and quick validation tests.
* **CI/CD Pipeline**: GitHub Actions workflow for continuous integration and automated testing.
* **Logging & Monitoring**: Loki for log aggregation, Prometheus for metrics, and Grafana for visualization.

---
## ⚙️ Key Scripts

* `deploy-ansible.sh`: Deploys Ansible playbook configurations.
* `test-ansible.sh`: Tests Ansible playbooks and roles (linting, syntax, dry-run).
* `deploy-pulumi.sh`: Deploys infrastructure using Pulumi stacks.
* `test-pulumi.sh`: Tests Pulumi configurations.
* `deploy-dashboards.sh`: Deploys Grafana dashboards to Kubernetes.
* `deploy-correlator.sh`: Deploys the log-metric correlator service.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit changes
4. Submit Pull Request

## 📝 License

MIT License - See [LICENSE](LICENSE) for details

## ⚠️ Disclaimer

This is a personal homelab setup. Use at your own risk.

## 📫 Contact

Create an issue for questions or problems.
