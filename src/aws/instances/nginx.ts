import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { NginxConfig } from "./types";

export function createNginxInstance(config: NginxConfig, opts?: pulumi.ComponentResourceOptions): aws.ec2.Instance {
    const instanceConfig = new pulumi.Config();

    // Get configuration values
    const rawServerName = instanceConfig.get("awsNginxServerDNS") || "";
    const rawLetsEncryptEmail = instanceConfig.get("awsLetsEncryptEmail") || "";
    
    // Validate domain name - basic validation for a valid hostname format
    const domainRegex = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;
    const serverName = domainRegex.test(rawServerName) ? rawServerName : "";
    
    // Validate email
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const letsEncryptEmail = emailRegex.test(rawLetsEncryptEmail) ? rawLetsEncryptEmail : "";
    
    // Log validation results for debugging
    if (rawServerName && !serverName) {
        console.log(`Warning: Invalid domain name format: ${rawServerName}`);
    }
    if (rawLetsEncryptEmail && !letsEncryptEmail) {
        console.log(`Warning: Invalid email format: ${rawLetsEncryptEmail}`);
    }
    const timestamp = new Date().toISOString();

    // Define the init script with proper error handling and idempotency
    const initScript = pulumi.interpolate`#!/bin/bash
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
    if nc -z ${config.tractionIp} 80 && nc -z ${config.controllerIp} 80; then
        echo "Backend services are ready"
        backend_ready=true
        break
    fi
    echo "Attempt $i: Waiting for backend services..."
    sleep 10
done

if [ "$backend_ready" = false ]; then
    echo "WARNING: Backend services not available after 5 minutes"
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

# Configure nginx with security headers and settings
cat > /etc/nginx/sites-available/default <<EOL
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    $SERVER_NAME_DIRECTIVE

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Basic settings
    client_max_body_size 64M;
    server_tokens off;

    # Main logging
    access_log /var/log/nginx/access.log combined buffer=512k flush=1m;
    error_log /var/log/nginx/error.log warn;

    # Timeouts
    client_body_timeout 60s;
    client_header_timeout 60s;
    keepalive_timeout 75s;
    send_timeout 60s;

    # Global proxy settings
    proxy_buffers 8 16k;
    proxy_buffer_size 16k;
    proxy_busy_buffers_size 32k;
EOL

# Add Let's Encrypt cert validation path if using SSL
if [ "$USE_SSL" = true ]; then
    cat >> /etc/nginx/sites-available/default <<EOL
    # Let's Encrypt cert validation path
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }
EOL
fi

# Continue with the rest of the configuration
cat >> /etc/nginx/sites-available/default <<EOL
    # Root location block
    location / {
        return 200 'Nginx is up! Use /traction or /controller.';
        add_header Content-Type text/plain;
        access_log /var/log/nginx/root_access.log combined buffer=512k;
        error_log /var/log/nginx/root_error.log debug;
    }

    location /traction/ {
        rewrite ^/traction/(.*) /$1 break;
        access_log /var/log/nginx/traction_access.log combined buffer=512k;
        error_log /var/log/nginx/traction_error.log debug;
        proxy_pass http://${config.tractionIp}:80;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
        proxy_intercept_errors on;
        proxy_buffering on;
    }

    location /controller/ {
        rewrite ^/controller/(.*) /$1 break;
        access_log /var/log/nginx/controller_access.log combined buffer=512k;
        error_log /var/log/nginx/controller_error.log debug;
        proxy_pass http://${config.controllerIp}:80;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
        proxy_intercept_errors on;
        proxy_buffering on;
    }

    location = /traction {
        return 301 /traction/;
    }
    
    location = /controller {
        return 301 /controller/;
    }

    # Health check endpoint
    location = /health {
        access_log off;
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
EOL

# Set proper permissions and enable config
chmod 644 /etc/nginx/sites-available/default
chown root:root /etc/nginx/sites-available/default
ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/default.bak

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

# Only proceed with SSL setup if domain name was provided
if [ "$USE_SSL" = true ]; then
    # Create state directories for Let's Encrypt
    echo "===== Setting up Let's Encrypt state directories ====="
    mkdir -p /var/lib/certbot
    mkdir -p /var/lib/letsencrypt
    mkdir -p /etc/letsencrypt/renewal-hooks/post/

    # Create flag file paths
    CERT_REQUEST_FLAG="/var/lib/certbot/cert_requested_\${serverName//[^a-zA-Z0-9]/_}"

    # Check if DNS is properly configured
    echo "===== Checking DNS ====="
    
    # Function to check DNS
    check_dns() {
        local domain="$1"
        local server_ip="$2"
        local domain_ip
        
        domain_ip=$(dig +short "$domain" || echo "DNS lookup failed")
        
        echo "Domain $domain resolves to: $domain_ip"
        echo "Server public IP: $server_ip"
        
        # Check if domain resolves to our IP
        if [ "$domain_ip" = "$server_ip" ]; then
            return 0  # Success
        else
            return 1  # Failure
        fi
    }
    
    # Initial DNS check
    dns_check_success=false

    # First DNS check attempt
    echo "Starting initial DNS check for domain ${serverName} to IP $PUBLIC_IP at $(date)"
    if check_dns "${serverName}" "$PUBLIC_IP"; then
        dns_check_success=true
        echo "Initial DNS check succeeded at $(date)"
    else
        echo "Initial DNS check failed at $(date). Domain ${serverName} does not resolve to $PUBLIC_IP"
        echo "Will retry periodically every 5 minutes for up to 6 hours (72 attempts)"
        
        for retry in {1..72}; do
            echo "Starting DNS retry attempt $retry of 72 at $(date). Waiting 5 minutes before checking."
            sleep 300  # 5 minutes
            echo "Performing DNS check at $(date)"
            
            if check_dns "${serverName}" "$PUBLIC_IP"; then
                dns_check_success=true
                echo "DNS check succeeded at $(date) after $retry retries"
                break
            else
                echo "DNS check failed at $(date): domain ${serverName} does not resolve to $PUBLIC_IP"
            fi
        done
        
        if [ "$dns_check_success" = false ]; then
            echo "All 72 DNS retry attempts failed. Domain ${serverName} does not resolve to $PUBLIC_IP at $(date)"
        fi
    fi

    # Request Let's Encrypt certificate if DNS is configured correctly
    if [ "$dns_check_success" = true ]; then
        echo "===== DNS check passed ====="
        
        # Check if certificate already exists
        if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
            echo "Certificate already exists, skipping certificate request"
        elif [ -f "$CERT_REQUEST_FLAG" ]; then
            echo "Certificate was previously requested, skipping to avoid rate limits"
        else
            echo "===== Requesting Let's Encrypt certificate ====="
            mkdir -p "$(dirname "$CERT_REQUEST_FLAG")"
            
            # Add a slight delay to ensure Nginx is fully started
            sleep 5
            
            # Attempt certificate request with retries
            for attempt in {1..3}; do
                echo "Attempt $attempt of 3 to obtain certificate at $(date)"
                if certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; then
                    echo "Certificate successfully obtained"
                    touch "$CERT_REQUEST_FLAG"
                    
                    # Update Nginx SSL configuration with stronger settings
                    cat > /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh <<EOL2
#!/bin/bash
# Add stronger SSL parameters after certificate issuance/renewal
if ! grep -q "ssl_protocols TLSv1.2 TLSv1.3" /etc/nginx/sites-available/default; then
    # Create a temporary file
    TEMP_FILE=\\\$(mktemp)
    
    # Find the SSL server block and add our parameters
    awk '
        /listen.*ssl/ {
            print
            ssl_block = 1
            next
        }
        ssl_block == 1 && /server_name/ {
            print
            print "    # Strong SSL Configuration"
            print "    ssl_protocols TLSv1.2 TLSv1.3;"
            print "    ssl_prefer_server_ciphers on;"
            print "    ssl_ciphers \\"ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384\\";"
            print "    ssl_session_timeout 1d;"
            print "    ssl_session_cache shared:SSL:10m;"
            print "    ssl_session_tickets off;"
            ssl_block = 0
            next
        }
        { print }
    ' /etc/nginx/sites-available/default > \\\$TEMP_FILE
    
    # If the temp file has content, replace the config
    if [ -s \\\$TEMP_FILE ]; then
        cat \\\$TEMP_FILE > /etc/nginx/sites-available/default
        nginx -t && systemctl reload nginx
    fi
    
    # Clean up
    rm \\\$TEMP_FILE
fi
EOL2
                    chmod +x /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
                    /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
                    break
                else
                    echo "Attempt $attempt failed at $(date)"
                    if [ $attempt -lt 3 ]; then
                        echo "Waiting 10 minutes before retrying to respect rate limits"
                        sleep 600
                    fi
                fi
            done
            touch "$CERT_REQUEST_FLAG"  # Mark attempt regardless of success
            
            if [ ! -f "/etc/letsencrypt/live/${serverName}" ]; then
                echo "ERROR: All 3 attempts to obtain Let's Encrypt certificate failed at $(date)"
                echo "Domain: ${serverName}, Public IP: $PUBLIC_IP"
                echo "Next retry via cron in 3 hours. Check /var/log/certbot-retry.log for updates."
                echo "Manual fix: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail} --redirect"
                cat > /etc/cron.d/certbot-retry <<EOL3
# Attempt to request SSL certificate every 3 hours if not obtained
0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect >> /var/log/certbot-retry.log 2>&1
EOL3
                chmod 644 /etc/cron.d/certbot-retry
            fi
        fi
    else
        echo "===== DNS check failed ====="
        echo "WARNING: ${serverName} doesn't resolve to server's IP $PUBLIC_IP"
        echo "SSL certificate will not be obtained until DNS is properly configured."
        
        cat > /etc/cron.d/certbot-dns-check <<EOL4
# Check DNS and attempt certificate every 3 hours
0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && if [ "\\\$(dig +short ${serverName})" = "$PUBLIC_IP" ]; then certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; fi >> /var/log/certbot-dns-check.log 2>&1
EOL4
        chmod 644 /etc/cron.d/certbot-dns-check
        
        echo "Created automated job to check DNS and request certificate every 3 hours"
        echo "Manual command: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail} --redirect"
    fi

    # Set up certificate auto-renewal hooks
    echo "===== Setting up certificate auto-renewal hooks ====="
    mkdir -p /etc/letsencrypt/renewal-hooks/post/
    cat > /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh <<EOL
#!/bin/bash
# Test Nginx configuration after certificate renewal
nginx -t && systemctl reload nginx
EOL
    chmod +x /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh
fi

# Create lock file to indicate successful completion
echo "$(date)" > "$LOCK_FILE"

if [ "$USE_SSL" = true ]; then
    echo "===== Nginx setup with Let's Encrypt SSL complete at $(date) ====="
else
    echo "===== Nginx setup (HTTP only) complete at $(date) ====="
fi`;

    const instance = new aws.ec2.Instance(config.name, {
        ami: aws.ec2.getAmiOutput({
            mostRecent: true,
            filters: [{
                name: "name",
                values: ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"],
            }, {
                name: "virtualization-type",
                values: ["hvm"],
            }],
            owners: ["099720109477"],
        }).id,
        instanceType: config.instanceType,
        subnetId: config.subnetId,
        securityGroups: [config.securityGroupId],
        userData: initScript,
        iamInstanceProfile: config.iamInstanceProfile,
        associatePublicIpAddress: true,
        tags: { 
            Name: config.name,
            AutoRecovery: "true",
            ServerName: serverName || "ip-only",
            Version: `8-${timestamp}`
        },
    }, opts);

    // Associate Elastic IP
    new aws.ec2.EipAssociation(`${config.name}-eip-assoc`, {
        instanceId: instance.id,
        allocationId: config.elasticIpId,
    }, { dependsOn: [instance] });

    return instance;
}