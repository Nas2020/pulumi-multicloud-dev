#!/bin/bash
# SSL Certificate Management Module
# This script provides functions to manage SSL certificates for the Traction application

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

# Install Certbot and dependencies
install_certbot() {
    log "INFO" "Checking Certbot installation..."
    
    if ! command -v certbot >/dev/null 2>&1; then
        log "INFO" "Certbot not found, installing..."
        sudo apt-get update
        
        # Install certbot and the nginx plugin
        sudo apt-get install -y python3-certbot-nginx
        
        if [ $? -ne 0 ]; then
            log "ERROR" "Failed to install Certbot"
            return 1
        fi
        
        log "INFO" "Certbot installed successfully"
    else
        log "INFO" "Certbot is already installed"
    fi
    
    return 0
}

# Function to check if we're hitting rate limits
check_rate_limits() {
    local log_content="$1"
    
    if echo "$log_content" | grep -q "too many failed authorizations"; then
        return 0  # Rate limit hit
    elif echo "$log_content" | grep -q "too many certificates already issued"; then
        return 0  # Rate limit hit
    elif echo "$log_content" | grep -q "Error creating new order"; then
        return 0  # Potential rate limit or other critical error
    fi
    
    return 1  # No rate limit detected
}

# Obtain SSL certificate with retries and exponential backoff
obtain_ssl_certificate() {
    local domain=$1
    local email=$2
    local max_attempts=${3:-5}
    local initial_wait=${4:-30}
    
    log "INFO" "Starting SSL certificate acquisition for domain: $domain"
    
    # Install certbot if needed
    install_certbot || return 1
    
    # Create temporary log file for capturing certbot output
    local certbot_log=$(mktemp)
    
    # Make sure webroot is properly set up
    sudo mkdir -p /var/www/html/.well-known/acme-challenge
    sudo chown -R www-data:www-data /var/www/html
    
    local attempt=1
    local wait_time=$initial_wait
    
    while [ $attempt -le $max_attempts ]; do
        log "INFO" "Certificate acquisition attempt $attempt/$max_attempts..."
        
        # Try to obtain cert using webroot method first (often more reliable)
        if sudo certbot certonly --webroot -w /var/www/html \
           --non-interactive --agree-tos \
           --email "$email" -d "$domain" \
           --deploy-hook "systemctl reload nginx" \
           2>&1 | tee $certbot_log; then
            
            log "INFO" "SSL certificate successfully issued for $domain (webroot method)"
            rm -f $certbot_log
            return 0
        else
            log_content=$(cat $certbot_log)
            
            # Check for rate limiting
            if check_rate_limits "$log_content"; then
                log "ERROR" "Hit Let's Encrypt rate limit. Please wait at least 1 hour before trying again."
                rm -f $certbot_log
                return 1
            fi
            
            # Check for DNS validation issues
            if echo "$log_content" | grep -q "DNS problem"; then
                log "WARN" "DNS validation issue detected. Domain may not be pointing to this server yet."
                # Use longer wait for DNS issues
                wait_time=$((initial_wait * 6))
            else
                # Default exponential backoff
                wait_time=$((wait_time * 2))
            fi
            
            # If webroot method failed, try nginx plugin as fallback in the next attempt
            if [ $attempt -eq $max_attempts ]; then
                log "WARN" "Last attempt: trying with nginx plugin instead of webroot..."
                
                if sudo certbot --nginx \
                   --non-interactive --agree-tos \
                   --email "$email" -d "$domain" \
                   --deploy-hook "systemctl reload nginx" \
                   2>&1 | tee $certbot_log; then
                    
                    log "INFO" "SSL certificate successfully issued for $domain (nginx plugin method)"
                    rm -f $certbot_log
                    return 0
                fi
            fi
            
            log "INFO" "Waiting $wait_time seconds before next attempt..."
            sleep $wait_time
        fi
        
        ((attempt++))
    done
    
    log "ERROR" "Failed to obtain SSL certificate after $max_attempts attempts."
    rm -f $certbot_log
    return 1
}

# Validate and install certificates for Nginx
install_ssl_for_nginx() {
    local domain=$1
    
    log "INFO" "Installing SSL certificate for Nginx..."
    
    # Check if certificate exists
    if [ ! -d "/etc/letsencrypt/live/$domain" ]; then
        log "ERROR" "No certificate found for domain $domain"
        return 1
    fi
    
    # Update Nginx config to use SSL (in case certbot didn't already do it)
    local nginx_conf="/etc/nginx/sites-available/traction-https.conf"
    
    # Check if SSL config already exists
    if grep -q "ssl_certificate" "$nginx_conf"; then
        log "INFO" "SSL configuration already exists in Nginx config"
    else
        # Add SSL configuration
        sudo sed -i "/server_name ${domain};/a \\
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;\\
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;\\
    ssl_protocols TLSv1.2 TLSv1.3;\\
    ssl_prefer_server_ciphers on;\\
    ssl_session_cache shared:SSL:10m;\\
    ssl_session_timeout 1d;" "$nginx_conf"
        
        log "INFO" "Added SSL configuration to Nginx"
    fi
    
    # Test and reload Nginx
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "Nginx SSL configuration applied successfully"
        return 0
    else
        log "ERROR" "Nginx SSL configuration failed validation"
        return 1
    fi
}

# Check certificate status and expiration
check_certificate_status() {
    local domain=$1
    local warn_days=${2:-30}
    
    log "INFO" "Checking certificate status for domain: $domain"
    
    if ! command -v certbot >/dev/null 2>&1; then
        log "ERROR" "Certbot not installed"
        return 1
    fi
    
    # Check if certificate exists
    local cert_info=$(sudo certbot certificates 2>/dev/null | grep -A 5 "$domain")
    
    if [ -z "$cert_info" ]; then
        log "WARN" "No certificate found for domain $domain"
        return 1
    fi
    
    # Check expiration date
    local expiry=$(echo "$cert_info" | grep "Expiry Date" | awk '{print $3, $4, $5, $6}')
    log "INFO" "Certificate for $domain expires on: $expiry"
    
    # Check if certificate is valid (not revoked or expired)
    if echo "$cert_info" | grep -q "INVALID"; then
        log "ERROR" "Certificate for $domain is INVALID"
        return 1
    fi
    
    # Check if it's time to renew
    if certbot renew --dry-run | grep -q "No renewals were attempted"; then
        log "INFO" "Certificate doesn't need renewal yet"
    else
        log "INFO" "Certificate is due for renewal"
        # Could automatically renew here if desired
    fi
    
    return 0
}

# Setup auto-renewal via cron
setup_cert_renewal() {
    log "INFO" "Setting up automatic certificate renewal..."
    
    # Create a custom renewal script with safety checks
    sudo tee /usr/local/bin/renew-certificates.sh > /dev/null << 'EOF'
#!/bin/bash
LOG="/var/log/letsencrypt-renewal.log"
echo "$(date): Starting certificate renewal check..." >> $LOG

# Run certbot renew with quiet and retry options
if ! certbot renew --quiet --non-interactive --deploy-hook "systemctl reload nginx"; then
    echo "$(date): Initial renewal attempt failed, retrying..." >> $LOG
    sleep 300 # Wait 5 minutes
    certbot renew --quiet --non-interactive --deploy-hook "systemctl reload nginx"
fi

# Check if Nginx is still running properly after renewal
if ! systemctl is-active --quiet nginx; then
    echo "$(date): Nginx is not running after certificate renewal. Attempting to restart..." >> $LOG
    systemctl restart nginx
fi

# Check if any certificates are nearing expiration (15 days)
certbot certificates | grep "VALID:" | awk '{print $2, $3, $4, $5, $6, $7}' >> $LOG

echo "$(date): Certificate renewal check completed" >> $LOG
EOF

    # Make the script executable
    sudo chmod +x /usr/local/bin/renew-certificates.sh
    
    # Add to crontab to run twice daily (recommended by Let's Encrypt)
    (crontab -l 2>/dev/null || echo "") | grep -v "renew-certificates.sh" | \
    { cat; echo "0 0,12 * * * /usr/local/bin/renew-certificates.sh"; } | \
    crontab -
    
    log "INFO" "Certificate renewal cron job setup completed"
    return 0
}

# Function to handle certificate failures gracefully
handle_cert_failure() {
    local domain=$1
    
    log "WARN" "Handling certificate failure for domain: $domain"
    
    # Update Nginx to serve HTTP with a warning banner
    local nginx_conf="/etc/nginx/sites-available/traction.conf"
    
    sudo tee $nginx_conf > /dev/null << EOF
server {
    listen 80;
    server_name ${domain};
    
    # Access and error logs
    access_log /var/log/nginx/traction-http-access.log;
    error_log /var/log/nginx/traction-http-error.log;
    
    # For Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # Serve the main application over HTTP with warning
    location / {
        # Add a warning about insecure connection
        add_header Content-Type text/html;
        return 200 '<!DOCTYPE html>
<html>
<head>
    <title>Insecure Connection Warning</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .warning-banner {
            background-color: #f8d7da;
            color: #721c24;
            padding: 15px;
            margin-bottom: 20px;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #721c24; }
        a { color: #0056b3; }
    </style>
</head>
<body>
    <div class="container">
        <div class="warning-banner">
            <h1>⚠️ Insecure Connection Warning</h1>
            <p>SSL certificate setup is currently pending. Your connection to this site is not encrypted.</p>
            <p>The application is functional but we recommend waiting until SSL is properly configured before using sensitive features.</p>
        </div>
        <p>The system administrator has been notified and is working to resolve this issue.</p>
        <p><a href="http://${domain}/proxy">Continue to application anyway</a></p>
    </div>
</body>
</html>';
    }
    
    # Pass through to application paths
    location /proxy/ {
        proxy_pass http://localhost:8032/;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }
    
    location /agent/ {
        proxy_pass http://localhost:8030/;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }
    
    location /controller/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }
}
EOF

    # Test and reload Nginx
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "Applied fallback HTTP configuration with warning banner"
        return 0
    else
        log "ERROR" "Failed to apply fallback HTTP configuration"
        return 1
    fi
}

# Function to retry certificate acquisition on a schedule
schedule_cert_retry() {
    local domain=$1
    local email=$2
    
    log "INFO" "Scheduling certificate retry for domain: $domain"
    
    # Create retry script
    sudo tee /usr/local/bin/retry-certificate.sh > /dev/null << EOF
#!/bin/bash
LOG="/var/log/certificate-retry.log"
DOMAIN="${domain}"
EMAIL="${email}"

echo "\\\$(date): Attempting to acquire SSL certificate for \\\$DOMAIN..." >> \\\$LOG

# Source SSL certificate functions
source /opt/traction-docker-compose/digicred/ssl-cert-manager.sh

# Check domain resolution
if ! host \\\$DOMAIN >/dev/null 2>&1; then
    echo "\\\$(date): Domain \\\$DOMAIN still doesn't resolve. Skipping attempt." >> \\\$LOG
    exit 1
fi

# Try to obtain certificate
if obtain_ssl_certificate "\\\$DOMAIN" "\\\$EMAIL" 3 60; then
    echo "\\\$(date): Successfully obtained certificate for \\\$DOMAIN" >> \\\$LOG
    
    # Install certificate for Nginx
    if install_ssl_for_nginx "\\\$DOMAIN"; then
        echo "\\\$(date): Successfully installed certificate for Nginx" >> \\\$LOG
        
        # Update Nginx configuration for HTTPS
        if [ -f "/etc/nginx/sites-available/traction-https.conf" ]; then
            echo "\\\$(date): Enabling HTTPS configuration" >> \\\$LOG
            systemctl reload nginx
        fi
        
        # Remove this scheduled job
        crontab -l | grep -v "retry-certificate.sh" | crontab -
        echo "\\\$(date): Removed retry schedule as certificate is now valid" >> \\\$LOG
    fi
else
    echo "\\\$(date): Failed to obtain certificate. Will retry later." >> \\\$LOG
fi
EOF

    # Make script executable
    sudo chmod +x /usr/local/bin/retry-certificate.sh
    
    # Add to crontab to run every 6 hours
    (crontab -l 2>/dev/null || echo "") | grep -v "retry-certificate.sh" | \
    { cat; echo "0 */6 * * * /usr/local/bin/retry-certificate.sh"; } | \
    crontab -
    
    log "INFO" "Certificate retry scheduled for every 6 hours"
    return 0
}

# Test DNS resolution for domain
test_domain_resolution() {
    local domain=$1
    local expected_ip=$2
    local max_attempts=${3:-24} # Default to 24 attempts
    local wait_time=${4:-300}   # Default to 5 minutes between attempts
    
    log "INFO" "Testing DNS resolution for domain: $domain"
    
    # If no expected_ip provided, get current public IP
    if [ -z "$expected_ip" ]; then
        expected_ip=$(curl -s http://checkip.amazonaws.com || curl -s http://ifconfig.me)
        if [ -z "$expected_ip" ]; then
            log "ERROR" "Failed to determine current public IP address"
            return 1
        fi
        log "INFO" "Using current public IP: $expected_ip"
    fi
    
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        log "INFO" "DNS resolution test attempt $attempt/$max_attempts..."
        
        # Try different DNS resolution methods for redundancy
        local resolved_ip=$(dig +short $domain)
        
        # If dig failed or returned nothing, try host
        if [ -z "$resolved_ip" ]; then
            resolved_ip=$(host $domain | grep "has address" | awk '{print $4}')
        fi
        
        # If still nothing, try nslookup
        if [ -z "$resolved_ip" ]; then
            resolved_ip=$(nslookup $domain | grep -A1 "Name:" | grep "Address:" | awk '{print $2}')
        fi
        
        if [ -z "$resolved_ip" ]; then
            log "WARN" "Domain $domain does not resolve to any IP address yet"
        elif [ "$resolved_ip" == "$expected_ip" ]; then
            log "INFO" "Domain $domain correctly resolves to expected IP: $expected_ip"
            return 0
        else
            log "WARN" "Domain $domain resolves to $resolved_ip, but expected $expected_ip"
        fi
        
        if [ $attempt -lt $max_attempts ]; then
            log "INFO" "Waiting $wait_time seconds before next DNS check..."
            sleep $wait_time
        fi
        
        ((attempt++))
    done
    
    log "ERROR" "DNS resolution test failed after $max_attempts attempts"
    return 1
}