<div align="center">
  <h1>✨ Pulumi Multi-Cloud Infrastructure ✨</h1>
</div>
<div align="center">
  <a href="https://digicred.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/digicred-logo.png" alt="DigiCred Logo" height="100" style="margin-right: 20px;" />
  </a>
  <a href="https://pulumi.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/logo-pulumi.png" alt="Pulumi Logo" height="100" />
  </a>
  <br><br>
  <p>
    <a href="#overview"><strong>Overview</strong></a> •
    <a href="#supported-cloud-providers"><strong>Cloud Providers</strong></a> •
    <a href="#key-features"><strong>Features</strong></a> •
    <a href="#getting-started"><strong>Getting Started</strong></a> •
    <a href="#documentation"><strong>Documentation</strong></a> •
    <a href="#license"><strong>License</strong></a>
  </p>
  <p>
    <img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-4.9+-blue?logo=typescript">
    <img alt="Pulumi" src="https://img.shields.io/badge/Pulumi-3.0+-blueviolet?logo=pulumi">
    <img alt="AWS" src="https://img.shields.io/badge/AWS-Supported-orange?logo=amazon-aws">
    <img alt="Azure" src="https://img.shields.io/badge/Azure-Supported-blue?logo=microsoft-azure">
  </p>
</div>
<hr>

## Overview

**Pulumi Multi-Cloud Infrastructure** is a comprehensive infrastructure as code (IaC) project that enables deployment of consistent, scalable, and secure infrastructure across multiple cloud providers. Using Pulumi with TypeScript, this project provides a unified approach to managing cloud resources while taking advantage of each platform's native capabilities.

The project is designed with a modular architecture that allows for cloud-specific implementations while maintaining a consistent infrastructure pattern across providers.

## Supported Cloud Providers

<div style="display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; margin: 20px 0;">
  <div style="flex: 1; min-width: 300px; max-width: 450px; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background-color: #f9f9f9;">
    <h3>
      <img src="https://raw.githubusercontent.com/aws-amplify/amplify-cli/master/packages/amplify-cli/assets/aws-icon.png" alt="AWS" height="24" style="vertical-align: middle; margin-right: 10px;">
      Amazon Web Services (AWS)
    </h3>
    <p>Deploy infrastructure to AWS with VPC, EC2 instances, and more.</p>
    <a href="README-AWS.md"><strong>AWS Deployment Guide →</strong></a>
  </div>
  <div style="flex: 1; min-width: 300px; max-width: 450px; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background-color: #f9f9f9;">
    <h3>
      <img src="https://raw.githubusercontent.com/Azure/azure-quickstart-templates/master/1-CONTRIBUTION-GUIDE/images/azure.png" alt="Azure" height="24" style="vertical-align: middle; margin-right: 10px;">
      Microsoft Azure
    </h3>
    <p>Deploy infrastructure to Azure with VNet, VMs, and more.</p>
    <a href="README-AZURE.md"><strong>Azure Deployment Guide →</strong></a>
  </div>
</div>

## Key Features

- **Multi-Cloud Support**: Deploy the same application architecture to AWS or Azure
- **Infrastructure as Code**: Everything defined as code using Pulumi and TypeScript
- **Modular Design**: Cloud-specific implementations with a unified interface
- **Secure by Default**: Best practices for network security, access controls, and secrets management
- **Production-Ready**: Configurations for both development and production environments
- **High Availability**: Multi-AZ/multi-region design principles for resilient deployments

## Project Architecture

This project implements a consistent multi-tier architecture across cloud providers with the following components:

- **Network Infrastructure**: Isolated virtual networks with public and private subnets/networks
- **Security Controls**: Properly configured security groups, network ACLs, and firewalls
- **Identity Management**: IAM roles, managed identities, and proper access controls
- **Compute Resources**: Properly sized and configured virtual machines/instances
- **Proxy Layer**: Web-facing component for routing traffic to private application tiers
- **Secrets Management**: Secure storage and access of sensitive configuration

<div align="center">
  <table style="border: none; width: 100%;">
    <tr>
      <td style="width: 50%; text-align: center;">
        <strong>AWS Architecture</strong><br>
        <img src="/assets/aws-architecture-conceptual.png" alt="AWS Architecture" width="400" style="border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
      </td>
      <td style="width: 50%; text-align: center;">
        <strong>Azure Architecture</strong><br>
        <img src="/assets/azure-architecture-conceptual.png" alt="Azure Architecture" width="400" style="border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
      </td>
    </tr>
  </table>
</div>

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **pnpm** (v8+) or npm
- **Pulumi CLI** (v3+)
- **Cloud Provider CLI tools**:
  - AWS CLI (for AWS deployments)
  - Azure CLI (for Azure deployments)
- **Active cloud accounts** with appropriate permissions

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/<your-username>/pulumi-multicloud.git
   cd pulumi-multicloud
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Choose your cloud provider**:
   - For AWS: Follow the [AWS Deployment Guide](README-AWS.md)
   - For Azure: Follow the [Azure Deployment Guide](README-AZURE.md)

4. **Deploy infrastructure**:
   ```bash
   # Set the cloud provider in your Pulumi config
   pulumi config set cloudProvider aws  # or azure
   
   # Preview and deploy
   pulumi up
   ```

## Documentation

Detailed documentation is available for each supported cloud provider:

- [AWS Documentation](README-AWS.md) - Full guide for deploying to AWS
- [Azure Documentation](README-AZURE.md) - Full guide for deploying to Azure

## Project Structure

```
pulumi-multicloud/
├── src/                         # Source code
│   ├── index.ts                 # Main entry point
│   ├── aws/                     # AWS-specific code
│   │   ├── base-infra.ts        # VPC, subnets, gateways, etc.
│   │   ├── ec2-instances.ts     # EC2 instance definitions
│   │   ├── security-secrets.ts  # Security groups and secrets
│   │   └── instances/           # Instance configurations
│   ├── azure/                   # Azure-specific code
│   │   ├── base-infra.ts        # VNet, subnets, NAT gateway
│   │   ├── security-secrets.ts  # NSGs, Key Vault, etc.
│   │   ├── vm-instances.ts      # VM instance definitions
│   │   └── instances/           # Instance configurations
├── assets/                      # Project assets
├── README.md                    # Main project documentation (this file)
├── README-AWS.md                # AWS-specific documentation
├── README-AZURE.md              # Azure-specific documentation
├── Pulumi.yaml                  # Project configuration
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies and scripts
```

## Future Plans

<div style="display: flex; flex-wrap: wrap; gap: 10px;">
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>🌐 GCP Support</h3>
    <p>Add support for Google Cloud Platform deployments</p>
  </div>
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>📊 Monitoring</h3>
    <p>Add integrated monitoring and alerting across cloud providers</p>
  </div>
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>🔒 Backup</h3>
    <p>Implement automated backup solutions</p>
  </div>
</div>

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

<div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; border-left: 4px solid #2671E5;">
  This project is licensed under the Apache License, Version 2.0. See the <a href="LICENSE">LICENSE</a> file included in the repository for the full license text.
</div>

---

<div align="center">
  Created and maintained by <a href="https://github.com/Nas2020">Nas Til</a>
  <br><br>
  <a href="#-pulumi-multi-cloud-infrastructure-">Back to top ⬆️</a>
</div>