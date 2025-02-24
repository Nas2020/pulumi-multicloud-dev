import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { NginxConfig } from "./types";

export function createNginxInstance(config: NginxConfig, opts?: pulumi.ComponentResourceOptions): aws.ec2.Instance {
    const instanceConfig = new pulumi.Config();
    const serverName = instanceConfig.get("nginxServerName") || "aws.limogi.ai";
    const timestamp = new Date().toISOString();

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
        userData: pulumi.interpolate`#!/bin/bash
set -ex
exec > >(tee /var/log/nginx-userdata.log) 2>&1

echo "Starting nginx setup at $(date)"
echo "Server Name: ${serverName}"
echo "Traction IP: ${config.tractionIp}"
echo "Controller IP: ${config.controllerIp}"
echo "Deployment Timestamp: ${timestamp}"

# Update system and install required packages with max 5 retries
retry_count=5
until apt-get update; do
    if [ $retry_count -le 0 ]; then
        echo "ERROR: apt-get update failed after 5 attempts"
        exit 1
    fi
    echo "apt-get update failed. Retrying... ($retry_count attempts left)"
    retry_count=$(($retry_count - 1))
    sleep 2
done

# Install packages with retries
retry_count=5
until DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl netcat-traditional netcat-openbsd; do
    if [ $retry_count -le 0 ]; then
        echo "ERROR: apt-get install failed after 5 attempts"
        exit 1
    fi
    echo "apt-get install failed. Retrying... ($retry_count attempts left)"
    retry_count=$(($retry_count - 1))
    sleep 2
done

# Stop nginx before configuration
systemctl stop nginx

# Create log directories with proper permissions
echo "Setting up log directories..."
mkdir -p /var/log/nginx
touch /var/log/nginx/{traction,controller}_{access,error}.log
chown -R www-data:adm /var/log/nginx
chmod 644 /var/log/nginx/*.log

# Wait for backend services
echo "Waiting for backend services..."
backend_ready=false
for i in {1..30}; do
    if nc -zv ${config.tractionIp} 80 && nc -zv ${config.controllerIp} 80; then
        echo "Backend services are ready"
        backend_ready=true
        break
    fi
    echo "Attempt $i: Waiting for backend services..."
    sleep 10
done

if [ "$backend_ready" = false ]; then
    echo "WARNING: Backend services not available after 5 minutes"
    # Continue anyway but log the warning
fi

# Test backend services
echo "Testing backend services..."
echo "Testing Traction backend..."
curl -v http://${config.tractionIp}:80 || echo "WARNING: Traction service not responding"
echo "Testing Controller backend..."
curl -v http://${config.controllerIp}:80 || echo "WARNING: Controller service not responding"

# Backup default config
echo "Backing up default nginx configuration..."
mv /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak

# Configure nginx
echo "Writing new nginx configuration..."
cat > /etc/nginx/sites-available/default <<EOL
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${serverName};

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
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
        proxy_intercept_errors on;
        proxy_buffering on;
        add_header X-Debug-Backend-Host \\$upstream_addr always;
        add_header X-Debug-Request-Uri \\$request_uri always;
    }

    location /controller/ {
        rewrite ^/controller/(.*) /$1 break;
        access_log /var/log/nginx/controller_access.log combined buffer=512k;
        error_log /var/log/nginx/controller_error.log debug;
        proxy_pass http://${config.controllerIp}:80;
        proxy_http_version 1.1;
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
        proxy_intercept_errors on;
        proxy_buffering on;
        add_header X-Debug-Backend-Host \\$upstream_addr always;
        add_header X-Debug-Request-Uri \\$request_uri always;
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

# Set proper permissions
echo "Setting nginx configuration permissions..."
chmod 644 /etc/nginx/sites-available/default
chown root:root /etc/nginx/sites-available/default

# Ensure proper symlink
echo "Creating nginx configuration symlink..."
ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/default.bak

# Verify config content
echo "Verifying nginx configuration content (proxy headers):"
cat /etc/nginx/sites-available/default | grep proxy_set_header

# Test nginx configuration
echo "Testing nginx configuration..."
nginx -t || {
    echo "ERROR: Nginx configuration test failed"
    exit 1
}

# Print full nginx configuration for debugging
echo "Current nginx configuration:"
nginx -T

# Enable and restart nginx
echo "Enabling and starting nginx..."
systemctl enable nginx
systemctl restart nginx || {
    echo "ERROR: Failed to restart nginx"
    systemctl status nginx
    exit 1
}

# Verify nginx is running
echo "Verifying nginx status..."
systemctl status nginx

# Final verification
echo "Testing nginx endpoints..."
for endpoint in "/" "/health" "/traction/" "/controller/"; do
    echo "Testing endpoint: $endpoint"
    curl -v "http://localhost$endpoint" || echo "Warning: Failed to access $endpoint"
done

# Print logs for debugging
echo "Recent nginx error log entries:"
tail -n 50 /var/log/nginx/error.log

echo "Nginx setup complete at $(date)"`,
        iamInstanceProfile: config.iamInstanceProfile,
        associatePublicIpAddress: true,
        tags: { 
            Name: config.name,
            AutoRecovery: "true",
            ServerName: serverName,
            Version: `4-${timestamp}`
        },
    }, opts);

    // Associate Elastic IP
    new aws.ec2.EipAssociation(`${config.name}-eip-assoc`, {
        instanceId: instance.id,
        allocationId: config.elasticIpId,
    }, { dependsOn: [instance] });

    return instance;
}

// import * as aws from "@pulumi/aws";
// import * as pulumi from "@pulumi/pulumi";
// import { NginxConfig } from "./types";

// export function createNginxInstance(config: NginxConfig, opts?: pulumi.ComponentResourceOptions): aws.ec2.Instance {
//     const instanceConfig = new pulumi.Config();
//     const serverName = instanceConfig.get("nginxServerName") || "aws.limogi.ai";

//     const instance = new aws.ec2.Instance(config.name, {
//         ami: aws.ec2.getAmiOutput({
//             mostRecent: true,
//             filters: [{
//                 name: "name",
//                 values: ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"],
//             }, {
//                 name: "virtualization-type",
//                 values: ["hvm"],
//             }],
//             owners: ["099720109477"],
//         }).id,
//         instanceType: config.instanceType,
//         subnetId: config.subnetId,
//         securityGroups: [config.securityGroupId],
//         userData: pulumi.interpolate`#!/bin/bash
// set -ex
// exec > >(tee /var/log/nginx-userdata.log) 2>&1

// echo "Starting nginx setup at $(date)"
// echo "Server Name: ${serverName}"
// echo "Traction IP: ${config.tractionIp}"
// echo "Controller IP: ${config.controllerIp}"

// # Update system and install required packages with max 5 retries
// retry_count=5
// until apt-get update; do
//     if [ $retry_count -le 0 ]; then
//         echo "ERROR: apt-get update failed after 5 attempts"
//         exit 1
//     fi
//     echo "apt-get update failed. Retrying... ($retry_count attempts left)"
//     retry_count=$(($retry_count - 1))
//     sleep 2
// done

// # Install packages with retries
// retry_count=5
// until DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl netcat-traditional netcat-openbsd; do
//     if [ $retry_count -le 0 ]; then
//         echo "ERROR: apt-get install failed after 5 attempts"
//         exit 1
//     fi
//     echo "apt-get install failed. Retrying... ($retry_count attempts left)"
//     retry_count=$(($retry_count - 1))
//     sleep 2
// done

// # Stop nginx before configuration
// systemctl stop nginx

// # Create log directories with proper permissions
// echo "Setting up log directories..."
// mkdir -p /var/log/nginx
// touch /var/log/nginx/{traction,controller}_{access,error}.log
// chown -R www-data:adm /var/log/nginx
// chmod 644 /var/log/nginx/*.log

// # Wait for backend services
// echo "Waiting for backend services..."
// backend_ready=false
// for i in {1..30}; do
//     if nc -zv ${config.tractionIp} 80 && nc -zv ${config.controllerIp} 80; then
//         echo "Backend services are ready"
//         backend_ready=true
//         break
//     fi
//     echo "Attempt $i: Waiting for backend services..."
//     sleep 10
// done

// if [ "$backend_ready" = false ]; then
//     echo "WARNING: Backend services not available after 5 minutes"
//     # Continue anyway but log the warning
// fi

// # Test backend services
// echo "Testing backend services..."
// echo "Testing Traction backend..."
// curl -v http://${config.tractionIp}:80 || echo "WARNING: Traction service not responding"
// echo "Testing Controller backend..."
// curl -v http://${config.controllerIp}:80 || echo "WARNING: Controller service not responding"

// # Backup default config
// echo "Backing up default nginx configuration..."
// mv /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak

// # Configure nginx
// echo "Writing new nginx configuration..."
// echo "Config to be written:"
// cat <<'DEBUG_EOC'
// server {
//     listen 80 default_server;
//     listen [::]:80 default_server;
//     server_name ${serverName};
//     client_max_body_size 64M;
//     server_tokens off;
//     access_log /var/log/nginx/access.log combined buffer=512k flush=1m;
//     error_log /var/log/nginx/error.log warn;
//     client_body_timeout 60s;
//     client_header_timeout 60s;
//     keepalive_timeout 75s;
//     send_timeout 60s;
//     proxy_buffers 8 16k;
//     proxy_buffer_size 16k;
//     proxy_busy_buffers_size 32k;
//     location / {
//         return 200 'Nginx is up! Use /traction or /controller.';
//         default_type text/plain;
//         access_log /var/log/nginx/root_access.log combined buffer=512k;
//         error_log /var/log/nginx/root_error.log debug;
//     }
//     location /traction/ {
//         rewrite ^/traction/(.*) /$1 break;
//         access_log /var/log/nginx/traction_access.log combined buffer=512k;
//         error_log /var/log/nginx/traction_error.log debug;
//         proxy_pass http://${config.tractionIp}:80;
//         proxy_http_version 1.1;
//         proxy_set_header Host \$host;
//         proxy_set_header X-Real-IP \$remote_addr;
//         proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \$scheme;
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
//         proxy_next_upstream error timeout http_502 http_503 http_504;
//         proxy_next_upstream_tries 3;
//         proxy_intercept_errors on;
//         proxy_buffering on;
//         add_header X-Debug-Backend-Host \$upstream_addr always;
//         add_header X-Debug-Request-Uri \$request_uri always;
//     }
//     location /controller/ {
//         rewrite ^/controller/(.*) /$1 break;
//         access_log /var/log/nginx/controller_access.log combined buffer=512k;
//         error_log /var/log/nginx/controller_error.log debug;
//         proxy_pass http://${config.controllerIp}:80;
//         proxy_http_version 1.1;
//         proxy_set_header Host \$host;
//         proxy_set_header X-Real-IP \$remote_addr;
//         proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \$scheme;
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
//         proxy_next_upstream error timeout http_502 http_503 http_504;
//         proxy_next_upstream_tries 3;
//         proxy_intercept_errors on;
//         proxy_buffering on;
//         add_header X-Debug-Backend-Host \$upstream_addr always;
//         add_header X-Debug-Request-Uri \$request_uri always;
//     }
//     location = /traction { return 301 /traction/; }
//     location = /controller { return 301 /controller/; }
//     location = /health {
//         access_log off;
//         return 200 'OK';
//         default_type text/plain;
//     }
// }
// DEBUG_EOC
// cat > /etc/nginx/sites-available/default <<'EOL'
// server {
//     listen 80 default_server;
//     listen [::]:80 default_server;
//     server_name ${serverName};

//     # Basic settings
//     client_max_body_size 64M;
//     server_tokens off;

//     # Main logging
//     access_log /var/log/nginx/access.log combined buffer=512k flush=1m;
//     error_log /var/log/nginx/error.log warn;

//     # Timeouts
//     client_body_timeout 60s;
//     client_header_timeout 60s;
//     keepalive_timeout 75s;
//     send_timeout 60s;

//     # Global proxy settings
//     proxy_buffers 8 16k;
//     proxy_buffer_size 16k;
//     proxy_busy_buffers_size 32k;

//     # Root location block
//     location / {
//         return 200 'Nginx is up! Use /traction or /controller.';
//         add_header Content-Type text/plain;
//         access_log /var/log/nginx/root_access.log combined buffer=512k;
//         error_log /var/log/nginx/root_error.log debug;
//     }

//    location /traction/ {
//         rewrite ^/traction/(.*) /$1 break;
//         access_log /var/log/nginx/traction_access.log combined buffer=512k;
//         error_log /var/log/nginx/traction_error.log debug;
//         proxy_pass http://${config.tractionIp}:80;
//         proxy_http_version 1.1;
//         proxy_set_header Host $host;
//         proxy_set_header X-Real-IP $remote_addr;
//         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto $scheme;
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
//         proxy_next_upstream error timeout http_502 http_503 http_504;
//         proxy_next_upstream_tries 3;
//         proxy_intercept_errors on;
//         proxy_buffering on;
//         add_header X-Debug-Backend-Host \$upstream_addr always;
//         add_header X-Debug-Request-Uri \$request_uri always;
//     }

//     location /controller/ {
//         rewrite ^/controller/(.*) /$1 break;
//         access_log /var/log/nginx/controller_access.log combined buffer=512k;
//         error_log /var/log/nginx/controller_error.log debug;
//         proxy_pass http://${config.controllerIp}:80;
//         proxy_http_version 1.1;
//         proxy_set_header Host \$host;
//         proxy_set_header X-Real-IP \$remote_addr;
//         proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \$scheme;
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
//         proxy_next_upstream error timeout http_502 http_503 http_504;
//         proxy_next_upstream_tries 3;
//         proxy_intercept_errors on;
//         proxy_buffering on;
//         add_header X-Debug-Backend-Host \$upstream_addr always;
//         add_header X-Debug-Request-Uri \$request_uri always;
//     }

//     location = /traction {
//         return 301 /traction/;
//     }
    
//     location = /controller {
//         return 301 /controller/;
//     }

//     # Health check endpoint
//     location = /health {
//         access_log off;
//         return 200 'OK';
//         add_header Content-Type text/plain;
//     }
// }
// EOL

// # Set proper permissions
// echo "Setting nginx configuration permissions..."
// chmod 644 /etc/nginx/sites-available/default
// chown root:root /etc/nginx/sites-available/default

// # Ensure proper symlink
// echo "Creating nginx configuration symlink..."
// ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
// rm -f /etc/nginx/sites-enabled/default.bak

// # Test nginx configuration
// echo "Testing nginx configuration..."
// nginx -t || {
//     echo "ERROR: Nginx configuration test failed"
//     exit 1
// }

// # Print full nginx configuration for debugging
// echo "Current nginx configuration:"
// nginx -T

// # Enable and restart nginx
// echo "Enabling and starting nginx..."
// systemctl enable nginx
// systemctl restart nginx || {
//     echo "ERROR: Failed to restart nginx"
//     systemctl status nginx
//     exit 1
// }

// # Verify nginx is running
// echo "Verifying nginx status..."
// systemctl status nginx

// # Final verification
// echo "Testing nginx endpoints..."
// for endpoint in "/" "/health" "/traction/" "/controller/"; do
//     echo "Testing endpoint: $endpoint"
//     curl -v "http://localhost$endpoint" || echo "Warning: Failed to access $endpoint"
// done

// # Print logs for debugging
// echo "Recent nginx error log entries:"
// tail -n 50 /var/log/nginx/error.log

// echo "Nginx setup complete at $(date)"`,
//         iamInstanceProfile: config.iamInstanceProfile,
//         associatePublicIpAddress: true,
//         tags: { 
//             Name: config.name,
//             AutoRecovery: "true",
//             ServerName: serverName,
//             Version: "4"
//         },
//     }, opts);

//     // Associate Elastic IP
//     new aws.ec2.EipAssociation(`${config.name}-eip-assoc`, {
//         instanceId: instance.id,
//         allocationId: config.elasticIpId,
//     }, { dependsOn: [instance] });

//     return instance;
// }