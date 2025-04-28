#!/bin/bash
# Domain Monitoring Module
# This script provides functions to monitor domain resolution and application status

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

# Function to monitor domain resolution status
monitor_domain() {
    local domain=$1
    local expected_ip=$(curl -s http://checkip.amazonaws.com || curl -s http://ifconfig.me)
    local output_file="/var/log/domain-monitor.log"
    
    log "INFO" "Setting up domain monitoring for $domain (expected IP: $expected_ip)"
    
    # Create monitoring script
    sudo tee /usr/local/bin/monitor-domain.sh > /dev/null << EOF
#!/bin/bash
DOMAIN="$domain"
EXPECTED_IP="$expected_ip"
LOG_FILE="$output_file"

echo "\\\$(date): Checking domain resolution for \\\$DOMAIN..." >> \\\$LOG_FILE

# Get resolved IP using dig
RESOLVED_IP=\\\$(dig +short \\\$DOMAIN)

if [ -z "\\\$RESOLVED_IP" ]; then
    echo "\\\$(date): Domain \\\$DOMAIN does not resolve to any IP address" >> \\\$LOG_FILE
    exit 1
elif [ "\\\$RESOLVED_IP" == "\\\$EXPECTED_IP" ]; then
    echo "\\\$(date): Domain \\\$DOMAIN correctly resolves to \\\$EXPECTED_IP" >> \\\$LOG_FILE
    exit 0
else
    echo "\\\$(date): Domain \\\$DOMAIN resolves to \\\$RESOLVED_IP (expected \\\$EXPECTED_IP)" >> \\\$LOG_FILE
    exit 1
fi
EOF

    # Make script executable
    sudo chmod +x /usr/local/bin/monitor-domain.sh
    
    # Add to crontab to run hourly
    (crontab -l 2>/dev/null || echo "") | grep -v "monitor-domain.sh" | \
    { cat; echo "0 * * * * /usr/local/bin/monitor-domain.sh"; } | \
    crontab -
    
    log "INFO" "Domain monitoring setup completed"
    return 0
}

# Function to check health of all application components
check_application_health() {
    local domain=$1
    local output_file="/var/log/application-health.log"
    
    log "INFO" "Setting up application health monitoring"
    
    # Create health check script
    sudo tee /usr/local/bin/check-application-health.sh > /dev/null << EOF
#!/bin/bash
DOMAIN="$domain"
LOG_FILE="$output_file"

echo "\\\$(date): Checking application health..." >> \\\$LOG_FILE

# Check if docker is running
if ! systemctl is-active --quiet docker; then
    echo "\\\$(date): Docker service is not running" >> \\\$LOG_FILE
    systemctl start docker
fi

# Check if nginx is running
if ! systemctl is-active --quiet nginx; then
    echo "\\\$(date): Nginx service is not running" >> \\\$LOG_FILE
    systemctl start nginx
fi

# Check if docker containers are running
cd /opt/traction-docker-compose/digicred
CONTAINER_COUNT=\\\$(docker-compose ps -q | wc -l)
if [ \\\$CONTAINER_COUNT -eq 0 ]; then
    echo "\\\$(date): No Docker containers running, starting services..." >> \\\$LOG_FILE
    docker-compose up -d
else
    # Check for any stopped containers
    STOPPED_COUNT=\\$(docker-compose ps | grep -i exit | wc -l)
    if [ \\\$STOPPED_COUNT -gt 0 ]; then
        echo "\\\$(date): \\\$STOPPED_COUNT containers are not running, restarting..." >> \\\$LOG_FILE
        docker-compose restart
    fi
fi

# Check if we can reach the tenant UI
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:5101/ | grep -q "200"; then
    echo "\\\$(date): Tenant UI is not responding" >> \\\$LOG_FILE
fi

# Check if we can reach the API proxy
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:8032/ | grep -q "200"; then
    echo "\\\$(date): API proxy is not responding" >> \\\$LOG_FILE
fi

# Check if the domain is accessible via HTTPS
if command -v openssl >/dev/null 2>&1; then
    if ! echo | openssl s_client -connect \\\${DOMAIN}:443 -servername \\\${DOMAIN} 2>/dev/null | grep -q "CONNECTED"; then
        echo "\\\$(date): HTTPS connection to \\\${DOMAIN} failed" >> \\\$LOG_FILE
    fi
fi

echo "\\\$(date): Health check completed" >> \\\$LOG_FILE
EOF

    # Make script executable
    sudo chmod +x /usr/local/bin/check-application-health.sh
    
    # Add to crontab to run every 15 minutes
    (crontab -l 2>/dev/null || echo "") | grep -v "check-application-health.sh" | \
    { cat; echo "*/15 * * * * /usr/local/bin/check-application-health.sh"; } | \
    crontab -
    
    log "INFO" "Application health monitoring setup completed"
    return 0
}

# Function to create a status dashboard
create_status_dashboard() {
    local domain=$1
    
    log "INFO" "Creating application status dashboard"
    
    # Create status directory
    sudo mkdir -p /var/www/html/status
    
    # Create dashboard script that generates status page
    sudo tee /usr/local/bin/update-status-dashboard.sh > /dev/null << EOF
#!/bin/bash
DOMAIN="$domain"
STATUS_DIR="/var/www/html/status"

# Get current status of services
DOCKER_STATUS=\\\$(systemctl is-active docker)
NGINX_STATUS=\\\$(systemctl is-active nginx)

# Count running containers
cd /opt/traction-docker-compose/digicred
TOTAL_CONTAINERS=\\\$(docker-compose ps -q | wc -l)
RUNNING_CONTAINERS=\\\$(docker-compose ps | grep -c "Up")

# Check SSL certificate
if [ -d "/etc/letsencrypt/live/\\\${DOMAIN}" ]; then
    CERT_EXPIRY=\\\$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/\${DOMAIN}/fullchain.pem | cut -d= -f2)
    SSL_STATUS="Valid (expires \\\${CERT_EXPIRY})"
else
    SSL_STATUS="Not configured"
fi

# Create HTML status page
cat > \\\${STATUS_DIR}/index.html << HTML
<!DOCTYPE html>
<html>
<head>
    <title>Traction Application Status</title>
    <meta http-equiv="refresh" content="60">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #2c3e50; }
        .status-item { margin-bottom: 10px; padding: 10px; border-radius: 4px; }
        .status-ok { background-color: #d4edda; color: #155724; }
        .status-warning { background-color: #fff3cd; color: #856404; }
        .status-error { background-color: #f8d7da; color: #721c24; }
        .timestamp { color: #6c757d; font-size: 0.9em; margin-top: 20px; }
    </style>
</head>
<body>
    <h1>Traction Application Status</h1>
    <div class="status-item \\\$([ "\\\$DOCKER_STATUS" = "active" ] && echo "status-ok" || echo "status-error")">
        Docker Service: \\\$DOCKER_STATUS
    </div>
    <div class="status-item \\\$([ "\\\$NGINX_STATUS" = "active" ] && echo "status-ok" || echo "status-error")">
        Nginx Service: \\\$NGINX_STATUS
    </div>
    <div class="status-item \\\$([ "\\\$RUNNING_CONTAINERS" -eq "\\\$TOTAL_CONTAINERS" ] && echo "status-ok" || echo "status-warning")">
        Docker Containers: \\\$RUNNING_CONTAINERS/\\\$TOTAL_CONTAINERS running
    </div>
    <div class="status-item \\\$([ "\\\$SSL_STATUS" != "Not configured" ] && echo "status-ok" || echo "status-warning")">
        SSL Certificate: \\\$SSL_STATUS
    </div>
    <div class="timestamp">
        Last updated: \\\$(date)
    </div>
</body>
</html>
HTML

chmod 755 \\\${STATUS_DIR}/index.html
EOF

    # Make script executable
    sudo chmod +x /usr/local/bin/update-status-dashboard.sh
    
    # Add to crontab to run every 5 minutes
    (crontab -l 2>/dev/null || echo "") | grep -v "update-status-dashboard.sh" | \
    { cat; echo "*/5 * * * * /usr/local/bin/update-status-dashboard.sh"; } | \
    crontab -
    
    # Run it once to create the initial dashboard
    sudo /usr/local/bin/update-status-dashboard.sh
    
    log "INFO" "Status dashboard created at http://$domain/status/"
    return 0
}

# Function to validate that all components are running properly
validate_deployment() {
    local domain=$1
    local output_file="/var/log/deployment-validation.log"
    
    log "INFO" "Validating deployment for domain: $domain"
    
    # Create initial validation report
    echo "Deployment Validation Report" > "$output_file"
    echo "=========================" >> "$output_file"
    echo "Timestamp: $(date)" >> "$output_file"
    echo "Domain: $domain" >> "$output_file"
    echo "" >> "$output_file"
    
    # 1. Check system services
    echo "1. System Services" >> "$output_file"
    echo "-----------------" >> "$output_file"
    
    echo "Docker: $(systemctl is-active docker)" >> "$output_file"
    echo "Nginx: $(systemctl is-active nginx)" >> "$output_file"
    echo "" >> "$output_file"
    
    # 2. Check domain resolution
    echo "2. Domain Resolution" >> "$output_file"
    echo "------------------" >> "$output_file"
    
    local expected_ip=$(curl -s http://checkip.amazonaws.com || curl -s http://ifconfig.me)
    local resolved_ip=$(dig +short "$domain")
    
    echo "Server IP: $expected_ip" >> "$output_file"
    echo "Domain resolves to: $resolved_ip" >> "$output_file"
    echo "Resolution status: $([ "$resolved_ip" == "$expected_ip" ] && echo "CORRECT" || echo "INCORRECT")" >> "$output_file"
    echo "" >> "$output_file"
    
    # 3. Check SSL certificate
    echo "3. SSL Certificate" >> "$output_file"
    echo "----------------" >> "$output_file"
    
    if [ -d "/etc/letsencrypt/live/$domain" ]; then
        local cert_issuer=$(openssl x509 -issuer -noout -in "/etc/letsencrypt/live/$domain/cert.pem" | cut -d= -f2-)
        local cert_expiry=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$domain/cert.pem" | cut -d= -f2)
        
        echo "Certificate issued by: $cert_issuer" >> "$output_file"
        echo "Certificate valid until: $cert_expiry" >> "$output_file"
        echo "Status: VALID" >> "$output_file"
    else
        echo "No SSL certificate found" >> "$output_file"
        echo "Status: MISSING" >> "$output_file"
    fi
    echo "" >> "$output_file"
    
    # 4. Check Docker containers
    echo "4. Docker Containers" >> "$output_file"
    echo "------------------" >> "$output_file"
    
    cd /opt/traction-docker-compose/digicred
    docker-compose ps >> "$output_file"
    echo "" >> "$output_file"
    
    # 5. Check endpoint accessibility
    echo "5. Endpoint Accessibility" >> "$output_file"
    echo "-----------------------" >> "$output_file"
    
    # Check HTTP
    local http_status=$(curl -s -o /dev/null -w "%{http_code}" "http://$domain/")
    echo "HTTP ($domain): $http_status" >> "$output_file"
    
    # Check HTTPS
    local https_status=$(curl -s -o /dev/null -w "%{http_code}" --insecure "https://$domain/")
    echo "HTTPS ($domain): $https_status" >> "$output_file"
    
    # Check specific endpoints
    local endpoints=(
        "/proxy/"
        "/agent/"
        "/controller/"
    )
    
    for endpoint in "${endpoints[@]}"; do
        local endpoint_status=$(curl -s -o /dev/null -w "%{http_code}" --insecure "https://$domain$endpoint")
        echo "HTTPS ($domain$endpoint): $endpoint_status" >> "$output_file"
    done
    
    echo "" >> "$output_file"
    echo "Validation completed: $(date)" >> "$output_file"
    
    log "INFO" "Deployment validation completed. Report saved to $output_file"
    return 0
}

# Function to setup email notifications for issues
setup_notification() {
    local domain=$1
    local admin_email=$2
    
    log "INFO" "Setting up notifications for domain: $domain to email: $admin_email"
    
    # Install mail utilities if not present
    if ! command -v mail >/dev/null 2>&1; then
        sudo apt-get update
        sudo apt-get install -y mailutils
    fi
    
    # Create notification script
    sudo tee /usr/local/bin/send-status-notification.sh > /dev/null << EOF
#!/bin/bash
DOMAIN="$domain"
ADMIN_EMAIL="$admin_email"
HOSTNAME=\\\$(hostname)

# Check critical services
ISSUES=()

# Check Docker
if ! systemctl is-active --quiet docker; then
    ISSUES+=("Docker service is not running")
fi

# Check Nginx
if ! systemctl is-active --quiet nginx; then
    ISSUES+=("Nginx service is not running")
fi

# Check containers
cd /opt/traction-docker-compose/digicred
if ! docker-compose ps | grep -q "Up"; then
    ISSUES+=("No Docker containers are running")
fi

# Check SSL certificate
if [ -d "/etc/letsencrypt/live/\\\$DOMAIN" ]; then
    # Check if certificate is expiring soon (15 days)
    EXPIRY=\\\$(date -d "\\\$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/\\\$DOMAIN/fullchain.pem | cut -d= -f2)" +%s)
    NOW=\\\$(date +%s)
    DAYS_LEFT=\\\$(( (\\\$EXPIRY - \\\$NOW) / 86400 ))
    
    if [ \\\$DAYS_LEFT -lt 15 ]; then
        ISSUES+=("SSL certificate is expiring in \\\$DAYS_LEFT days")
    fi
else
    ISSUES+=("SSL certificate is not installed")
fi

# Send notification if there are issues
if [ \\\${#ISSUES[@]} -gt 0 ]; then
    SUBJECT="[\\\$HOSTNAME] Traction Application Alert"
    BODY="The following issues were detected on the Traction application server (\\\$HOSTNAME):\\n\\n"
    
    for ISSUE in "\\\${ISSUES[@]}"; do
        BODY+="\\\$ISSUE\\n"
    done
    
    BODY+="\\nPlease login to the server and check the logs for more details.\\n"
    BODY+="\\nServer: \$HOSTNAME\\n"
    BODY+="Domain: \$DOMAIN\\n"
    BODY+="Time: \$(date)\\n"
    
    echo -e "\$BODY" | mail -s "\$SUBJECT" \$ADMIN_EMAIL
fi
EOF

    # Make script executable
    sudo chmod +x /usr/local/bin/send-status-notification.sh
    
    # Add to crontab to run daily
    (crontab -l 2>/dev/null || echo "") | grep -v "send-status-notification.sh" | \
    { cat; echo "0 8 * * * /usr/local/bin/send-status-notification.sh"; } | \
    crontab -
    
    log "INFO" "Notification setup completed"
    return 0
}