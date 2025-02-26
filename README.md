# ✨ Pulumi Multi-Cloud Infrastructure ✨

<div align="center">
  <img src="https://digicred.com/assets/digicred-logo.png" alt="DigiCred Logo" height="100" style="margin-right: 20px;" />
  <img src="https://www.pulumi.com/assets/logo-pulumi.png" alt="Pulumi Logo" height="100" />
</div>

This project uses Pulumi with TypeScript to deploy Infrastructure as Code (IaC) for multi-cloud resources. Currently, it supports **AWS**, with plans to add **Azure** in the future. This README provides instructions to set up and run the project locally on macOS or Linux, deploy to AWS for development and production environments, and an overview of the architecture and file structure.

## Table of Contents
- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup Instructions](#setup-instructions)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Future Plans](#future-plans)

---

**[Scroll down to explore the full README](#project-overview)** or dive into the setup process below!

This project leverages Pulumi and TypeScript to deploy a scalable AWS infrastructure within a multi-AZ Virtual Private Cloud (VPC), designed as the foundation for a future multi-cloud system (Azure support planned). It provisions networking, security, and EC2 instances to support a multi-tier application architecture, with Nginx acting as a reverse proxy for backend services.

### Key Components

- **VPC**: `main-vpc` (CIDR: `10.0.0.0/16`)  
  A Virtual Private Cloud providing an isolated network environment in AWS. The CIDR `10.0.0.0/16` supports up to 65,536 IP addresses, dynamically allocated across public and private subnets in multiple Availability Zones.

- **Public Subnets**:  
  Subnets hosting resources that require direct internet access, such as the `nginx-instance`. Each subnet resides in a distinct Availability Zone for high availability.

- **Private Subnets**:  
  Subnets for resources requiring isolation from the public internet, such as the `traction-test-instance` and `controller-test-instance`. Each subnet is in a separate AZ, enhancing resilience.

- **Internet Gateway**: `main-igw`  
  A gateway connecting the VPC to the internet, essential for public subnets.

- **Route Tables**:  
  - **Public Route Table**: Routes traffic to the Internet Gateway  
  - **Private Route Tables**: Route outbound traffic to NAT Gateways

- **NAT Gateways**:  
  Deployed in each public subnet with Elastic IPs, these gateways allow private subnet instances to access the internet for outbound traffic without exposing them to inbound connections.

- **EC2 Instances**:  
  - **Nginx Instance**: Configured as a reverse proxy for routing traffic to backend services
  - **Traction Instance**: Hosting application services in a private subnet
  - **Controller Instance**: Hosting control services in a private subnet

- **Secrets Management**: AWS Secrets Manager  
  Stores sensitive data, accessible by EC2 instances via IAM roles and instance profiles.

---

## Architecture

The architecture follows a multi-tier design with public-facing and private service layers deployed across multiple availability zones for high availability.

### Conceptual Architecture

![AWS Architecture Conceptual](/assets/aws-architecture-conceptual.png)



### Network Architecture

- **Multi-AZ Design**: Resources are distributed across availability zones (`us-east-1a`, `us-east-1b` by default) for high availability.
- **Security Layers**: Combination of Security Groups, NACLs, and private subnets to secure instances.
- **Proxy Architecture**: Nginx instance in the public subnet acts as the entry point, proxying traffic to private instances.

---

## Prerequisites

Before you begin, ensure you have the following installed:
1. **Node.js** (v18 or later) - [Download](https://nodejs.org/)
2. **pnpm** (v8 or later) - Install with `npm install -g pnpm`
3. **Pulumi CLI** (v3 or later) - [Installation Guide](https://www.pulumi.com/docs/get-started/install/)
4. **AWS CLI** (v2 or later) - [Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
5. **AWS Account** - Configured with access keys or IAM role
6. **TypeScript** - Included via project dependencies

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

#### Option 1: AWS CLI Configuration
Run:
```bash
aws configure
```
Enter your AWS Access Key ID, Secret Access Key, default region (e.g., us-east-1), and output format (e.g., json). This creates a credentials file at ~/.aws/credentials (Linux/macOS) or %USERPROFILE%\.aws\credentials (Windows).

#### Option 2: Environment Variables
Export credentials directly (useful for scripting or CI/CD):

**Linux/macOS:**
```bash
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-key>
export AWS_REGION=us-east-1
```

**Windows (Command Prompt):**
```cmd
set AWS_ACCESS_KEY_ID=<your-access-key>
set AWS_SECRET_ACCESS_KEY=<your-secret-key>
set AWS_REGION=us-east-1
```

**Windows (PowerShell):**
```powershell
$env:AWS_ACCESS_KEY_ID = "<your-access-key>"
$env:AWS_SECRET_ACCESS_KEY = "<your-secret-key>"
$env:AWS_REGION = "us-east-1"
```

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

#### 1. AWS Credentials Issues
**Problem**: `Error: no AWS creds available`  
**Solution**: 
- Verify AWS credentials are configured correctly:
  ```bash
  aws sts get-caller-identity
  ```
- Set temporary credentials if needed:
  ```bash
  export AWS_ACCESS_KEY_ID=<your-access-key>
  export AWS_SECRET_ACCESS_KEY=<your-secret-key>
  ```

#### 2. Secrets Manager Conflict
**Problem**: `InvalidRequestException: You can't create this secret because a secret with this name is already scheduled for deletion.`  
**Solution**:
- Use a different name for the secret (recommended):
  ```bash
  # Update the name in your Pulumi code
  ```
- Force delete the existing secret (if you want to reuse the name):
  ```bash
  aws secretsmanager delete-secret --secret-id app-secrets-v2 --region us-east-1 --force-delete-without-recovery
  ```

#### 3. Nginx Configuration Issues
**Problem**: Nginx not working as expected after deployment  
**Solution**:
- SSH to the Nginx instance and verify configuration:
  ```bash
  sudo nginx -t       # Test configuration syntax
  sudo nginx -T       # Check entire configuration
  sudo cat /var/log/nginx-userdata.log  # Check startup logs
  ```

#### 4. Stack Update Issues
**Problem**: `error: update failed`  
**Solution**:
- Run with more verbose logging:
  ```bash
  pulumi up --debug
  ```
- Try to update only specific resources:
  ```bash
  pulumi up --target=aws:ec2/instance:Instance::nginx-instance
  ```

#### 5. VPC/Network Issues
**Problem**: Resources cannot communicate properly  
**Solution**:
- Verify security groups permit required traffic
- Check route tables and NAT gateways are correctly configured
- Ensure instances have the expected private IPs

### Additional Tips

- **Check Instance Logs**: 
  ```bash
  # Connect to the instance
  ssh ubuntu@<instance-ip>
  
  # Check cloud-init logs for startup issues
  sudo cat /var/log/cloud-init-output.log
  ```

- **Troubleshoot Nginx SSL**:
  ```bash
  # Check Let's Encrypt logs
  sudo cat /var/log/letsencrypt/letsencrypt.log
  
  # Check certificate status
  sudo certbot certificates
  ```

- **Fix DNS Issues**:
  Ensure your domain is correctly pointing to the Nginx public IP if you're using a custom domain with SSL.

---

## Future Plans

- **Azure Support**: Add deployment options for Azure resources
- **Container Support**: Enhance Docker support with container orchestration
- **CI/CD Integration**: Automated deployment pipelines
- **Monitoring**: Add integrated monitoring and alerting
- **Backup and Disaster Recovery**: Implement automated backup solutions

---

## Project Structure

```
pulumi-multicloud/
├── src/
│   ├── index.ts                  # Main entry point
│   ├── aws/
│   │   ├── base-infra.ts         # VPC, subnets, gateways, etc.
│   │   ├── ec2-instances.ts      # EC2 instance definitions
│   │   ├── security-secrets.ts   # Security groups and secrets
│   │   └── instances/
│   │       ├── types.ts          # Type definitions
│   │       ├── nginx.ts          # Nginx instance configuration
│   │       └── app.ts            # Application instances
├── assets/                       # Contains project images and diagrams
│   ├── AWS architecture conceptual.png  # Architecture diagram
│   └── digicred logo.png         # Company logo
├── Pulumi.yaml                   # Project configuration
├── Pulumi.dev.yaml               # Development stack settings
├── tsconfig.json                 # TypeScript configuration
└── package.json                  # Dependencies and scripts
```

---

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file included in the repository for the full license text.

---

Created and maintained by [Nas Til](https://github.com/Nas2020)