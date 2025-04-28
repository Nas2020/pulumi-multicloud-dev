#!/bin/bash
# Nginx Configuration Module for Traction Deployment
# This script provides functions to handle the Nginx configuration for the Traction application

# Load common functions if not already loaded
if [ -z "$LOGFILE" ]; then
    LOGFILE="/var/log/traction-setup.log"
    mkdir -p "$(dirname $LOGFILE)"
    touch $LOGFILE

    # Logging function
    log() {
        local level=$1
        local message=$2
        local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
        echo "[$timestamp] [$level] $message" | tee -a $LOGFILE
    }
fi

# Check if Nginx is installed
check_nginx_installed() {
    if ! command -v nginx >/dev/null 2>&1; then
        log "WARN" "Nginx not found, installing..."
        sudo apt-get update
        sudo apt-get install -y nginx
        
        if [ $? -ne 0 ]; then
            log "ERROR" "Failed to install Nginx"
            return 1
        fi
    fi
    
    return 0
}

# Configure Nginx HTTP server (pre-SSL)
configure_nginx_http() {
    local domain_name=$1
    
    log "INFO" "Configuring Nginx HTTP server for domain: $domain_name"
    
    # Create directories if they don't exist
    sudo mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /var/www/html/.well-known/acme-challenge
    sudo chmod -R 755 /var/www/html
    
    # Create HTTP configuration
    sudo tee /etc/nginx/sites-available/traction.conf > /dev/null << EOF
server {
    listen 80;
    server_name ${domain_name};
    
    # Access and error logs
    access_log /var/log/nginx/traction-http-access.log;
    error_log /var/log/nginx/traction-http-error.log;
    
    # For Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # Temporary welcome page until SSL is setup
    location / {
        root /var/www/html;
        index index.html;
        
        # Fallback to redirect to HTTPS if SSL is available
        try_files \\\$uri \\\$uri/ =301;
    }
}
EOF

    # Create a simple welcome page
    sudo tee /var/www/html/index.html > /dev/null << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Welcome to ${domain_name}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 40px;
            text-align: center;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
        }
        p {
            color: #7f8c8d;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome to ${domain_name}</h1>
        <p>This site is currently being configured. The Traction application will be available soon.</p>
        <p>Please check back later.</p>
    </div>
</body>
</html>
EOF

    # Enable the site
    sudo ln -sf /etc/nginx/sites-available/traction.conf /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test the configuration
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "Nginx HTTP configuration applied successfully"
        return 0
    else
        log "ERROR" "Nginx configuration test failed"
        return 1
    fi
}

# Configure Nginx HTTPS server (post-SSL)
configure_nginx_https() {
    local domain_name=$1
    
    log "INFO" "Configuring Nginx HTTPS server for domain: $domain_name"
    
    sudo tee /etc/nginx/sites-available/traction-https.conf > /dev/null << EOF
server {
    listen 443 ssl;
    server_name ${domain_name};
    
    # SSL parameters will be filled by Certbot
    
    # Access and error logs
    access_log /var/log/nginx/traction-https-access.log;
    error_log /var/log/nginx/traction-https-error.log;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Buffer settings for proxied connections
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;
    
    # Tenant UI - Root path
    location / {
        proxy_pass http://localhost:5101;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_read_timeout 90;
        
        # Health check for UI
        error_page 502 503 504 @tenant_ui_down;
    }
    
    # Fallback page when Tenant UI is down
    location @tenant_ui_down {
        return 503 '<!DOCTYPE html><html><head><title>Service Temporarily Unavailable</title><style>body{font-family:Arial,sans-serif;margin:40px;text-align:center;} .container{max-width:800px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:5px;} h1{color:#e74c3c;} p{color:#7f8c8d;}</style></head><body><div class="container"><h1>Service Temporarily Unavailable</h1><p>The Tenant UI service is currently unavailable. Please try again later.</p></div></body></html>';
        add_header Content-Type text/html;
    }
    
    # Traction Agent path
    location /agent/ {
        proxy_pass http://localhost:8030/;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
    
    # Tenant Proxy path
    location /proxy/ {
        proxy_pass http://localhost:8032/;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_read_timeout 90;
    }
    
    # Controller path
    location /controller/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_read_timeout 90;
    }
    
    # Status endpoint for health monitoring
    location /status {
        access_log off;
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
EOF

    # Enable both HTTP and HTTPS configurations
    sudo ln -sf /etc/nginx/sites-available/traction-https.conf /etc/nginx/sites-enabled/
    
    # Test the configuration
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "Nginx HTTPS configuration applied successfully"
        return 0
    else
        log "ERROR" "Nginx HTTPS configuration test failed"
        return 1
    fi
}

# Check if domain resolves to the current machine's IP
check_domain_resolution() {
    local domain_name=$1
    
    log "INFO" "Checking if domain ${domain_name} resolves to this machine's IP..."
    
    # Get this machine's public IP
    local my_ip=$(curl -s http://checkip.amazonaws.com) || my_ip=$(curl -s http://ifconfig.me)
    
    if [ -z "$my_ip" ]; then
        log "ERROR" "Failed to determine this machine's public IP"
        return 1
    fi
    
    log "INFO" "This machine's public IP: ${my_ip}"
    
    # Get the domain's resolved IP
    local domain_ip=$(dig +short ${domain_name})
    
    if [ -z "$domain_ip" ]; then
        log "WARN" "Domain ${domain_name} does not resolve to any IP yet"
        return 1
    fi
    
    log "INFO" "Domain ${domain_name} resolves to: ${domain_ip}"
    
    if [ "$domain_ip" == "$my_ip" ]; then
        log "INFO" "Domain ${domain_name} correctly resolves to this machine's IP"
        return 0
    else
        log "WARN" "Domain ${domain_name} resolves to ${domain_ip}, but this machine's IP is ${my_ip}"
        return 1
    fi
}

# Configure Certbot for SSL
configure_ssl() {
    local domain_name=$1
    local email=$2
    local max_attempts=$3
    
    [ -z "$max_attempts" ] && max_attempts=3
    
    log "INFO" "Configuring SSL for domain ${domain_name} with email ${email}..."
    
    # Check if certbot is installed
    if ! command -v certbot >/dev/null 2>&1; then
        log "WARN" "Certbot not found, installing..."
        sudo apt-get update
        sudo apt-get install -y python3-certbot-nginx
        
        if [ $? -ne 0 ]; then
            log "ERROR" "Failed to install Certbot"
            return 1
        fi
    fi
    
    # Attempt to obtain and install certificate
    local attempt=1
    local wait_time=30
    
    while [ $attempt -le $max_attempts ]; do
        log "INFO" "SSL certificate attempt ${attempt}/${max_attempts}..."
        
        if sudo certbot --nginx --non-interactive --agree-tos \
           --email "${email}" -d "${domain_name}" \
           --deploy-hook "systemctl reload nginx" 2>&1 | tee -a $LOGFILE; then
            log "INFO" "SSL certificate successfully issued for ${domain_name}"
            return 0
        else
            # Check if we hit rate limits
            if grep -q "too many failed authorizations recently" $LOGFILE; then
                log "ERROR" "Hit Let's Encrypt rate limit. Please wait at least 1 hour before trying again."
                return 1
            fi
            
            # Check if domain validation failed
            if grep -q "Domain validation was not successful" $LOGFILE; then
                log "WARN" "Domain validation failed. DNS may not be properly configured."
                # Increase wait time more for DNS propagation
                wait_time=$((wait_time * 3))
            else
                # Standard exponential backoff
                wait_time=$((wait_time * 2))
            fi
            
            log "INFO" "Waiting ${wait_time} seconds before retry..."
            sleep $wait_time
        fi
        
        ((attempt++))
    done
    
    log "ERROR" "Failed to obtain SSL certificate after ${max_attempts} attempts."
    return 1
}

# Configure Nginx to redirect HTTP to HTTPS
configure_http_to_https_redirect() {
    local domain_name=$1
    
    log "INFO" "Configuring HTTP to HTTPS redirect for domain: $domain_name"
    
    sudo tee /etc/nginx/sites-available/traction.conf > /dev/null << EOF
server {
    listen 80;
    server_name ${domain_name};
    
    # Access and error logs
    access_log /var/log/nginx/traction-http-access.log;
    error_log /var/log/nginx/traction-http-error.log;
    
    # For Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # Redirect all HTTP traffic to HTTPS
    location / {
        return 301 https://\\\$host\\\$request_uri;
    }
}
EOF

    # Test and reload Nginx
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "HTTP to HTTPS redirect configured successfully"
        return 0
    else
        log "ERROR" "Failed to configure HTTP to HTTPS redirect"
        return 1
    fi
}

# Setup a monitoring endpoint
setup_nginx_monitoring() {
    local status_dir="/var/www/html/status"
    
    log "INFO" "Setting up Nginx monitoring endpoint..."
    
    # Create status directory
    sudo mkdir -p $status_dir
    
    # Create a simple status page
    sudo tee $status_dir/index.html > /dev/null << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Traction System Status</title>
    <meta http-equiv="refresh" content="60">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .status { margin: 10px 0; padding: 10px; border-radius: 4px; }
        .up { background-color: #d4edda; color: #155724; }
        .down { background-color: #f8d7da; color: #721c24; }
        .unknown { background-color: #fff3cd; color: #856404; }
    </style>
</head>
<body>
    <h1>Traction System Status</h1>
    <p>Last updated: <span id="timestamp"></span></p>
    
    <h2>Components</h2>
    <div id="components">Loading status...</div>
    
    <script>
        document.getElementById('timestamp').textContent = new Date().toLocaleString();
        
        // In a real implementation, this would fetch status from an API
        const components = [
            { name: "Nginx", status: "up" },
            { name: "Tenant UI", status: "up" },
            { name: "Traction Agent", status: "up" },
            { name: "Controller", status: "up" }
        ];
        
        const container = document.getElementById('components');
        container.innerHTML = '';
        
        components.forEach(comp => {
            const div = document.createElement('div');
            div.className = 'status ' + comp.status;
            div.textContent = comp.name + ': ' + (comp.status === 'up' ? 'Online' : comp.status === 'down' ? 'Offline' : 'Unknown');
            container.appendChild(div);
        });
    </script>
</body>
</html>
EOF

    # Make sure Nginx can access it
    sudo chmod -R 755 $status_dir
    
    log "INFO" "Nginx monitoring endpoint setup completed"
    return 0
}

# Function to create custom error pages
create_error_pages() {
    log "INFO" "Creating custom error pages..."
    
    local error_pages_dir="/var/www/html/error"
    sudo mkdir -p $error_pages_dir
    
    # Create a 503 Service Temporarily Unavailable page
    sudo tee $error_pages_dir/503.html > /dev/null << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Service Temporarily Unavailable</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; display: flex; height: 100vh; justify-content: center; align-items: center; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; text-align: center; }
        h1 { color: #e74c3c; }
        p { margin-bottom: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Service Temporarily Unavailable</h1>
        <p>We're sorry, but the service is currently down for maintenance or experiencing technical difficulties.</p>
        <p>Please try again later. We apologize for any inconvenience.</p>
    </div>
</body>
</html>
EOF

    # Create a 404 Not Found page
    sudo tee $error_pages_dir/404.html > /dev/null << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Page Not Found</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; display: flex; height: 100vh; justify-content: center; align-items: center; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; text-align: center; }
        h1 { color: #3498db; }
        p { margin-bottom: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Page Not Found</h1>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <p>Please check the URL or go back to the homepage.</p>
    </div>
</body>
</html>
EOF

    # Set permissions
    sudo chmod -R 755 $error_pages_dir
    
    log "INFO" "Custom error pages created successfully"
    return 0
}

# Update Nginx configuration with error pages
update_nginx_with_error_pages() {
    local domain_name=$1
    local config_file="/etc/nginx/sites-available/traction-https.conf"
    
    log "INFO" "Updating Nginx configuration with custom error pages..."
    
    # Check if the configuration file exists
    if [ ! -f "$config_file" ]; then
        log "ERROR" "Nginx HTTPS configuration file does not exist"
        return 1
    fi
    
    # Add error pages to the server block
    sudo sed -i '/server {/a \    error_page 404 /error/404.html;\n    error_page 503 /error/503.html;\n    location ^~ /error/ {\n        root /var/www/html;\n        internal;\n    }' $config_file
    
    # Test and reload Nginx
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "Nginx configuration updated with custom error pages"
        return 0
    else
        log "ERROR" "Failed to update Nginx configuration with custom error pages"
        return 1
    fi
}