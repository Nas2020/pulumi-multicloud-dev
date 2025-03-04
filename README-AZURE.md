<!-- <div align="center">
  <h1>✨ Pulumi Multi-Cloud Infrastructure for Azure ✨</h1>
</div>
<div align="center">
  <a href="https://digicred.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/digicred-logo.png" alt="DigiCred Logo" height="100" style="margin-right: 20px;" />
  </a>
  <a href="https://pulumi.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/logo-pulumi.png" alt="Pulumi Logo" height="100" />
  </a>
  <a href="https://azure.microsoft.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/azure-logo.png" alt="Azure Logo" height="100" />
  </a>
  <br><br>
  <p>
    <a href="#project-overview"><strong>Overview</strong></a> •
    <a href="#architecture"><strong>Architecture</strong></a> •
    <a href="#prerequisites"><strong>Prerequisites</strong></a> •
    <a href="#setup-instructions"><strong>Setup</strong></a> •
    <a href="#deployment"><strong>Deployment</strong></a> •
    <a href="#troubleshooting"><strong>Troubleshooting</strong></a>
  </p>
  <p>
    <img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-4.9+-blue?logo=typescript">
    <img alt="Pulumi" src="https://img.shields.io/badge/Pulumi-3.0+-blueviolet?logo=pulumi">
    <img alt="Azure" src="https://img.shields.io/badge/Azure-Supported-blue?logo=microsoft-azure">
  </p>
</div>
<hr>

This project uses **Pulumi** with **TypeScript** to deploy Infrastructure as Code (IaC) for Microsoft Azure. This README provides instructions to set up and run the project locally on macOS or Linux, deploy to Azure for development and production environments, and an overview of the architecture and file structure.

## Table of Contents
- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup Instructions](#setup-instructions)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [License](#license)

---

## Project Overview

This project leverages Pulumi and TypeScript to deploy a scalable Azure infrastructure designed with a Virtual Network, multiple subnets, NAT Gateway, and dedicated virtual machines for different application tiers. The infrastructure includes secure networking, key vault for secrets management, and managed identities for enhanced security.

### Key Components

<table>
  <tr>
    <th width="200">Component</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>Virtual Network</b><br><code>main-vnet</code></td>
    <td>A Virtual Network providing an isolated network environment in Azure. The CIDR <code>10.1.0.0/16</code> supports up to 65,536 IP addresses, dynamically allocated across public and private subnets.</td>
  </tr>
  <tr>
    <td><b>Public Subnets</b></td>
    <td>Subnets hosting resources that require direct internet access, such as the <code>web-instance</code>. Each subnet resides in a distinct region for high availability.</td>
  </tr>
  <tr>
    <td><b>Private Subnets</b></td>
    <td>Subnets for resources requiring isolation from the public internet, such as the <code>traction-test-instance</code> and <code>controller-test-instance</code>. Each subnet is configured with NAT Gateway for outbound connectivity.</td>
  </tr>
  <tr>
    <td><b>NAT Gateway</b><br><code>nat-gw</code></td>
    <td>Provides outbound internet connectivity for private subnet resources while maintaining security by not exposing them directly to the internet.</td>
  </tr>
  <tr>
    <td><b>Network Security Groups</b></td>
    <td>
      <ul>
        <li><b>Web NSG</b>: Controls traffic to public-facing resources</li>
        <li><b>App NSG</b>: Controls traffic to application tier resources</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td><b>Key Vault</b></td>
    <td>Securely stores sensitive information like credentials and certificates with RBAC-based access control.</td>
  </tr>
  <tr>
    <td><b>Managed Identity</b></td>
    <td>Provides Azure Active Directory-based authentication for VMs without storing credentials in code or configuration.</td>
  </tr>
  <tr>
    <td><b>Virtual Machines</b></td>
    <td>
      <ul>
        <li><b>Web Instance</b>: Configured with Nginx as a reverse proxy in a public subnet</li>
        <li><b>Traction Instance</b>: Hosting application services in a private subnet</li>
        <li><b>Controller Instance</b>: Hosting control services in a private subnet</li>
      </ul>
    </td>
  </tr>
</table>

---

## Architecture

The architecture follows a multi-tier design with public-facing and private service layers deployed for enhanced security.

### Conceptual Architecture

<div align="center">
  <img src="/assets/azure-architecture-conceptual.png" alt="Azure Architecture Conceptual" width="800" style="border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
</div>

### Network Architecture

<table>
  <tr>
    <th width="200">Component</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>Security Layers</b></td>
    <td>Combination of Network Security Groups, private subnets, and Key Vault firewalls to secure resources.</td>
  </tr>
  <tr>
    <td><b>Proxy Architecture</b></td>
    <td>Web VM with Nginx in the public subnet acts as the entry point, proxying traffic to private instances.</td>
  </tr>
  <tr>
    <td><b>Managed Identity</b></td>
    <td>VMs use managed identities to access Key Vault secrets without embedded credentials.</td>
  </tr>
</table>

---

## Prerequisites

Before you begin, ensure you have the following installed:

<table>
  <tr>
    <th width="200">Requirement</th>
    <th>Details</th>
  </tr>
  <tr>
    <td><b>Node.js</b></td>
    <td>v18 or later - <a href="https://nodejs.org/">Download</a></td>
  </tr>
  <tr>
    <td><b>pnpm</b></td>
    <td>v8 or later - Install with <code>npm install -g pnpm</code></td>
  </tr>
  <tr>
    <td><b>Pulumi CLI</b></td>
    <td>v3 or later - <a href="https://www.pulumi.com/docs/get-started/install/">Installation Guide</a></td>
  </tr>
  <tr>
    <td><b>Azure CLI</b></td>
    <td>Latest version - <a href="https://docs.microsoft.com/en-us/cli/azure/install-azure-cli">Installation Guide</a></td>
  </tr>
  <tr>
    <td><b>Azure Account</b></td>
    <td>Active subscription with Contributor access</td>
  </tr>
  <tr>
    <td><b>TypeScript</b></td>
    <td>Included via project dependencies</td>
  </tr>
</table>

### Optional
- **Docker** (for testing locally, if needed)
- **Git** (to clone and manage this repository)

---

## Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/<your-username>/pulumi-multicloud.git
cd pulumi-multicloud
```

### 2. Install Dependencies
Install the project dependencies using pnpm (recommended for consistency):

```bash
pnpm install
```

Alternatively, use npm if preferred:

```bash
npm install
```

> **Note:**
> - macOS/Linux: These commands work natively in Terminal.
> - Windows: Use Command Prompt, PowerShell, or a Unix-like shell (e.g., Git Bash, WSL). Ensure Node.js and pnpm/npm are in your PATH.

### 3. Configure Azure Credentials

<details>
<summary><b>Option 1: Azure CLI Authentication</b> (click to expand)</summary>
<br>
Log in to Azure using the Azure CLI:

```bash
az login
```

This will open a browser window for authentication. After successful login, list your subscriptions:

```bash
az account list --output table
```

Set your active subscription:

```bash
az account set --subscription "<subscription-id>"
```

This is the simplest method but uses your personal credentials.
</details>

<details>
<summary><b>Option 2: Service Principal Authentication (Recommended)</b> (click to expand)</summary>
<br>
Create a Service Principal with Contributor rights to your subscription:

```bash
az ad sp create-for-rbac --name "PulumiDeployment" --role Contributor --scopes /subscriptions/<subscription-id>
```

This will output credentials including `appId` (Client ID), `password` (Client Secret), and `tenant` (Tenant ID).

Configure Pulumi to use these credentials:

<b>Method 1: Environment Variables</b>

```bash
export ARM_CLIENT_ID=<appId>
export ARM_CLIENT_SECRET=<password>
export ARM_TENANT_ID=<tenant>
export ARM_SUBSCRIPTION_ID=<subscription-id>
```

<b>Method 2: Create a helper script (for convenience)</b>

```bash
cat > run-pulumi-azure.sh << 'EOF'
#!/bin/bash
export ARM_CLIENT_ID="<appId>"
export ARM_CLIENT_SECRET="<password>"
export ARM_TENANT_ID="<tenant>"
export ARM_SUBSCRIPTION_ID="<subscription-id>"
# Run pulumi command with the provided arguments
pulumi "$@"
EOF

chmod +x run-pulumi-azure.sh
```

<b>Method 3: Pulumi Configuration</b>

```bash
pulumi config set azure:clientId <appId> --secret
pulumi config set azure:clientSecret <password> --secret
pulumi config set azure:tenantId <tenant> --secret
pulumi config set azure:subscriptionId <subscription-id>

# Also set for azure-native provider
pulumi config set azure-native:clientId <appId> --secret
pulumi config set azure-native:clientSecret <password> --secret
pulumi config set azure-native:tenantId <tenant> --secret
pulumi config set azure-native:subscriptionId <subscription-id>
```
</details>

### 4. Configure SSH Key Pair

Generate an SSH key pair for connecting to Azure VMs:

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_azure
```

Update the SSH public key in your Pulumi configuration:

```bash
pulumi config set azureSshPublicKey "$(cat ~/.ssh/id_rsa_azure.pub)"
```

---

## Deployment

### 1. Set Up Pulumi Stack
Pulumi uses "stacks" to manage environments like dev and prod.

#### Initialize the Azure Development Stack
```bash
pulumi stack init azure-dev
```

Verify the stack:

```bash
pulumi stack
```

#### Configure Stack Settings
Create or update your `Pulumi.azure-dev.yaml` configuration:

```bash
cat > Pulumi.azure-dev.yaml << 'EOF'
config:
  pulumi-multicloud:cloudProvider: azure
  pulumi-multicloud:azureRegion: "eastus"
  pulumi-multicloud:resourceGroupName: "digicred-resource-group"
  pulumi-multicloud:azureSubscriptionId: "<subscription-id>"
  pulumi-multicloud:azureTenantId: "<tenant-id>"
  pulumi-multicloud:azureVnetCidr: "10.1.0.0/16"
  pulumi-multicloud:azureSshSourceAddressPrefixes:
    - "0.0.0.0/0"
  pulumi-multicloud:azurePublicSubnetCidrs:
    - "10.1.1.0/24"
    - "10.1.3.0/24"
  pulumi-multicloud:azurePrivateSubnetCidrs:
    - "10.1.2.0/24"
    - "10.1.4.0/24"
  pulumi-multicloud:azureCurrentIpAddressForKeyVault: "0.0.0.0/0"
  pulumi-multicloud:azurePulumiServicePrincipalObjectId: "<sp-object-id>"
  pulumi-multicloud:azureAdminUsername: "azureuser"
  pulumi-multicloud:azureSshPublicKey: "<your-ssh-public-key>"
  pulumi-multicloud:azureLetsEncryptEmail: "your-email@example.com"
  pulumi-multicloud:azureWebServerDNS: "azure.example.com"
EOF
```

> **Note:** 
> - Replace `<subscription-id>`, `<tenant-id>`, `<sp-object-id>`, `<your-ssh-public-key>` with your actual values.
> - Get your service principal's Object ID with: `az ad sp list --display-name "PulumiDeployment" --query "[].id" -o tsv`

### 2. Preview the Deployment
Preview what resources will be created:

```bash
pulumi preview
```

This dry-run shows all resources without making changes.

### 3. Deploy the Environment
Deploy the stack to Azure:

```bash
pulumi up
```

Confirm the changes when prompted (type `yes`).

#### Deployment Outputs
After successful deployment, Pulumi will output important values:
- `webPublicIp`: The public IP address of the web instance
- `tractionPrivateIp`: The private IP of the traction instance
- `controllerPrivateIp`: The private IP of the controller instance

### 4. Production Deployment
For a production environment:

```bash
pulumi stack init azure-prod
```

Create `Pulumi.azure-prod.yaml` with production-specific settings:

```bash
cat > Pulumi.azure-prod.yaml << 'EOF'
config:
  pulumi-multicloud:cloudProvider: azure
  pulumi-multicloud:azureRegion: "eastus2"
  pulumi-multicloud:resourceGroupName: "digicred-prod-resource-group"
  # Add production-specific settings here, similar to dev but with appropriate values
EOF
```

Deploy the production stack:

```bash
pulumi stack select azure-prod
pulumi up
```

### 5. Configure DNS

After deployment, use the `webPublicIp` output value to configure your DNS:

```bash
# Create an A record in your DNS provider's dashboard
# Point your domain (e.g., azure.example.com) to the web instance public IP address
```

### 6. Cleanup
To destroy a stack and remove all resources:

```bash
pulumi destroy
```

When completely finished with a stack:

```bash
pulumi stack rm <stack-name>
```

---

## Troubleshooting

### Common Issues and Solutions

<details>
<summary><b>1. Azure Authentication Issues</b></summary>
<br>
<b>Problem</b>: <code>Error: Error building account: Failed to get authenticated object ID</code>  
<b>Solution</b>: 
<ul>
  <li>Verify Azure credentials are configured correctly:
    <pre>az account show</pre>
  </li>
  <li>Check service principal permissions:
    <pre>az role assignment list --assignee &lt;client-id&gt; --output table</pre>
  </li>
  <li>Set temporary credentials if needed:
    <pre>export ARM_CLIENT_ID=&lt;client-id&gt;
export ARM_CLIENT_SECRET=&lt;client-secret&gt;
export ARM_TENANT_ID=&lt;tenant-id&gt;
export ARM_SUBSCRIPTION_ID=&lt;subscription-id&gt;</pre>
  </li>
</ul>
</details>

<details>
<summary><b>2. Key Vault Deletion/Recreation Issues</b></summary>
<br>
<b>Problem</b>: <code>The specified vault name is already in use</code> or <code>The vault is marked for deletion</code>  
<b>Solution</b>:
<ul>
 <li>Check if the Key Vault exists and is marked for deletion:
    <pre>az keyvault list-deleted --query "[].name"</pre>
  </li>
  <li>Purge the deleted Key Vault (if listed as deleted):
    <pre>az keyvault purge --name &lt;key-vault-name&gt;</pre>
  </li>
  <li>If the Key Vault is not in the deleted list but you still can't create it, wait for Azure's deletion process to complete (can take a few minutes).</li>
</ul>
</details>

<details>
<summary><b>3. VM Connectivity Issues</b></summary>
<br>
<b>Problem</b>: Cannot connect to VMs after deployment  
<b>Solution</b>:
<ul>
  <li>Verify the NSG rules are correctly configured:
    <pre>az network nsg rule list --nsg-name web-nsg -g &lt;resource-group&gt; -o table</pre>
  </li>
  <li>Check if the VM is running:
    <pre>az vm list -d -g &lt;resource-group&gt; -o table</pre>
  </li>
  <li>Try connecting with the correct username and SSH key:
    <pre>ssh -i ~/.ssh/id_rsa_azure azureuser@&lt;web-public-ip&gt;</pre>
  </li>
</ul>
</details>

<details>
<summary><b>4. NAT Gateway Issues</b></summary>
<br>
<b>Problem</b>: Private instances cannot connect to the internet  
<b>Solution</b>:
<ul>
  <li>Verify NAT Gateway is correctly associated with private subnets:
    <pre>az network vnet subnet show -g &lt;resource-group&gt; --vnet-name main-vnet --name private-subnet-0</pre>
  </li>
  <li>SSH to the web VM, then to a private VM to check connectivity:
    <pre>ssh -i ~/.ssh/id_rsa_azure azureuser@&lt;web-public-ip&gt;
ssh azureuser@&lt;traction-private-ip&gt;
ping google.com</pre>
  </li>
</ul>
</details>

<details>
<summary><b>5. Resource Group Deletion Issues</b></summary>
<br>
<b>Problem</b>: <code>Could not delete resource group</code>  
<b>Solution</b>:
<ul>
  <li>List all resources in the group to identify what might be blocking deletion:
    <pre>az resource list -g &lt;resource-group&gt; -o table</pre>
  </li>
  <li>Check for resources with delete locks:
    <pre>az lock list -g &lt;resource-group&gt; -o table</pre>
  </li>
</ul>
</details>

### Additional Tips

<details>
<summary><b>Check VM Logs</b></summary>
<br>
<pre>
# Connect to the VM
ssh -i ~/.ssh/id_rsa_azure azureuser@&lt;vm-ip&gt;

# Check cloud-init logs for startup issues
sudo cat /var/log/cloud-init-output.log
</pre>
</details>

<details>
<summary><b>Troubleshoot Nginx SSL</b></summary>
<br>
<pre>
# Check Nginx configuration
sudo nginx -t       # Test configuration syntax
sudo nginx -T       # Check entire configuration

# Check Let's Encrypt logs
sudo cat /var/log/letsencrypt/letsencrypt.log

# Check certificates
sudo certbot certificates
</pre>
</details>

<details>
<summary><b>Monitor Resource Status</b></summary>
<br>
<pre>
# List all resources in the resource group
az resource list --resource-group &lt;resource-group&gt; --output table

# Get details of the VNet
az network vnet show --name main-vnet --resource-group &lt;resource-group&gt;

# List all subnets
az network vnet subnet list --vnet-name main-vnet --resource-group &lt;resource-group&gt; --output table

# Check NAT gateway
az network nat gateway show --name nat-gw --resource-group &lt;resource-group&gt;
</pre>
</details>

---

## Project Structure

```
pulumi-multicloud/
├── src/                         # Source code
│   ├── index.ts                 # Main entry point
│   ├── azure/                   # Azure-specific code
│   │   ├── base-infra.ts        # VNet, subnets, NAT gateway
│   │   ├── security-secrets.ts  # NSGs, Key Vault, and Managed Identity
│   │   ├── vm-instances.ts      # VM deployment orchestration
│   │   └── instances/           # Instance configurations
│   │       ├── types.ts         # Type definitions
│   │       ├── web.ts           # Web instance configuration
│   │       └── app.ts           # Application instances
├── assets/                      # Project assets
│   ├── azure-architecture-conceptual.png  # Architecture diagram
│   ├── digicred-logo.png        # Company logo
│   ├── logo-pulumi.png          # Pulumi logo
│   └── azure-logo.png           # Azure logo
├── Pulumi.yaml                  # Project configuration
├── Pulumi.azure-dev.yaml        # Development stack settings
├── Pulumi.azure-prod.yaml       # Production stack settings
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies and scripts
```

---

## License

<div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; border-left: 4px solid #2671E5;">
  This project is licensed under the Apache License, Version 2.0. See the <a href="LICENSE">LICENSE</a> file included in the repository for the full license text.
</div>

---

<div align="center">
  Created and maintained by <a href="https://github.com/Nas2020">Nas Til</a>
  <br><br>
  <a href="#-pulumi-multi-cloud-infrastructure-for-azure-">Back to top ⬆️</a>
</div> -->

<div align="center">
  <h1>✨ Pulumi Multi-Cloud Infrastructure for Azure ✨</h1>
  <p><a href="README-AWS.md">Looking for AWS deployment? Click here</a></p>
</div>
<div align="center">
  <a href="https://digicred.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/digicred-logo.png" alt="DigiCred Logo" height="100" style="margin-right: 20px;" />
  </a>
  <a href="https://pulumi.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/logo-pulumi.png" alt="Pulumi Logo" height="100" />
  </a>
  <a href="https://azure.microsoft.com" target="_blank" rel="noopener noreferrer">
    <img src="/assets/azure-logo.png" alt="Azure Logo" height="100" />
  </a>
  <br><br>
  <p>
    <a href="#project-overview"><strong>Overview</strong></a> •
    <a href="#architecture"><strong>Architecture</strong></a> •
    <a href="#prerequisites"><strong>Prerequisites</strong></a> •
    <a href="#setup-instructions"><strong>Setup</strong></a> •
    <a href="#deployment"><strong>Deployment</strong></a> •
    <a href="#troubleshooting"><strong>Troubleshooting</strong></a>
  </p>
  <p>
    <img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-4.9+-blue?logo=typescript">
    <img alt="Pulumi" src="https://img.shields.io/badge/Pulumi-3.0+-blueviolet?logo=pulumi">
    <img alt="Azure" src="https://img.shields.io/badge/Azure-Supported-blue?logo=microsoft-azure">
  </p>
</div>
<hr>

This project uses **Pulumi** with **TypeScript** to deploy Infrastructure as Code (IaC) for Microsoft Azure. This README provides instructions to set up and run the project locally on macOS or Linux, deploy to Azure for development and production environments, and an overview of the architecture and file structure. This is part of a multi-cloud project that also supports [AWS deployments](README-AWS.md).

## Table of Contents
- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup Instructions](#setup-instructions)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [License](#license)

---

## Project Overview

This project leverages Pulumi and TypeScript to deploy a scalable Azure infrastructure designed with a Virtual Network, multiple subnets, NAT Gateway, and dedicated virtual machines for different application tiers. The infrastructure includes secure networking, key vault for secrets management, and managed identities for enhanced security.

### Key Components

<table>
  <tr>
    <th width="200">Component</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>Virtual Network</b><br><code>main-vnet</code></td>
    <td>A Virtual Network providing an isolated network environment in Azure. The CIDR <code>10.1.0.0/16</code> supports up to 65,536 IP addresses, dynamically allocated across public and private subnets.</td>
  </tr>
  <tr>
    <td><b>Public Subnets</b></td>
    <td>Subnets hosting resources that require direct internet access, such as the <code>web-instance</code>. Each subnet resides in a distinct region for high availability.</td>
  </tr>
  <tr>
    <td><b>Private Subnets</b></td>
    <td>Subnets for resources requiring isolation from the public internet, such as the <code>traction-test-instance</code> and <code>controller-test-instance</code>. Each subnet is configured with NAT Gateway for outbound connectivity.</td>
  </tr>
  <tr>
    <td><b>NAT Gateway</b><br><code>nat-gw</code></td>
    <td>Provides outbound internet connectivity for private subnet resources while maintaining security by not exposing them directly to the internet.</td>
  </tr>
  <tr>
    <td><b>Network Security Groups</b></td>
    <td>
      <ul>
        <li><b>Web NSG</b>: Controls traffic to public-facing resources</li>
        <li><b>App NSG</b>: Controls traffic to application tier resources</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td><b>Key Vault</b></td>
    <td>Securely stores sensitive information like credentials and certificates with RBAC-based access control.</td>
  </tr>
  <tr>
    <td><b>Managed Identity</b></td>
    <td>Provides Azure Active Directory-based authentication for VMs without storing credentials in code or configuration.</td>
  </tr>
  <tr>
    <td><b>Virtual Machines</b></td>
    <td>
      <ul>
        <li><b>Web Instance</b>: Configured with Nginx as a reverse proxy in a public subnet</li>
        <li><b>Traction Instance</b>: Hosting application services in a private subnet</li>
        <li><b>Controller Instance</b>: Hosting control services in a private subnet</li>
      </ul>
    </td>
  </tr>
</table>

---

## Architecture

The architecture follows a multi-tier design with public-facing and private service layers deployed for enhanced security.

### Conceptual Architecture

<div align="center">
  <img src="/assets/azure-architecture-conceptual.png" alt="Azure Architecture Conceptual" width="800" style="border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
</div>

### Network Architecture

<table>
  <tr>
    <th width="200">Component</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>Security Layers</b></td>
    <td>Combination of Network Security Groups, private subnets, and Key Vault firewalls to secure resources.</td>
  </tr>
  <tr>
    <td><b>Proxy Architecture</b></td>
    <td>Web VM with Nginx in the public subnet acts as the entry point, proxying traffic to private instances.</td>
  </tr>
  <tr>
    <td><b>Managed Identity</b></td>
    <td>VMs use managed identities to access Key Vault secrets without embedded credentials.</td>
  </tr>
</table>

---

## Prerequisites

Before you begin, ensure you have the following installed:

<table>
  <tr>
    <th width="200">Requirement</th>
    <th>Details</th>
  </tr>
  <tr>
    <td><b>Node.js</b></td>
    <td>v18 or later - <a href="https://nodejs.org/">Download</a></td>
  </tr>
  <tr>
    <td><b>pnpm</b></td>
    <td>v8 or later - Install with <code>npm install -g pnpm</code></td>
  </tr>
  <tr>
    <td><b>Pulumi CLI</b></td>
    <td>v3 or later - <a href="https://www.pulumi.com/docs/get-started/install/">Installation Guide</a></td>
  </tr>
  <tr>
    <td><b>Azure CLI</b></td>
    <td>Latest version - <a href="https://docs.microsoft.com/en-us/cli/azure/install-azure-cli">Installation Guide</a></td>
  </tr>
  <tr>
    <td><b>Azure Account</b></td>
    <td>Active subscription with Contributor access</td>
  </tr>
  <tr>
    <td><b>TypeScript</b></td>
    <td>Included via project dependencies</td>
  </tr>
</table>

### Optional
- **Docker** (for testing locally, if needed)
- **Git** (to clone and manage this repository)

---

## Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/<your-username>/pulumi-multicloud.git
cd pulumi-multicloud
```

### 2. Install Dependencies
Install the project dependencies using pnpm (recommended for consistency):

```bash
pnpm install
```

Alternatively, use npm if preferred:

```bash
npm install
```

> **Note:**
> - macOS/Linux: These commands work natively in Terminal.
> - Windows: Use Command Prompt, PowerShell, or a Unix-like shell (e.g., Git Bash, WSL). Ensure Node.js and pnpm/npm are in your PATH.

### 3. Configure Azure Credentials

<details>
<summary><b>Option 1: Azure CLI Authentication</b> (click to expand)</summary>
<br>
Log in to Azure using the Azure CLI:

```bash
az login
```

This will open a browser window for authentication. After successful login, list your subscriptions:

```bash
az account list --output table
```

Set your active subscription:

```bash
az account set --subscription "<subscription-id>"
```

This is the simplest method but uses your personal credentials.
</details>

<details>
<summary><b>Option 2: Service Principal Authentication (Recommended)</b> (click to expand)</summary>
<br>
Create a Service Principal with Contributor rights to your subscription:

```bash
az ad sp create-for-rbac --name "PulumiDeployment" --role Contributor --scopes /subscriptions/<subscription-id>
```

This will output credentials including `appId` (Client ID), `password` (Client Secret), and `tenant` (Tenant ID).

Configure Pulumi to use these credentials:

<b>Method 1: Environment Variables</b>

```bash
export ARM_CLIENT_ID=<appId>
export ARM_CLIENT_SECRET=<password>
export ARM_TENANT_ID=<tenant>
export ARM_SUBSCRIPTION_ID=<subscription-id>
```

<b>Method 2: Create a helper script (for convenience)</b>

```bash
cat > run-pulumi-azure.sh << 'EOF'
#!/bin/bash
export ARM_CLIENT_ID="<appId>"
export ARM_CLIENT_SECRET="<password>"
export ARM_TENANT_ID="<tenant>"
export ARM_SUBSCRIPTION_ID="<subscription-id>"
# Run pulumi command with the provided arguments
pulumi "$@"
EOF

chmod +x run-pulumi-azure.sh
```

<b>Method 3: Pulumi Configuration</b>

```bash
pulumi config set azure:clientId <appId> --secret
pulumi config set azure:clientSecret <password> --secret
pulumi config set azure:tenantId <tenant> --secret
pulumi config set azure:subscriptionId <subscription-id>

# Also set for azure-native provider
pulumi config set azure-native:clientId <appId> --secret
pulumi config set azure-native:clientSecret <password> --secret
pulumi config set azure-native:tenantId <tenant> --secret
pulumi config set azure-native:subscriptionId <subscription-id>
```
</details>

### 4. Configure SSH Key Pair

Generate an SSH key pair for connecting to Azure VMs:

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_azure
```

Update the SSH public key in your Pulumi configuration:

```bash
pulumi config set azureSshPublicKey "$(cat ~/.ssh/id_rsa_azure.pub)"
```

---

## Deployment

### 1. Set Up Pulumi Stack
Pulumi uses "stacks" to manage environments like dev and prod.

#### Initialize the Azure Development Stack
```bash
pulumi stack init azure-dev
```

Verify the stack:

```bash
pulumi stack
```

#### Configure Stack Settings
Create or update your `Pulumi.azure-dev.yaml` configuration:

```bash
cat > Pulumi.azure-dev.yaml << 'EOF'
config:
  pulumi-multicloud:cloudProvider: azure
  pulumi-multicloud:azureRegion: "eastus"
  pulumi-multicloud:resourceGroupName: "digicred-resource-group"
  pulumi-multicloud:azureSubscriptionId: "<subscription-id>"
  pulumi-multicloud:azureTenantId: "<tenant-id>"
  pulumi-multicloud:azureVnetCidr: "10.1.0.0/16"
  pulumi-multicloud:azureSshSourceAddressPrefixes:
    - "0.0.0.0/0"
  pulumi-multicloud:azurePublicSubnetCidrs:
    - "10.1.1.0/24"
    - "10.1.3.0/24"
  pulumi-multicloud:azurePrivateSubnetCidrs:
    - "10.1.2.0/24"
    - "10.1.4.0/24"
  pulumi-multicloud:azureCurrentIpAddressForKeyVault: "0.0.0.0/0"
  pulumi-multicloud:azurePulumiServicePrincipalObjectId: "<sp-object-id>"
  pulumi-multicloud:azureAdminUsername: "azureuser"
  pulumi-multicloud:azureSshPublicKey: "<your-ssh-public-key>"
  pulumi-multicloud:azureLetsEncryptEmail: "your-email@example.com"
  pulumi-multicloud:azureWebServerDNS: "azure.example.com"
EOF
```

> **Note:** 
> - Replace `<subscription-id>`, `<tenant-id>`, `<sp-object-id>`, `<your-ssh-public-key>` with your actual values.
> - Get your service principal's Object ID with: `az ad sp list --display-name "PulumiDeployment" --query "[].id" -o tsv`

### 2. Preview the Deployment
Preview what resources will be created:

```bash
pulumi preview
```

This dry-run shows all resources without making changes.

### 3. Deploy the Environment
Deploy the stack to Azure:

```bash
pulumi up
```

Confirm the changes when prompted (type `yes`).

#### Deployment Outputs
After successful deployment, Pulumi will output important values:
- `webPublicIp`: The public IP address of the web instance
- `tractionPrivateIp`: The private IP of the traction instance
- `controllerPrivateIp`: The private IP of the controller instance

### 4. Production Deployment
For a production environment:

```bash
pulumi stack init azure-prod
```

Create `Pulumi.azure-prod.yaml` with production-specific settings:

```bash
cat > Pulumi.azure-prod.yaml << 'EOF'
config:
  pulumi-multicloud:cloudProvider: azure
  pulumi-multicloud:azureRegion: "eastus2"
  pulumi-multicloud:resourceGroupName: "digicred-prod-resource-group"
  # Add production-specific settings here, similar to dev but with appropriate values
EOF
```

Deploy the production stack:

```bash
pulumi stack select azure-prod
pulumi up
```

### 5. Configure DNS

After deployment, use the `webPublicIp` output value to configure your DNS:

```bash
# Create an A record in your DNS provider's dashboard
# Point your domain (e.g., azure.example.com) to the web instance public IP address
```

### 6. Cleanup
To destroy a stack and remove all resources:

```bash
pulumi destroy
```

When completely finished with a stack:

```bash
pulumi stack rm <stack-name>
```

---

## Troubleshooting

### Common Issues and Solutions

<details>
<summary><b>1. Azure Authentication Issues</b></summary>
<br>
<b>Problem</b>: <code>Error: Error building account: Failed to get authenticated object ID</code>  
<b>Solution</b>: 
<ul>
  <li>Verify Azure credentials are configured correctly:
    <pre>az account show</pre>
  </li>
  <li>Check service principal permissions:
    <pre>az role assignment list --assignee &lt;client-id&gt; --output table</pre>
  </li>
  <li>Set temporary credentials if needed:
    <pre>export ARM_CLIENT_ID=&lt;client-id&gt;
export ARM_CLIENT_SECRET=&lt;client-secret&gt;
export ARM_TENANT_ID=&lt;tenant-id&gt;
export ARM_SUBSCRIPTION_ID=&lt;subscription-id&gt;</pre>
  </li>
</ul>
</details>

<details>
<summary><b>2. Key Vault Deletion/Recreation Issues</b></summary>
<br>
<b>Problem</b>: <code>The specified vault name is already in use</code> or <code>The vault is marked for deletion</code>  
<b>Solution</b>:
<ul>
 <li>Check if the Key Vault exists and is marked for deletion:
    <pre>az keyvault list-deleted --query "[].name"</pre>
  </li>
  <li>Purge the deleted Key Vault (if listed as deleted):
    <pre>az keyvault purge --name &lt;key-vault-name&gt;</pre>
  </li>
  <li>If the Key Vault is not in the deleted list but you still can't create it, wait for Azure's deletion process to complete (can take a few minutes).</li>
</ul>
</details>

<details>
<summary><b>3. VM Connectivity Issues</b></summary>
<br>
<b>Problem</b>: Cannot connect to VMs after deployment  
<b>Solution</b>:
<ul>
  <li>Verify the NSG rules are correctly configured:
    <pre>az network nsg rule list --nsg-name web-nsg -g &lt;resource-group&gt; -o table</pre>
  </li>
  <li>Check if the VM is running:
    <pre>az vm list -d -g &lt;resource-group&gt; -o table</pre>
  </li>
  <li>Try connecting with the correct username and SSH key:
    <pre>ssh -i ~/.ssh/id_rsa_azure azureuser@&lt;web-public-ip&gt;</pre>
  </li>
</ul>
</details>

<details>
<summary><b>4. NAT Gateway Issues</b></summary>
<br>
<b>Problem</b>: Private instances cannot connect to the internet  
<b>Solution</b>:
<ul>
  <li>Verify NAT Gateway is correctly associated with private subnets:
    <pre>az network vnet subnet show -g &lt;resource-group&gt; --vnet-name main-vnet --name private-subnet-0</pre>
  </li>
  <li>SSH to the web VM, then to a private VM to check connectivity:
    <pre>ssh -i ~/.ssh/id_rsa_azure azureuser@&lt;web-public-ip&gt;
ssh azureuser@&lt;traction-private-ip&gt;
ping google.com</pre>
  </li>
</ul>
</details>

<details>
<summary><b>5. Resource Group Deletion Issues</b></summary>
<br>
<b>Problem</b>: <code>Could not delete resource group</code>  
<b>Solution</b>:
<ul>
  <li>List all resources in the group to identify what might be blocking deletion:
    <pre>az resource list -g &lt;resource-group&gt; -o table</pre>
  </li>
  <li>Check for resources with delete locks:
    <pre>az lock list -g &lt;resource-group&gt; -o table</pre>
  </li>
</ul>
</details>

### Additional Tips

<details>
<summary><b>Check VM Logs</b></summary>
<br>
<pre>
# Connect to the VM
ssh -i ~/.ssh/id_rsa_azure azureuser@&lt;vm-ip&gt;

# Check cloud-init logs for startup issues
sudo cat /var/log/cloud-init-output.log
</pre>
</details>

<details>
<summary><b>Troubleshoot Nginx SSL</b></summary>
<br>
<pre>
# Check Nginx configuration
sudo nginx -t       # Test configuration syntax
sudo nginx -T       # Check entire configuration

# Check Let's Encrypt logs
sudo cat /var/log/letsencrypt/letsencrypt.log

# Check certificates
sudo certbot certificates
</pre>
</details>

<details>
<summary><b>Monitor Resource Status</b></summary>
<br>
<pre>
# List all resources in the resource group
az resource list --resource-group &lt;resource-group&gt; --output table

# Get details of the VNet
az network vnet show --name main-vnet --resource-group &lt;resource-group&gt;

# List all subnets
az network vnet subnet list --vnet-name main-vnet --resource-group &lt;resource-group&gt; --output table

# Check NAT gateway
az network nat gateway show --name nat-gw --resource-group &lt;resource-group&gt;
</pre>
</details>

---

## Project Structure

```
pulumi-multicloud/
├── src/                         # Source code
│   ├── index.ts                 # Main entry point
│   ├── azure/                   # Azure-specific code
│   │   ├── base-infra.ts        # VNet, subnets, NAT gateway
│   │   ├── security-secrets.ts  # NSGs, Key Vault, and Managed Identity
│   │   ├── vm-instances.ts      # VM deployment orchestration
│   │   └── instances/           # Instance configurations
│   │       ├── types.ts         # Type definitions
│   │       ├── web.ts           # Web instance configuration
│   │       └── app.ts           # Application instances
├── assets/                      # Project assets
│   ├── azure-architecture-conceptual.png  # Architecture diagram
│   ├── digicred-logo.png        # Company logo
│   ├── logo-pulumi.png          # Pulumi logo
│   └── azure-logo.png           # Azure logo
├── Pulumi.yaml                  # Project configuration
├── Pulumi.azure-dev.yaml        # Development stack settings
├── Pulumi.azure-prod.yaml       # Production stack settings
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies and scripts
```

---

## License

<div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; border-left: 4px solid #2671E5;">
  This project is licensed under the Apache License, Version 2.0. See the <a href="LICENSE">LICENSE</a> file included in the repository for the full license text.
</div>

---

<div align="center">
  Created and maintained by <a href="https://github.com/Nas2020">Nas Til</a>
  <br><br>
  <a href="#-pulumi-multi-cloud-infrastructure-for-azure-">Back to top ⬆️</a>
</div>