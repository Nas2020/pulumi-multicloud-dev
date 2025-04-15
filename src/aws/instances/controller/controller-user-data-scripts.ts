import * as pulumi from "@pulumi/pulumi";

/**
 * Generates the controller app setup script
 */
export function generateControllerAppSetupScript(
    region: string,
    secretArn: pulumi.Output<string>,
    configBucket: pulumi.Output<string>,
    configKey: pulumi.Output<string>,
    repoUrl: string = "https://github.com/Nas2020/acapy-controller-docker-compose.git"
): pulumi.Output<string> {
    return pulumi.interpolate`
# Clone the repository
mkdir -p /home/ubuntu
cd /home/ubuntu
git clone ${repoUrl}
cd /home/ubuntu/acapy-controller-docker-compose

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

# Extract secret values
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
ELLUCIAN_API_KEY=$(extract_secret "ELLUCIAN_API_KEY")
BEARER_TOKEN=$(extract_secret "BEARER_TOKEN")
API_KEY=$(extract_secret "API_KEY")
REDIS_PASSWORD=$(extract_secret "REDIS_PASSWORD")
WORKFLOW_DB_PASSWORD=$(extract_secret "WORKFLOW_DB_PASSWORD")

# Create .env file by replacing placeholders in the template
echo "Creating environment file from template..."
cp config-template.env .env

# Replace placeholders with actual values
echo "Replacing placeholders in configuration..."
sed -i "s/__PUBLIC_IP__/$PUBLIC_IP/g" .env

# Add secret values to .env
echo "Adding secret values to environment file..."
cat >> .env << EOL

# Secret values from AWS Secrets Manager
ELLUCIAN_API_KEY=$ELLUCIAN_API_KEY
BEARER_TOKEN=$BEARER_TOKEN
API_KEY=$API_KEY
REDIS_PASSWORD=$REDIS_PASSWORD
WORKFLOW_DB_PASSWORD=$WORKFLOW_DB_PASSWORD
EOL
`;
}

/**
 * Generates the finalization script for the controller
 */
export function generateControllerFinalizationScript(instanceName: string): string {
    return `
# Create a status page for direct access to this instance
mkdir -p /var/www/html
cat > /var/www/html/index.html << EOL
<!DOCTYPE html>
<html>
<head>
    <title>Cape Fear Controller Status</title>
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
    <h1>Cape Fear Controller Environment</h1>
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
            <td>API</td>
            <td>3008</td>
            <td><a href="http://$PUBLIC_IP:3008" target="_blank">Open API</a></td>
        </tr>
    </table>
</body>
</html>
EOL

# Setup firewall rules to allow necessary ports
echo "Setting up firewall rules..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 3008/tcp
ufw allow 5435/tcp
ufw allow 6380/tcp
echo "y" | ufw enable

# Start the application with docker-compose
cd /home/ubuntu/acapy-controller-docker-compose
echo "Starting application with docker-compose..."
docker-compose up -d

# Check service status after start
echo "Checking service status..."
sleep 30
docker-compose ps >> /var/log/${instanceName}-userdata.log

# Make files accessible to ubuntu user
chown -R ubuntu:ubuntu /home/ubuntu/acapy-controller-docker-compose

echo "${instanceName} Cape Fear Controller service setup complete at $(date)"
`;
}