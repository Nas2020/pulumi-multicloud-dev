// File: src/aws/user-data-scripts.ts
import * as pulumi from "@pulumi/pulumi";

/**
 * Generates the basic system setup script for EC2 instances
 */

export function generateBaseSetupScript(instanceName: string, nginxPublicIp: string | pulumi.Output<string>): pulumi.Output<string> {
    return pulumi.interpolate`#!/bin/bash
set -ex
exec > >(tee /var/log/${instanceName}-userdata.log) 2>&1

echo "Starting ${instanceName} system setup at $(date)"

# Test internet connectivity
echo "Testing internet access..."
curl -s https://www.google.com > /dev/null && echo "Internet access confirmed" || echo "No internet access"

# Update system and install dependencies with max 5 retries
retry_count=5
until apt-get update; do
    if [ $retry_count -le 0 ]; then
        echo "apt-get update failed after 5 attempts at $(date)"
        exit 1
    fi
    echo "apt-get update failed. Retrying... ($retry_count attempts left)"
    retry_count=$(($retry_count - 1))
    sleep 2
done

retry_count=5
until apt-get install -y docker.io docker-compose git curl netcat-traditional netcat-openbsd nginx awscli jq; do
    if [ $retry_count -le 0 ]; then
        echo "apt-get install failed after 5 attempts at $(date)"
        exit 1
    fi
    echo "apt-get install failed. Retrying... ($retry_count attempts left)"
    retry_count=$(($retry_count - 1))
    sleep 2
done

# Configure docker with better failure handling
systemctl start docker || {
    echo "Failed to start Docker service at $(date)"
    systemctl status docker > /var/log/docker-failure.log
    exit 1
}
systemctl enable docker
usermod -aG docker ubuntu

# Wait for docker to be ready with detailed failure logging
timeout=60
until docker info >/dev/null 2>&1; do
    if [ $timeout -le 0 ]; then
        echo "Docker daemon failed to start after 60 seconds at $(date)"
        docker info --debug > /var/log/docker-startup-failure.log 2>&1 || true
        systemctl status docker >> /var/log/docker-startup-failure.log
        exit 1
    fi
    echo "Waiting for Docker daemon... ($timeout seconds remaining)"
    timeout=$(($timeout - 1))
    sleep 1
done

# Set NGINX public IP as environment variable
export PUBLIC_IP=${nginxPublicIp}
echo "Using IP: $PUBLIC_IP"
`;
}
/**
 * Generates the script for cloning and setting up the Traction application
 */
export function generateTractionAppSetupScript(
    region: string,
    secretArn: pulumi.Output<string>,
    configBucket: pulumi.Output<string>,
    configKey: pulumi.Output<string>,
    repoUrl: string = "https://github.com/Nas2020/dc-crms-docker.git"
): pulumi.Output<string> {
    return pulumi.interpolate`
# Clone the repository
mkdir -p /home/ubuntu
cd /home/ubuntu
git clone ${repoUrl}
cd /home/ubuntu/dc-crms-docker/digicred

# Download the config template from S3
echo "Downloading config template from S3..."
aws s3 cp s3://${configBucket}/${configKey} config-template.env

# Retrieve secrets from Secrets Manager
echo "Retrieving secrets from AWS Secrets Manager..."
aws secretsmanager get-secret-value --secret-id ${secretArn} --region ${region} --query SecretString --output text > /tmp/secrets.json
SECRETS_JSON=$(cat /tmp/secrets.json)
if [ ! -s "/tmp/secrets.json" ]; then
    echo "Error: Failed to retrieve secrets from AWS Secrets Manager"
    exit 1
fi

# Extract secret values with proper error handling
echo "Extracting secret values..."
extract_secret() {
    local key="$1"
    local value=$(jq -r ".[\\\"$key\\\"] // \\\"\\\"" /tmp/secrets.json)
    if [ -z "$value" ]; then
        echo "Warning: Secret $key not found, using empty value"
    fi
    echo "$value"
}

# Extract all needed secrets
TRACTION_SEED=$(extract_secret "TRACTION_SEED")
WALLET_KEY=$(extract_secret "TRACTION_ACAPY_WALLET_ENCRYPTION_KEY")
ADMIN_API_KEY=$(extract_secret "ACAPY_ADMIN_API_KEY")
JWT_SECRET=$(extract_secret "ACAPY_MULTITENANT_JWT_SECRET")
DB_PASSWORD=$(extract_secret "POSTGRESQL_PASSWORD")
INNKEEPER_WALLET_KEY=$(extract_secret "TRACTION_INNKEEPER_WALLET_KEY")
ENDORSER_SEED=$(extract_secret "ACAPY_ENDORSER_SEED")
ENDORSER_SEED_1=$(extract_secret "ACAPY_ENDORSER_SEED_1")
ENDORSER_API_KEY=$(extract_secret "ENDORSER_ACAPY_ADMIN_URL_API_KEY")
ENDORSER_WALLET_KEY=$(extract_secret "ENDORSER_ACAPY_WALLET_ENCRYPTION_KEY")
ENDORSER_WEBHOOK_API_KEY=$(extract_secret "ENDORSER_ACAPY_WEBHOOK_URL_API_KEY")
ENDORSER_PSQL_ADMIN_PWD=$(extract_secret "ENDORSER_PSQL_ADMIN_PWD")
ENDORSER_PSQL_USER_PWD=$(extract_secret "ENDORSER_PSQL_USER_PWD")

# Validate essential secrets
if [ -z "$TRACTION_SEED" ] || [ -z "$WALLET_KEY" ] || [ -z "$ADMIN_API_KEY" ]; then
    echo "Error: Missing essential secrets"
    exit 1
fi

# Create .env file by replacing placeholders in the template
echo "Creating environment file from template..."
cp config-template.env .env

# Replace placeholders with actual values
echo "Replacing placeholders in configuration..."
sed -i "s/__PUBLIC_IP__/$PUBLIC_IP/g" .env
sed -i "s/__ENDORSER_API_KEY__/$ENDORSER_API_KEY/g" .env
sed -i "s/__WEBHOOK_API_KEY__/$ENDORSER_WEBHOOK_API_KEY/g" .env

# Add secret values to .env
echo "Adding secret values to environment file..."
cat >> .env << EOL

# Secret values from AWS Secrets Manager
TRACTION_ACAPY_SEED=$TRACTION_SEED
TRACTION_ACAPY_WALLET_ENCRYPTION_KEY=$WALLET_KEY
ACAPY_ADMIN_API_KEY=$ADMIN_API_KEY
ACAPY_MULTITENANT_JWT_SECRET=$JWT_SECRET
POSTGRESQL_PASSWORD=$DB_PASSWORD
TRACTION_INNKEEPER_WALLET_KEY=$INNKEEPER_WALLET_KEY
ACAPY_ENDORSER_SEED=$ENDORSER_SEED
ACAPY_ENDORSER_SEED_1=$ENDORSER_SEED_1
ENDORSER_ACAPY_ADMIN_URL_API_KEY=$ENDORSER_API_KEY
ENDORSER_API_ADMIN_KEY=$ENDORSER_API_KEY
ENDORSER_ACAPY_WALLET_ENCRYPTION_KEY=$ENDORSER_WALLET_KEY
ENDORSER_ACAPY_WEBHOOK_URL_API_KEY=$ENDORSER_WEBHOOK_API_KEY
ENDORSER_POSTGRESQL_PASSWORD=$DB_PASSWORD
ENDORSER_PSQL_ADMIN_PWD=$ENDORSER_PSQL_ADMIN_PWD
ENDORSER_PSQL_USER_PWD=$ENDORSER_PSQL_USER_PWD
EOL
`;
}

/**
 * Generates the script for finalizing the setup and starting the application
 */
export function generateFinalizationScript(instanceName: string): string {

    return `
# Create a status page for direct access to this instance
mkdir -p /var/www/html
cat > /var/www/html/index.html << EOL
<!DOCTYPE html>
<html>
<head>
    <title>DigiCred Traction Status</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .status { margin: 20px 0; padding: 15px; border-radius: 5px; }
        .running { background-color: #e6ffe6; border: 1px solid #99cc99; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>DigiCred Traction Environment</h1>
    <div class="status running">
        <h2>Environment Status: Running</h2>
        <p>Setup completed on: $(date)</p>
    </div>
    
    <h2>Service Information</h2>
    <table>
        <tr>
            <th>Service</th>
            <th>Port</th>
            <th>URL</th>
        </tr>
        <tr>
            <td>Tenant UI</td>
            <td>5101</td>
            <td><a href="https://$PUBLIC_IP:5101" target="_blank">Open Tenant UI</a></td>
        </tr>
    </table>
</body>
</html>
EOL

# Setup firewall rules to allow necessary ports
echo "Setting up firewall rules..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 8030/tcp
ufw allow 8031/tcp
ufw allow 8032/tcp
ufw allow 5101/tcp
ufw allow 9030/tcp
ufw allow 9031/tcp
ufw allow 9032/tcp
ufw allow 9033/tcp
ufw allow 5000/tcp
ufw allow 5001/tcp
ufw allow 5432/tcp
ufw allow 5433/tcp
ufw allow 5434/tcp
ufw allow 1025/tcp
ufw allow 1080/tcp
echo "y" | ufw enable

# Make a backup of the original docker-compose file
echo "Backing up docker-compose.yml..."
cp docker-compose.yml docker-compose.yml.original

# Install Python and PyYAML if not already installed
echo "Ensuring Python and dependencies are installed..."
apt-get install -y python3 python3-pip &>/dev/null || true
pip3 install pyyaml &>/dev/null || true

# Use Python to safely modify the docker-compose.yml file
echo "Validating and fixing docker-compose.yml..."
python3 -c '
import yaml, sys, os

try:
    with open("docker-compose.yml", "r") as f:
        docker_compose = yaml.safe_load(f)
        print("docker-compose.yml is valid YAML")

    # Convert string command to list if needed
    has_changes = False
    for service_name, service in docker_compose.get("services", {}).items():
        if "command" in service:
            if isinstance(service["command"], str):
                service["command"] = service["command"].split()
                has_changes = True

    # Handle ACA-Py configuration conflicts
    print("Checking for ACA-Py configuration conflicts...")
    for service_name, service in docker_compose.get("services", {}).items():
        if "command" in service:
            if isinstance(service["command"], str):
                service["command"] = service["command"].split()
            if isinstance(service["command"], list):
                if "--admin-insecure-mode" in service["command"] and "--admin-api-key" in " ".join(service["command"]):
                    service["command"].remove("--admin-insecure-mode")
                    print(f"Removed --admin-insecure-mode from {service_name}")
                    has_changes = True

    # Handle port mappings
    print("Checking port mappings...")
    for service_name, service in docker_compose.get("services", {}).items():
        if "ports" in service and isinstance(service["ports"], list):
            for i, port in enumerate(service["ports"]):
                if isinstance(port, str) and ":" in port:
                    parts = port.replace("\\\"", "").split(":")
                    if len(parts) == 2 and not parts[1].strip():
                        service["ports"][i] = f"{parts[0]}:{parts[0]}"
                        has_changes = True
                        print(f"Fixed port mapping in {service_name}: {port} -> {service['ports'][i]}")

    # Write the file back if changes were made
    if has_changes:
        with open("docker-compose.yml", "w") as f:
            yaml.dump(docker_compose, f, default_flow_style=False)
            print("Applied changes to docker-compose.yml")
    else:
        print("No changes needed in docker-compose.yml")

except Exception as e:
    print(f"Error processing docker-compose.yml: {e}")
    if os.path.exists("docker-compose.yml.original"):
        os.system("cp docker-compose.yml.original docker-compose.yml")
        print("Restored original docker-compose.yml due to error")
    sys.exit(1)
'

# Verify the YAML configuration is valid
echo "Verifying docker-compose configuration..."
if ! docker-compose config > /dev/null 2>&1; then
    echo "Error: Invalid docker-compose.yml configuration, restoring original..."
    cp docker-compose.yml.original docker-compose.yml
    if ! docker-compose config > /dev/null 2>&1; then
        echo "Error: Original docker-compose.yml is also invalid. Cannot proceed."
        exit 1
    fi
fi

# Start docker-compose
cd /home/ubuntu/dc-crms-docker/digicred
echo "Starting application with docker-compose..."
docker-compose up -d

# Check service status after start
echo "Checking service status..."
sleep 30
docker-compose ps >> /var/log/${instanceName}-userdata.log

# Wait for all services to be up
echo "Waiting for all services to be healthy..."
timeout=300
until docker-compose ps | grep -q "traction-agent" && ! docker-compose ps | grep -q "Exit"; do
    if [ $timeout -le 0 ]; then
        echo "Services failed to start properly after 5 minutes at $(date)"
        docker-compose logs >> /var/log/traction-startup-failure.log
        exit 1
    fi
    echo "Waiting for services to be healthy... ($timeout seconds remaining)"
    timeout=$(($timeout - 10))
    sleep 10
done

# Make files accessible to ubuntu user
chown -R ubuntu:ubuntu /home/ubuntu/dc-crms-docker

echo "${instanceName} DigiCred Traction service setup complete at $(date)"
`;
}
