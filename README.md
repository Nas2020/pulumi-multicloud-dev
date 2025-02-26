# ✨ Pulumi Multi-Cloud Infrastructure ✨

<div align="center">
  <a href="https://digicred.com" target="_blank">
    <img src="/assets/digicred logo.png" alt="DigiCred Logo" height="100" style="margin-right: 20px;" />
  </a>
  <a href="https://pulumi.com" target="_blank">
    <img src="/assets/logo-pulumi.png" alt="Pulumi Logo" height="100" />
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
    <img alt="AWS" src="https://img.shields.io/badge/AWS-Supported-orange?logo=amazon-aws">
    <img alt="Azure" src="https://img.shields.io/badge/Azure-Planned-lightgrey?logo=microsoft-azure">
  </p>
</div>
<hr>

<hr>

This project uses **Pulumi** with **TypeScript** to deploy Infrastructure as Code (IaC) for multi-cloud resources. Currently, it supports **AWS**, with plans to add **Azure** in the future. This README provides instructions to set up and run the project locally on macOS or Linux, deploy to AWS for development and production environments, and an overview of the architecture and file structure.

## Table of Contents
- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup Instructions](#setup-instructions)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Future Plans](#future-plans)
- [Project Structure](#project-structure)
- [License](#license)

---

## Project Overview

This project leverages Pulumi and TypeScript to deploy a scalable AWS infrastructure within a multi-AZ Virtual Private Cloud (VPC), designed as the foundation for a future multi-cloud system (Azure support planned). It provisions networking, security, and EC2 instances to support a multi-tier application architecture, with Nginx acting as a reverse proxy for backend services.

### Key Components

<table>
  <tr>
    <th width="200">Component</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>VPC</b><br><code>main-vpc</code></td>
    <td>A Virtual Private Cloud providing an isolated network environment in AWS. The CIDR <code>10.0.0.0/16</code> supports up to 65,536 IP addresses, dynamically allocated across public and private subnets in multiple Availability Zones.</td>
  </tr>
  <tr>
    <td><b>Public Subnets</b></td>
    <td>Subnets hosting resources that require direct internet access, such as the <code>nginx-instance</code>. Each subnet resides in a distinct Availability Zone for high availability.</td>
  </tr>
  <tr>
    <td><b>Private Subnets</b></td>
    <td>Subnets for resources requiring isolation from the public internet, such as the <code>traction-test-instance</code> and <code>controller-test-instance</code>. Each subnet is in a separate AZ, enhancing resilience.</td>
  </tr>
  <tr>
    <td><b>Internet Gateway</b><br><code>main-igw</code></td>
    <td>A gateway connecting the VPC to the internet, essential for public subnets.</td>
  </tr>
  <tr>
    <td><b>Route Tables</b></td>
    <td>
      <ul>
        <li><b>Public Route Table</b>: Routes traffic to the Internet Gateway</li>
        <li><b>Private Route Tables</b>: Route outbound traffic to NAT Gateways</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td><b>NAT Gateways</b></td>
    <td>Deployed in each public subnet with Elastic IPs, these gateways allow private subnet instances to access the internet for outbound traffic without exposing them to inbound connections.</td>
  </tr>
  <tr>
    <td><b>EC2 Instances</b></td>
    <td>
      <ul>
        <li><b>Nginx Instance</b>: Configured as a reverse proxy for routing traffic to backend services</li>
        <li><b>Traction Instance</b>: Hosting application services in a private subnet</li>
        <li><b>Controller Instance</b>: Hosting control services in a private subnet</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td><b>Secrets Management</b></td>
    <td>AWS Secrets Manager stores sensitive data, accessible by EC2 instances via IAM roles and instance profiles.</td>
  </tr>
</table>

---

## Architecture

The architecture follows a multi-tier design with public-facing and private service layers deployed across multiple availability zones for high availability.

### Conceptual Architecture

<div align="center">
  <img src="/assets/aws-architecture-conceptual.png" alt="AWS Architecture Conceptual" width="800" style="border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
</div>

### Network Architecture

<table>
  <tr>
    <th width="200">Component</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><b>Multi-AZ Design</b></td>
    <td>Resources are distributed across availability zones (<code>us-east-1a</code>, <code>us-east-1b</code> by default) for high availability.</td>
  </tr>
  <tr>
    <td><b>Security Layers</b></td>
    <td>Combination of Security Groups, NACLs, and private subnets to secure instances.</td>
  </tr>
  <tr>
    <td><b>Proxy Architecture</b></td>
    <td>Nginx instance in the public subnet acts as the entry point, proxying traffic to private instances.</td>
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
    <td><b>AWS CLI</b></td>
    <td>v2 or later - <a href="https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html">Installation Guide</a></td>
  </tr>
  <tr>
    <td><b>AWS Account</b></td>
    <td>Configured with access keys or IAM role</td>
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

### 3. Configure AWS Credentials
Set up your AWS credentials locally to allow Pulumi to interact with your AWS account:

<details>
<summary><b>Option 1: AWS CLI Configuration</b> (click to expand)</summary>
<br>
Run:

```bash
aws configure
```

Enter your AWS Access Key ID, Secret Access Key, default region (e.g., us-east-1), and output format (e.g., json). This creates a credentials file at ~/.aws/credentials (Linux/macOS) or %USERPROFILE%\.aws\credentials (Windows).
</details>

<details>
<summary><b>Option 2: Environment Variables</b> (click to expand)</summary>
<br>
Export credentials directly (useful for scripting or CI/CD):

<b>Linux/macOS:</b>
```bash
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-key>
export AWS_REGION=us-east-1
```

<b>Windows (Command Prompt):</b>
```cmd
set AWS_ACCESS_KEY_ID=<your-access-key>
set AWS_SECRET_ACCESS_KEY=<your-secret-key>
set AWS_REGION=us-east-1
```

<b>Windows (PowerShell):</b>
```powershell
$env:AWS_ACCESS_KEY_ID = "<your-access-key>"
$env:AWS_SECRET_ACCESS_KEY = "<your-secret-key>"
$env:AWS_REGION = "us-east-1"
```
</details>

> **Note:** Ensure your AWS account has sufficient permissions (e.g., EC2, VPC, Secrets Manager) via an IAM role or user.

---

## Deployment

### 1. Set Up Pulumi Stack
Pulumi uses "stacks" to manage environments like dev and prod. The project includes Pulumi.dev.yaml for development settings.

#### Initialize the Development Stack
```bash
pulumi stack init dev
```

This creates a dev stack, using Pulumi.dev.yaml as the configuration source. Verify the stack:

```bash
pulumi stack
```

#### Configure Stack Settings
Review default configuration in Pulumi.dev.yaml. To override any settings:

```bash
pulumi config set cloudProvider aws
pulumi config set awsAvailabilityZones --json '["us-east-1a", "us-east-1b"]'
```

> **Note:**
> - macOS/Linux: Run these in Terminal.
> - Windows: In PowerShell, escape the JSON quotes:
>   ```powershell
>   pulumi config set awsAvailabilityZones --json '[\"us-east-1a\", \"us-east-1b\"]'
>   ```

### 2. Preview the Deployment
Preview what resources will be created:

```bash
pulumi preview
```

This dry-run shows all resources without making changes.

### 3. Deploy the Environment
Deploy the stack to AWS:

```bash
pulumi up
```

Confirm the changes when prompted (type `yes`).

#### Deployment Outputs
After successful deployment, Pulumi will output important values:
- `nginxPublicIp`: The public IP address of the Nginx instance
- Other connection information for instances

### 4. Production Deployment
For a production environment:

```bash
pulumi stack init prod
cp Pulumi.dev.yaml Pulumi.prod.yaml
```

Edit Pulumi.prod.yaml with production-specific settings, then deploy:

```bash
pulumi stack select prod
pulumi up
```

### 5. Cleanup
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
<summary><b>1. AWS Credentials Issues</b></summary>
<br>
<b>Problem</b>: <code>Error: no AWS creds available</code>  
<b>Solution</b>: 
<ul>
  <li>Verify AWS credentials are configured correctly:
    <pre>aws sts get-caller-identity</pre>
  </li>
  <li>Set temporary credentials if needed:
    <pre>export AWS_ACCESS_KEY_ID=&lt;your-access-key&gt;
export AWS_SECRET_ACCESS_KEY=&lt;your-secret-key&gt;</pre>
  </li>
</ul>
</details>

<details>
<summary><b>2. Secrets Manager Conflict</b></summary>
<br>
<b>Problem</b>: <code>InvalidRequestException: You can't create this secret because a secret with this name is already scheduled for deletion.</code>  
<b>Solution</b>:
<ul>
  <li>Use a different name for the secret (recommended):
    <pre># Update the name in your Pulumi code</pre>
  </li>
  <li>Force delete the existing secret (if you want to reuse the name):
    <pre>aws secretsmanager delete-secret --secret-id app-secrets-v2 --region us-east-1 --force-delete-without-recovery</pre>
  </li>
</ul>
</details>

<details>
<summary><b>3. Nginx Configuration Issues</b></summary>
<br>
<b>Problem</b>: Nginx not working as expected after deployment  
<b>Solution</b>:
<ul>
  <li>SSH to the Nginx instance and verify configuration:
    <pre>sudo nginx -t       # Test configuration syntax
sudo nginx -T       # Check entire configuration
sudo cat /var/log/nginx-userdata.log  # Check startup logs</pre>
  </li>
</ul>
</details>

<details>
<summary><b>4. Stack Update Issues</b></summary>
<br>
<b>Problem</b>: <code>error: update failed</code>  
<b>Solution</b>:
<ul>
  <li>Run with more verbose logging:
    <pre>pulumi up --debug</pre>
  </li>
  <li>Try to update only specific resources:
    <pre>pulumi up --target=aws:ec2/instance:Instance::nginx-instance</pre>
  </li>
</ul>
</details>

<details>
<summary><b>5. VPC/Network Issues</b></summary>
<br>
<b>Problem</b>: Resources cannot communicate properly  
<b>Solution</b>:
<ul>
  <li>Verify security groups permit required traffic</li>
  <li>Check route tables and NAT gateways are correctly configured</li>
  <li>Ensure instances have the expected private IPs</li>
</ul>
</details>

### Additional Tips

<details>
<summary><b>Check Instance Logs</b></summary>
<br>
<pre>
# Connect to the instance
ssh ubuntu@&lt;instance-ip&gt;

# Check cloud-init logs for startup issues
sudo cat /var/log/cloud-init-output.log
</pre>
</details>

<details>
<summary><b>Troubleshoot Nginx SSL</b></summary>
<br>
<pre>
# Check Let's Encrypt logs
sudo cat /var/log/letsencrypt/letsencrypt.log

# Check certificate status
sudo certbot certificates
</pre>
</details>

<details>
<summary><b>Fix DNS Issues</b></summary>
<br>
Ensure your domain is correctly pointing to the Nginx public IP if you're using a custom domain with SSL.
</details>

---

## Future Plans

<div style="display: flex; flex-wrap: wrap; gap: 10px;">
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>📦 Azure Support</h3>
    <p>Add deployment options for Azure resources</p>
  </div>
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>🐳 Container Support</h3>
    <p>Enhance Docker support with container orchestration</p>
  </div>
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>🔄 CI/CD Integration</h3>
    <p>Automated deployment pipelines</p>
  </div>
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>📊 Monitoring</h3>
    <p>Add integrated monitoring and alerting</p>
  </div>
  <div style="flex: 1; min-width: 200px; border: 1px solid #ddd; border-radius: 8px; padding: 16px; background-color: #f9f9f9;">
    <h3>🔒 Backup & DR</h3>
    <p>Implement automated backup solutions</p>
  </div>
</div>

---

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
│   │       ├── types.ts         # Type definitions
│   │       ├── nginx.ts         # Nginx instance configuration
│   │       └── app.ts           # Application instances
├── assets/                      # Project assets
│   ├── aws-architecture-conceptual.png  # Architecture diagram
│   ├── digicred-logo.png        # Company logo
│   └── logo-pulumi.png          # Pulumi logo
├── Pulumi.yaml                  # Project configuration
├── Pulumi.dev.yaml              # Development stack settings
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
  <a href="#-pulumi-multi-cloud-infrastructure-">Back to top ⬆️</a>
</div>