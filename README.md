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
- Ansible 2.9+
- Pulumi CLI
- Python 3.8+
- Git

## 🚀 Getting Started

1. Clone the repository:
```bash
git clone https://github.com/yourusername/homelab-infra.git
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
├── ansible/          # 🔧 Ansible playbooks and roles
├── kubernetes/       # ⚙️ K3s manifests and configurations
├── pulumi/          # 🌐 Pulumi IaC code
├── scripts/         # 📜 Utility scripts
└── docs/            # 📚 Documentation
```

## 🔄 Workflow

1. Infrastructure provisioning with Pulumi
2. Node configuration with Ansible
3. Application deployment with K3s

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
