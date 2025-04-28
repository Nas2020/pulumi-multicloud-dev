// // File: src/aws/nginx/ssl-setup.ts
import * as pulumi from "@pulumi/pulumi";
import { NginxConfig } from "../types";

/**
 * Let's Encrypt SSL setup script for Nginx
 * @param serverName Domain name for the SSL certificate
 * @param letsEncryptEmail Email for Let's Encrypt registration
 */
export function getSslSetupScript(
    config: NginxConfig,
    serverName: string,
    letsEncryptEmail: string
): pulumi.Output<string> {
    return pulumi.interpolate`
# Only proceed with SSL setup if domain name was provided
if [ "$USE_SSL" = true ]; then
    # Create a shared SSL parameters file
    echo "===== Creating shared SSL parameters ====="
    mkdir -p /etc/nginx/snippets
    cat > /etc/nginx/snippets/ssl-params.conf <<EOL_SSL_PARAMS
# Strong SSL Configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:10m;
ssl_session_tickets off;
EOL_SSL_PARAMS

    # Create function for controller SSL setup
    mkdir -p /usr/local/bin
    cat > /usr/local/bin/setup_controller_ssl.sh <<'SETUP_CONTROLLER_SSL_SCRIPT'
#!/bin/bash

setup_controller_ssl() {
  local serverName="$1"
  local controllerIp="$2"

  echo "Running setup_controller_ssl with domain: ${serverName}, controller IP: ${config.controllerIp}"
  
  if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
    echo "Setting up SSL-enabled Controller server on port 3008..."
    
    # Create Controller server block with SSL
    cat > /etc/nginx/sites-available/controller <<EOL_CONTROLLER
server {
    listen 3008 ssl;
    server_name ${serverName};
    
    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/${serverName}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${serverName}/privkey.pem;
    
    # Include shared SSL parameters
    include /etc/nginx/snippets/ssl-params.conf;
    
    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Proxy configuration
    location / {
        proxy_pass http://${config.controllerIp}:3008;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        
        # WebSocket support
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        access_log /var/log/nginx/controller_ssl_access.log main;
        error_log /var/log/nginx/controller_ssl_error.log warn;
    }
}
EOL_CONTROLLER

    # Enable the Controller site
    ln -sf /etc/nginx/sites-available/controller /etc/nginx/sites-enabled/controller
    
    # Test and reload Nginx
    nginx -t && systemctl reload nginx
    
    echo "SSL-enabled Controller server configuration complete"
  else
    echo "SSL certificates not found, skipping Controller SSL setup"
    
    # Create non-SSL Controller server as fallback
    cat > /etc/nginx/sites-available/controller <<EOL_CONTROLLER
server {
    listen 3008;
    server_name ${serverName};
    
    location / {
        proxy_pass http://${config.controllerIp}:3008;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        
        # WebSocket support
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        access_log /var/log/nginx/controller_access.log main;
        error_log /var/log/nginx/controller_error.log warn;
    }
}
EOL_CONTROLLER
    
    # Enable the Controller site
    ln -sf /etc/nginx/sites-available/controller /etc/nginx/sites-enabled/controller
    
    # Test and reload Nginx
    nginx -t && systemctl reload nginx
  fi
}

# Export the function so it can be sourced
export -f setup_controller_ssl
SETUP_CONTROLLER_SSL_SCRIPT

    # Make the script executable
    chmod +x /usr/local/bin/setup_controller_ssl.sh

    # Source the API SSL setup function
    source /usr/local/bin/setup_api_ssl.sh
    
    # Source the Controller SSL setup function
    source /usr/local/bin/setup_controller_ssl.sh
    
    # Source the deploy SSL config function
    source /usr/local/bin/deploy_ssl_config.sh

    # Source environment variables if they exist
    if [ -f /etc/environment ]; then
        source /etc/environment
    fi

    # Verify we have the required variables or provide fallbacks
    if [ -z "$TRACTION_IP" ]; then
        echo "WARNING: TRACTION_IP not found in environment, using fallback"
        export TRACTION_IP="127.0.0.1"  # Default fallback
    fi

    if [ -z "$CONTROLLER_IP" ]; then
        echo "WARNING: CONTROLLER_IP not found in environment, using fallback"
        export CONTROLLER_IP="127.0.0.1"  # Default fallback
    fi

    if [ -z "$SERVER_NAME" ]; then
        echo "WARNING: SERVER_NAME not found in environment, using provided value"
        export SERVER_NAME="${serverName}"
    fi

    # Log the values for debugging
    echo "Using SERVER_NAME: $SERVER_NAME"
    echo "Using TRACTION_IP: $TRACTION_IP"
    echo "Using CONTROLLER_IP: $CONTROLLER_IP"

    # Create state directories for Let's Encrypt
    echo "===== Setting up Let's Encrypt state directories ====="
    mkdir -p /var/lib/certbot
    mkdir -p /var/lib/letsencrypt
    mkdir -p /etc/letsencrypt/renewal-hooks/post/

    # Create flag file paths
    CERT_REQUEST_FLAG="/var/lib/certbot/cert_requested_\${SERVER_NAME//[^a-zA-Z0-9]/_}"

    # Function to check DNS
    check_dns_resolution() {
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
    
    # Check if DNS is properly configured
    verify_dns_configuration() {
        local domain="$1"
        local server_ip="$2"
        local max_retries="$3"
        local retry_delay="$4"
        local dns_check_success=false

        # First attempt
        echo "Starting initial DNS check for domain $domain to IP $server_ip at $(date)"
        if check_dns_resolution "$domain" "$server_ip"; then
            dns_check_success=true
            echo "Initial DNS check succeeded at $(date)"
        else
            echo "Initial DNS check failed at $(date). Domain $domain does not resolve to $server_ip"
            echo "Will retry periodically every $retry_delay seconds for up to $max_retries attempts"
            
            for retry in $(seq 1 $max_retries); do
                echo "Starting DNS retry attempt $retry of $max_retries at $(date). Waiting $retry_delay seconds before checking."
                sleep $retry_delay
                echo "Performing DNS check at $(date)"
                
                if check_dns_resolution "$domain" "$server_ip"; then
                    dns_check_success=true
                    echo "DNS check succeeded at $(date) after $retry retries"
                    break
                else
                    echo "DNS check failed at $(date): domain $domain does not resolve to $server_ip"
                fi
            done
            
            if [ "$dns_check_success" = false ]; then
                echo "All $max_retries DNS retry attempts failed. Domain $domain does not resolve to $server_ip at $(date)"
            fi
        fi
        
        # Return result
        if [ "$dns_check_success" = true ]; then
            return 0  # Success
        else
            return 1  # Failure
        fi
    }

    # Check DNS
    echo "===== Checking DNS ====="
    if verify_dns_configuration "$SERVER_NAME" "$PUBLIC_IP" 72 300; then
        echo "===== DNS check passed ====="
        
        # Check if certificate already exists
        if [ -d "/etc/letsencrypt/live/$SERVER_NAME" ]; then
            echo "Certificate already exists, skipping certificate request"
            
            # Call setup functions for existing certificates
            echo "Configuring SSL for API and Controller with existing certificate"
            setup_api_ssl "$SERVER_NAME" "$TRACTION_IP"
            setup_controller_ssl "$SERVER_NAME" "$CONTROLLER_IP"
            
            # Deploy the SSL configuration for the main site
            echo "Deploying SSL configuration for main site"
            deploy_ssl_config "$SERVER_NAME"
        elif [ -f "$CERT_REQUEST_FLAG" ]; then
            echo "Certificate was previously requested, skipping to avoid rate limits"
        else
            echo "===== Requesting Let's Encrypt certificate ====="
            mkdir -p "$(dirname "$CERT_REQUEST_FLAG")"
            
            # Add a slight delay to ensure Nginx is fully started
            sleep 5
            
            # Track certificate success
            cert_success=false
            
            # Attempt certificate request with retries
            for attempt in {1..3}; do
                echo "Attempt $attempt of 3 to obtain certificate at $(date)"
                if certbot --nginx -d "$SERVER_NAME" --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; then
                    echo "Certificate successfully obtained"
                    touch "$CERT_REQUEST_FLAG"
                    cert_success=true
                    
                    # Update Nginx SSL configuration with stronger settings
                    cat > /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh <<EOL2
#!/bin/bash
# Add stronger SSL parameters after certificate issuance/renewal

# Check and update default site
if ! grep -q "include /etc/nginx/snippets/ssl-params.conf" /etc/nginx/sites-available/default; then
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
            print "    # Include shared SSL parameters"
            print "    include /etc/nginx/snippets/ssl-params.conf;"
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
                    
                    # Set up API with SSL
                    echo "Calling setup_api_ssl with SERVER_NAME=$SERVER_NAME and TRACTION_IP=$TRACTION_IP"
                    setup_api_ssl "$SERVER_NAME" "$TRACTION_IP"
                    
                    # Set up Controller with SSL
                    echo "Calling setup_controller_ssl with SERVER_NAME=$SERVER_NAME and CONTROLLER_IP=$CONTROLLER_IP"
                    setup_controller_ssl "$SERVER_NAME" "$CONTROLLER_IP"
                    
                    # Deploy the main HTTPS server
                    echo "Deploying main HTTPS server configuration"
                    deploy_ssl_config "$SERVER_NAME"
                    
                    # Update configs with correct certificate paths if needed
                    echo "Updating API and Controller server blocks with SSL certificates"
                    certbot --nginx -d "$SERVER_NAME" --non-interactive --expand --agree-tos -m ${letsEncryptEmail}
                    
                    # Reload nginx to apply changes
                    nginx -t && systemctl reload nginx
                    break
                else
                    echo "Attempt $attempt failed at $(date)"
                    if [ $attempt -lt 3 ]; then
                        echo "Waiting 10 minutes before retrying to respect rate limits"
                        sleep 600
                    fi
                fi
            done
            
            # Mark attempt regardless of success
            touch "$CERT_REQUEST_FLAG"
            
            # Double-check certificate directory existence
            if [ "$cert_success" = false ] || [ ! -d "/etc/letsencrypt/live/$SERVER_NAME" ]; then
                echo "ERROR: All 3 attempts to obtain Let's Encrypt certificate failed at $(date)"
                echo "Domain: $SERVER_NAME, Public IP: $PUBLIC_IP"
                echo "Next retry via cron in 3 hours. Check /var/log/certbot-retry.log for updates."
                echo "Manual fix: certbot --nginx -d $SERVER_NAME --agree-tos -m ${letsEncryptEmail} --redirect"
                cat > /etc/cron.d/certbot-retry <<EOL3
# Attempt to request SSL certificate every 3 hours if not obtained
0 */3 * * * root [ ! -d "/etc/letsencrypt/live/$SERVER_NAME" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && certbot --nginx -d $SERVER_NAME --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect >> /var/log/certbot-retry.log 2>&1
EOL3
                chmod 644 /etc/cron.d/certbot-retry
            fi
        fi
    else
        echo "===== DNS check failed ====="
        echo "WARNING: $SERVER_NAME doesn't resolve to server's IP $PUBLIC_IP"
        echo "SSL certificate will not be obtained until DNS is properly configured."
        
        cat > /etc/cron.d/certbot-dns-check <<EOL4
# Check DNS and attempt certificate every 3 hours
0 */3 * * * root [ ! -d "/etc/letsencrypt/live/$SERVER_NAME" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && if [ "\\\$(dig +short $SERVER_NAME)" = "$PUBLIC_IP" ]; then certbot --nginx -d $SERVER_NAME --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; fi >> /var/log/certbot-dns-check.log 2>&1
EOL4
        chmod 644 /etc/cron.d/certbot-dns-check
        
        echo "Created automated job to check DNS and request certificate every 3 hours"
        echo "Manual command: certbot --nginx -d $SERVER_NAME --agree-tos -m ${letsEncryptEmail} --redirect"
    fi

    # Set up certificate auto-renewal hooks
    echo "===== Setting up certificate auto-renewal hooks ====="
    mkdir -p /etc/letsencrypt/renewal-hooks/post/
    cat > /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh <<EOL
#!/bin/bash
# Test Nginx configuration after certificate renewal
nginx -t && systemctl reload nginx

# In case any configuration needs to be updated after renewal
if [ -d "/etc/letsencrypt/live/$SERVER_NAME" ]; then
    # Source environment variables
    if [ -f /etc/environment ]; then
        source /etc/environment
    fi
    
    # Source the helper functions
    if [ -f /usr/local/bin/setup_api_ssl.sh ]; then
        source /usr/local/bin/setup_api_ssl.sh
    fi
    
    if [ -f /usr/local/bin/setup_controller_ssl.sh ]; then
        source /usr/local/bin/setup_controller_ssl.sh
    fi
    
    if [ -f /usr/local/bin/deploy_ssl_config.sh ]; then
        source /usr/local/bin/deploy_ssl_config.sh
    fi
    
    # Update SSL configurations if necessary
    if [ ! -z "$TRACTION_IP" ] && [ ! -z "$SERVER_NAME" ]; then
        setup_api_ssl "$SERVER_NAME" "$TRACTION_IP"
    fi
    
    if [ ! -z "$CONTROLLER_IP" ] && [ ! -z "$SERVER_NAME" ]; then
        setup_controller_ssl "$SERVER_NAME" "$CONTROLLER_IP"
    fi
    
    # Deploy main HTTPS configuration
    deploy_ssl_config "$SERVER_NAME"
fi
EOL
    chmod +x /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh
fi
`;
}