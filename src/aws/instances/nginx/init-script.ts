// File: src/aws/nginx/init-script.ts
import * as pulumi from "@pulumi/pulumi";
import { NginxConfig } from "../types";
import { getNginxBaseConfig } from "./config-templates";
import { getSslSetupScript } from "./ssl-setup";

export function getNginxInitScript(
    config: NginxConfig,
    serverName: string,
    letsEncryptEmail: string,
    timestamp: string
): pulumi.Output<string> {
    // Get the SSL setup script
    const sslScript = getSslSetupScript(config, serverName, letsEncryptEmail);
    
    // Get the base Nginx configuration
    const baseConfig = getNginxBaseConfig(config, serverName);
    
    return pulumi.interpolate`#!/bin/bash
set -eo pipefail
exec > >(tee /var/log/nginx-userdata.log) 2>&1

echo "===== Starting Nginx setup ====="
echo "Server Name: ${serverName}"
echo "Let's Encrypt Email: ${letsEncryptEmail}"
echo "Traction IP: ${config.tractionIp}"
echo "Controller IP: ${config.controllerIp}"
echo "Deployment Timestamp: ${timestamp}"

# Flag to determine if we should attempt SSL setup
USE_SSL=false
if [ -n "${serverName}" ] && [ -n "${letsEncryptEmail}" ]; then
    USE_SSL=true
    echo "Domain name and email provided, will attempt SSL setup"
elif [ -n "${serverName}" ] && [ -z "${letsEncryptEmail}" ]; then
    echo "Domain name provided but no email for Let's Encrypt, will set up HTTP-only mode"
else
    echo "No domain name provided, will set up HTTP-only mode"
fi

# Get the instance's public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
echo "Server public IP: $PUBLIC_IP"

# Update system with retries and proper error handling
echo "===== Updating package lists ====="
function retry_command() {
    local -r cmd="$1"
    local -r description="$2"
    local -r max_attempts="$3"
    
    echo "Executing: $description"
    
    for ((i = 1; i <= max_attempts; i++)); do
        if eval "$cmd"; then
            echo "$description - Succeeded"
            return 0
        else
            echo "$description - Failed (Attempt $i of $max_attempts)"
            sleep 3
        fi
    done
    
    echo "$description - All attempts failed"
    return 1
}

# Create lock file to ensure idempotency
LOCK_FILE="/var/lib/nginx-ssl-setup.lock"
if [ -f "$LOCK_FILE" ]; then
    echo "Setup has already run before. Found lock file $LOCK_FILE"
    echo "To force re-run, remove this file and restart: $LOCK_FILE"
    exit 0
fi

# Install necessary packages
retry_command "apt-get update" "Package update" 5 || exit 1
retry_command "DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl netcat-traditional netcat-openbsd software-properties-common dnsutils snapd" "Package installation" 5 || exit 1

# Install Certbot using snap only if we're going to attempt SSL
if [ "$USE_SSL" = true ]; then
    echo "===== Installing Certbot via snap ====="
    snap install --classic certbot
    ln -sf /snap/bin/certbot /usr/bin/certbot
fi

# Stop nginx before configuration
systemctl stop nginx || true

# Create necessary directories with proper permissions
echo "===== Setting up directories ====="
mkdir -p /var/log/nginx
touch /var/log/nginx/{traction,controller}_{access,error}.log
chown -R www-data:adm /var/log/nginx
chmod 644 /var/log/nginx/*.log

# Create directory for Let's Encrypt validation if needed
if [ "$USE_SSL" = true ]; then
    mkdir -p /var/www/html/.well-known/acme-challenge
    chmod -R 755 /var/www/html
fi

# Wait for backend services
echo "===== Checking backend services ====="
backend_ready=false
for i in {1..30}; do
    # Check if Traction UI and Proxy are available
    traction_ui_ready=$(nc -z ${config.tractionIp} 5101 && echo "true" || echo "false")
    controller_ready=$(nc -z ${config.controllerIp} 80 && echo "true" || echo "false")
    
    echo "Check $i: Traction UI: $traction_ui_ready, Controller: $controller_ready"
    
    if [ "$traction_ui_ready" = "true" ] && [ "$controller_ready" = "true" ]; then
        echo "All backend services are ready"
        backend_ready=true
        break
    fi
    
    echo "Attempt $i: Waiting for backend services... $(date)"
    sleep 10
done

if [ "$backend_ready" = false ]; then
    echo "WARNING: Some backend services not available after 5 minutes. Will continue anyway."
    echo "Traction UI Ready: $traction_ui_ready"
    echo "Controller Ready: $controller_ready"
fi

# Create Nginx configuration
echo "===== Configuring Nginx ====="
if [ -f /etc/nginx/sites-available/default ]; then
    cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup.$(date +%Y%m%d%H%M%S)
fi

# Determine server_name directive
if [ -n "${serverName}" ]; then
    SERVER_NAME_DIRECTIVE="server_name ${serverName};"
else
    SERVER_NAME_DIRECTIVE="server_name $PUBLIC_IP;"
    echo "Using IP address as server name: $PUBLIC_IP"
fi

${baseConfig}

# Test nginx configuration
echo "===== Testing Nginx configuration ====="
nginx -t || {
    echo "ERROR: Nginx configuration test failed"
    exit 1
}

# Enable and restart nginx
echo "===== Starting Nginx ====="
systemctl enable nginx
systemctl start nginx || {
    echo "ERROR: Failed to restart nginx"
    systemctl status nginx
    exit 1
}

${sslScript}

# Create lock file to indicate successful completion
echo "$(date)" > "$LOCK_FILE"

if [ "$USE_SSL" = true ]; then
    echo "===== Nginx setup with Let's Encrypt SSL complete at $(date) ====="
else
    echo "===== Nginx setup (HTTP only) complete at $(date) ====="
fi`;
}