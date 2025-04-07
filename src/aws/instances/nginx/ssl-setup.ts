// File: src/aws/nginx/ssl-setup.ts
import * as pulumi from "@pulumi/pulumi";

/**
 * Let's Encrypt SSL setup script for Nginx
 * @param serverName Domain name for the SSL certificate
 * @param letsEncryptEmail Email for Let's Encrypt registration
 */
export function getSslSetupScript(
    serverName: string,
    letsEncryptEmail: string
): pulumi.Output<string> {
    return pulumi.interpolate`
# Only proceed with SSL setup if domain name was provided
if [ "$USE_SSL" = true ]; then
    # Source the setup_api_ssl function
    source /usr/local/bin/setup_api_ssl.sh

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
        
        # Check if certificate already exists - using correct directory test
        if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
            echo "Certificate already exists, skipping certificate request"
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
                if certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail}; then
                    echo "Certificate successfully obtained"
                    touch "$CERT_REQUEST_FLAG"
                    cert_success=true
                    
                    # Create proper HTTPS configuration for main site
                    echo "Creating HTTPS configuration for main site on port 443"
                    
                    # Create the HTTPS server configuration
                    cat > /etc/nginx/sites-available/default-ssl <<EOL_SSL
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name ${serverName};

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/${serverName}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${serverName}/privkey.pem;
    
    # SSL Parameters
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "connect-src *;" always;

    # Basic settings
    client_max_body_size 64M;

    # Main logging
    access_log /var/log/nginx/ssl_access.log main buffer=512k flush=1m;
    error_log /var/log/nginx/ssl_error.log warn;

    # Timeouts
    client_body_timeout 60s;
    client_header_timeout 60s;
    keepalive_timeout 75s;
    send_timeout 60s;

    # Global proxy settings
    proxy_buffers 8 16k;
    proxy_buffer_size 16k;
    proxy_busy_buffers_size 32k;

    # Let's Encrypt cert validation path
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }

    # Static assets with caching
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://$TRACTION_IP:5101;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        
        # Caching settings
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        proxy_cache_valid 200 7d;
        
        access_log off;
    }

    # Root location redirects to Traction UI
    location / {
        proxy_pass http://$TRACTION_IP:5101;
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
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
        proxy_intercept_errors on;
        proxy_buffering on;
        access_log /var/log/nginx/traction_ui_ssl_access.log main buffer=512k;
        error_log /var/log/nginx/traction_ui_ssl_error.log warn;
    }

    location /assets/ {
        proxy_pass http://$TRACTION_IP:5101;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        proxy_cache_valid 200 7d;
    }

    location /img/ {
        proxy_pass http://$TRACTION_IP:5101;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    # Keep the controller path for admin access 
    location /controller/ {
        rewrite ^/controller/(.*) / break;
        access_log /var/log/nginx/controller_ssl_access.log main buffer=512k;
        error_log /var/log/nginx/controller_ssl_error.log warn;
        proxy_pass http://$CONTROLLER_IP:80;
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

    # Useful redirects
    location = /traction {
        return 301 /;
    }
    
    location = /controller {
        return 301 /controller/;
    }

    # Custom error page
    error_page 502 503 504 /maintenance.html;
    location = /maintenance.html {
        root /var/www/html;
        internal;
    }

    # Health check endpoint
    location = /health {
        access_log off;
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
EOL_SSL

                    # Enable the SSL configuration
                    ln -sf /etc/nginx/sites-available/default-ssl /etc/nginx/sites-enabled/
                    
                    # Update SSL parameters for main Nginx configuration
                    cat > /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh <<EOL2
#!/bin/bash
# Add stronger SSL parameters after certificate issuance/renewal
if ! grep -q "ssl_protocols TLSv1.2 TLSv1.3" /etc/nginx/sites-available/default-ssl; then
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
    ' /etc/nginx/sites-available/default-ssl > \\\$TEMP_FILE
    
    # If the temp file has content, replace the config
    if [ -s \\\$TEMP_FILE ]; then
        cat \\\$TEMP_FILE > /etc/nginx/sites-available/default-ssl
        nginx -t && systemctl reload nginx
    fi
    
    # Clean up
    rm \\\$TEMP_FILE
fi
EOL2
                    chmod +x /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
                    /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
                    
                    # Call setup_api_ssl function to configure SSL for API server
                    echo "Calling setup_api_ssl with SERVER_NAME=$SERVER_NAME and TRACTION_IP=$TRACTION_IP"
                    setup_api_ssl "$SERVER_NAME" "$TRACTION_IP"
                    
                    # Test the Nginx configuration and reload if successful
                    if nginx -t; then
                        echo "Nginx configuration test successful, reloading Nginx"
                        systemctl reload nginx
                    else
                        echo "ERROR: Nginx configuration test failed"
                    fi
                    
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
            
            # Double-check certificate directory existence with proper -d test
            if [ "$cert_success" = false ] || [ ! -d "/etc/letsencrypt/live/${serverName}" ]; then
                echo "ERROR: All 3 attempts to obtain Let's Encrypt certificate failed at $(date)"
                echo "Domain: ${serverName}, Public IP: $PUBLIC_IP"
                echo "Next retry via cron in 3 hours. Check /var/log/certbot-retry.log for updates."
                echo "Manual fix: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail} --redirect"
                cat > /etc/cron.d/certbot-retry <<EOL3
# Attempt to request SSL certificate every 3 hours if not obtained
0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} >> /var/log/certbot-retry.log 2>&1 && if [ -d "/etc/letsencrypt/live/${serverName}" ]; then bash -c 'source /usr/local/bin/setup_api_ssl.sh && source /etc/environment && setup_api_ssl "${serverName}" "$TRACTION_IP"' >> /var/log/certbot-retry.log 2>&1; fi
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
0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && if [ "\\\$(dig +short ${serverName})" = "$PUBLIC_IP" ]; then certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} >> /var/log/certbot-dns-check.log 2>&1 && if [ -d "/etc/letsencrypt/live/${serverName}" ]; then bash -c 'source /usr/local/bin/setup_api_ssl.sh && source /etc/environment && setup_api_ssl "${serverName}" "$TRACTION_IP"' >> /var/log/certbot-dns-check.log 2>&1; fi; fi
EOL4
        chmod 644 /etc/cron.d/certbot-dns-check
        
        echo "Created automated job to check DNS and request certificate every 3 hours"
        echo "Manual command: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail}"
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
    
    echo "===== Nginx setup with Let's Encrypt SSL complete at $(date) ====="
fi
`;
}



// import * as pulumi from "@pulumi/pulumi";

// /**
//  * Let's Encrypt SSL setup script for Nginx
//  * @param serverName Domain name for the SSL certificate
//  * @param letsEncryptEmail Email for Let's Encrypt registration
//  */
// export function getSslSetupScript(
//     serverName: string,
//     letsEncryptEmail: string
// ): pulumi.Output<string> {
//     return pulumi.interpolate`
// # Only proceed with SSL setup if domain name was provided
// if [ "$USE_SSL" = true ]; then
//     # Create state directories for Let's Encrypt
//     echo "===== Setting up Let's Encrypt state directories ====="
//     mkdir -p /var/lib/certbot
//     mkdir -p /var/lib/letsencrypt
//     mkdir -p /etc/letsencrypt/renewal-hooks/post/

//     # Create flag file paths
//     CERT_REQUEST_FLAG="/var/lib/certbot/cert_requested_\${serverName//[^a-zA-Z0-9]/_}"

//     # Check if DNS is properly configured
//     echo "===== Checking DNS ====="
    
//     # Function to check DNS
//     check_dns() {
//         local domain="$1"
//         local server_ip="$2"
//         local domain_ip
        
//         domain_ip=$(dig +short "$domain" || echo "DNS lookup failed")
        
//         echo "Domain $domain resolves to: $domain_ip"
//         echo "Server public IP: $server_ip"
        
//         # Check if domain resolves to our IP
//         if [ "$domain_ip" = "$server_ip" ]; then
//             return 0  # Success
//         else
//             return 1  # Failure
//         fi
//     }
    
//     # Initial DNS check
//     dns_check_success=false

//     # First DNS check attempt
//     echo "Starting initial DNS check for domain ${serverName} to IP $PUBLIC_IP at $(date)"
//     if check_dns "${serverName}" "$PUBLIC_IP"; then
//         dns_check_success=true
//         echo "Initial DNS check succeeded at $(date)"
//     else
//         echo "Initial DNS check failed at $(date). Domain ${serverName} does not resolve to $PUBLIC_IP"
//         echo "Will retry periodically every 5 minutes for up to 6 hours (72 attempts)"
        
//         for retry in {1..72}; do
//             echo "Starting DNS retry attempt $retry of 72 at $(date). Waiting 5 minutes before checking."
//             sleep 300  # 5 minutes
//             echo "Performing DNS check at $(date)"
            
//             if check_dns "${serverName}" "$PUBLIC_IP"; then
//                 dns_check_success=true
//                 echo "DNS check succeeded at $(date) after $retry retries"
//                 break
//             else
//                 echo "DNS check failed at $(date): domain ${serverName} does not resolve to $PUBLIC_IP"
//             fi
//         done
        
//         if [ "$dns_check_success" = false ]; then
//             echo "All 72 DNS retry attempts failed. Domain ${serverName} does not resolve to $PUBLIC_IP at $(date)"
//         fi
//     fi

//     # Request Let's Encrypt certificate if DNS is configured correctly
//     if [ "$dns_check_success" = true ]; then
//         echo "===== DNS check passed ====="
        
//         # Check if certificate already exists - using correct directory test
//         if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
//             echo "Certificate already exists, skipping certificate request"
//         elif [ -f "$CERT_REQUEST_FLAG" ]; then
//             echo "Certificate was previously requested, skipping to avoid rate limits"
//         else
//             echo "===== Requesting Let's Encrypt certificate ====="
//             mkdir -p "$(dirname "$CERT_REQUEST_FLAG")"
            
//             # Add a slight delay to ensure Nginx is fully started
//             sleep 5
            
//             # Track certificate success
//             cert_success=false
            
//             # Attempt certificate request with retries
//             for attempt in {1..3}; do
//                 echo "Attempt $attempt of 3 to obtain certificate at $(date)"
//                 if certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; then
//                     echo "Certificate successfully obtained"
//                     touch "$CERT_REQUEST_FLAG"
//                     cert_success=true
                    
//                     # Update Nginx SSL configuration with stronger settings
//                     cat > /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh <<EOL2
// #!/bin/bash
// # Add stronger SSL parameters after certificate issuance/renewal
// if ! grep -q "ssl_protocols TLSv1.2 TLSv1.3" /etc/nginx/sites-available/default; then
//     # Create a temporary file
//     TEMP_FILE=\\\$(mktemp)
    
//     # Find the SSL server block and add our parameters
//     awk '
//         /listen.*ssl/ {
//             print
//             ssl_block = 1
//             next
//         }
//         ssl_block == 1 && /server_name/ {
//             print
//             print "    # Strong SSL Configuration"
//             print "    ssl_protocols TLSv1.2 TLSv1.3;"
//             print "    ssl_prefer_server_ciphers on;"
//             print "    ssl_ciphers \\"ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384\\";"
//             print "    ssl_session_timeout 1d;"
//             print "    ssl_session_cache shared:SSL:10m;"
//             print "    ssl_session_tickets off;"
//             ssl_block = 0
//             next
//         }
//         { print }
//     ' /etc/nginx/sites-available/default > \\\$TEMP_FILE
    
//     # If the temp file has content, replace the config
//     if [ -s \\\$TEMP_FILE ]; then
//         cat \\\$TEMP_FILE > /etc/nginx/sites-available/default
//         nginx -t && systemctl reload nginx
//     fi
    
//     # Clean up
//     rm \\\$TEMP_FILE
// fi
// EOL2
//                     chmod +x /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
//                     /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
//                     # Call setup_api_ssl function to configure SSL for API
//                     setup_api_ssl
//                     # Update the API server block with the correct certificate paths
//                     if [ -f "/etc/nginx/sites-available/api" ]; then
//                         echo "Updating API server block with SSL certificates"
//                         certbot --nginx -d ${serverName} --non-interactive --expand --agree-tos -m ${letsEncryptEmail}
                        
//                         # If the above fails, manually ensure the API site has correct cert paths
//                         if ! grep -q "ssl_certificate" /etc/nginx/sites-available/api; then
//                             sed -i "s|#\s*SSL configuration.*|# SSL configuration\n    ssl_certificate /etc/letsencrypt/live/${serverName}/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/${serverName}/privkey.pem;|" /etc/nginx/sites-available/api
//                         fi
                        
//                         # Reload nginx to apply changes
//                         nginx -t && systemctl reload nginx
//                     fi
//                     break
//                 else
//                     echo "Attempt $attempt failed at $(date)"
//                     if [ $attempt -lt 3 ]; then
//                         echo "Waiting 10 minutes before retrying to respect rate limits"
//                         sleep 600
//                     fi
//                 fi
//             done
            
//             # Mark attempt regardless of success
//             touch "$CERT_REQUEST_FLAG"
            
//             # Double-check certificate directory existence with proper -d test
//             if [ "$cert_success" = false ] || [ ! -d "/etc/letsencrypt/live/${serverName}" ]; then
//                 echo "ERROR: All 3 attempts to obtain Let's Encrypt certificate failed at $(date)"
//                 echo "Domain: ${serverName}, Public IP: $PUBLIC_IP"
//                 echo "Next retry via cron in 3 hours. Check /var/log/certbot-retry.log for updates."
//                 echo "Manual fix: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail} --redirect"
//                 cat > /etc/cron.d/certbot-retry <<EOL3
// # Attempt to request SSL certificate every 3 hours if not obtained
// 0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect >> /var/log/certbot-retry.log 2>&1
// EOL3
//                 chmod 644 /etc/cron.d/certbot-retry
//             fi
//         fi
//     else
//         echo "===== DNS check failed ====="
//         echo "WARNING: ${serverName} doesn't resolve to server's IP $PUBLIC_IP"
//         echo "SSL certificate will not be obtained until DNS is properly configured."
        
//         cat > /etc/cron.d/certbot-dns-check <<EOL4
// # Check DNS and attempt certificate every 3 hours
// 0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && if [ "\\\$(dig +short ${serverName})" = "$PUBLIC_IP" ]; then certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; fi >> /var/log/certbot-dns-check.log 2>&1
// EOL4
//         chmod 644 /etc/cron.d/certbot-dns-check
        
//         echo "Created automated job to check DNS and request certificate every 3 hours"
//         echo "Manual command: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail} --redirect"
//     fi

//     # Set up certificate auto-renewal hooks
//     echo "===== Setting up certificate auto-renewal hooks ====="
//     mkdir -p /etc/letsencrypt/renewal-hooks/post/
//     cat > /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh <<EOL
// #!/bin/bash
// # Test Nginx configuration after certificate renewal
// nginx -t && systemctl reload nginx
// EOL
//     chmod +x /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh
// fi
// `;
// }

// import * as pulumi from "@pulumi/pulumi";

// /**
//  * Let's Encrypt SSL setup script for Nginx
//  * @param serverName Domain name for the SSL certificate
//  * @param letsEncryptEmail Email for Let's Encrypt registration
//  */
// export function getSslSetupScript(
//     serverName: string,
//     letsEncryptEmail: string
// ): pulumi.Output<string> {
//     return pulumi.interpolate`
// # Only proceed with SSL setup if domain name was provided
// if [ "$USE_SSL" = true ]; then
//     # Source the setup_api_ssl function
//     source /usr/local/bin/setup_api_ssl.sh

//     # Source environment variables if they exist
//     if [ -f /etc/environment ]; then
//         source /etc/environment
//     fi

//     # Verify we have the required variables or provide fallbacks
//     if [ -z "$TRACTION_IP" ]; then
//         echo "WARNING: TRACTION_IP not found in environment, using fallback"
//         export TRACTION_IP="127.0.0.1"  # Default fallback
//     fi

//     if [ -z "$SERVER_NAME" ]; then
//         echo "WARNING: SERVER_NAME not found in environment, using provided value"
//         export SERVER_NAME="${serverName}"
//     fi

//     # Log the values for debugging
//     echo "Using SERVER_NAME: $SERVER_NAME"
//     echo "Using TRACTION_IP: $TRACTION_IP"

//     # Create state directories for Let's Encrypt
//     echo "===== Setting up Let's Encrypt state directories ====="
//     mkdir -p /var/lib/certbot
//     mkdir -p /var/lib/letsencrypt
//     mkdir -p /etc/letsencrypt/renewal-hooks/post/

//     # Create flag file paths
//     CERT_REQUEST_FLAG="/var/lib/certbot/cert_requested_\${SERVER_NAME//[^a-zA-Z0-9]/_}"

//     # Check if DNS is properly configured
//     echo "===== Checking DNS ====="
    
//     # Function to check DNS
//     check_dns() {
//         local domain="$1"
//         local server_ip="$2"
//         local domain_ip
        
//         domain_ip=$(dig +short "$domain" || echo "DNS lookup failed")
        
//         echo "Domain $domain resolves to: $domain_ip"
//         echo "Server public IP: $server_ip"
        
//         # Check if domain resolves to our IP
//         if [ "$domain_ip" = "$server_ip" ]; then
//             return 0  # Success
//         else
//             return 1  # Failure
//         fi
//     }
    
//     # Initial DNS check
//     dns_check_success=false

//     # First DNS check attempt
//     echo "Starting initial DNS check for domain ${serverName} to IP $PUBLIC_IP at $(date)"
//     if check_dns "${serverName}" "$PUBLIC_IP"; then
//         dns_check_success=true
//         echo "Initial DNS check succeeded at $(date)"
//     else
//         echo "Initial DNS check failed at $(date). Domain ${serverName} does not resolve to $PUBLIC_IP"
//         echo "Will retry periodically every 5 minutes for up to 6 hours (72 attempts)"
        
//         for retry in {1..72}; do
//             echo "Starting DNS retry attempt $retry of 72 at $(date). Waiting 5 minutes before checking."
//             sleep 300  # 5 minutes
//             echo "Performing DNS check at $(date)"
            
//             if check_dns "${serverName}" "$PUBLIC_IP"; then
//                 dns_check_success=true
//                 echo "DNS check succeeded at $(date) after $retry retries"
//                 break
//             else
//                 echo "DNS check failed at $(date): domain ${serverName} does not resolve to $PUBLIC_IP"
//             fi
//         done
        
//         if [ "$dns_check_success" = false ]; then
//             echo "All 72 DNS retry attempts failed. Domain ${serverName} does not resolve to $PUBLIC_IP at $(date)"
//         fi
//     fi

//     # Request Let's Encrypt certificate if DNS is configured correctly
//     if [ "$dns_check_success" = true ]; then
//         echo "===== DNS check passed ====="
        
//         # Check if certificate already exists - using correct directory test
//         if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
//             echo "Certificate already exists, skipping certificate request"
//         elif [ -f "$CERT_REQUEST_FLAG" ]; then
//             echo "Certificate was previously requested, skipping to avoid rate limits"
//         else
//             echo "===== Requesting Let's Encrypt certificate ====="
//             mkdir -p "$(dirname "$CERT_REQUEST_FLAG")"
            
//             # Add a slight delay to ensure Nginx is fully started
//             sleep 5
            
//             # Track certificate success
//             cert_success=false
            
//             # Attempt certificate request with retries
//             for attempt in {1..3}; do
//                 echo "Attempt $attempt of 3 to obtain certificate at $(date)"
//                 if certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; then
//                     echo "Certificate successfully obtained"
//                     touch "$CERT_REQUEST_FLAG"
//                     cert_success=true
                    
//                     # Update Nginx SSL configuration with stronger settings
//                     cat > /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh <<EOL2
// #!/bin/bash
// # Add stronger SSL parameters after certificate issuance/renewal
// if ! grep -q "ssl_protocols TLSv1.2 TLSv1.3" /etc/nginx/sites-available/default; then
//     # Create a temporary file
//     TEMP_FILE=\\\$(mktemp)
    
//     # Find the SSL server block and add our parameters
//     awk '
//         /listen.*ssl/ {
//             print
//             ssl_block = 1
//             next
//         }
//         ssl_block == 1 && /server_name/ {
//             print
//             print "    # Strong SSL Configuration"
//             print "    ssl_protocols TLSv1.2 TLSv1.3;"
//             print "    ssl_prefer_server_ciphers on;"
//             print "    ssl_ciphers \\"ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384\\";"
//             print "    ssl_session_timeout 1d;"
//             print "    ssl_session_cache shared:SSL:10m;"
//             print "    ssl_session_tickets off;"
//             ssl_block = 0
//             next
//         }
//         { print }
//     ' /etc/nginx/sites-available/default > \\\$TEMP_FILE
    
//     # If the temp file has content, replace the config
//     if [ -s \\\$TEMP_FILE ]; then
//         cat \\\$TEMP_FILE > /etc/nginx/sites-available/default
//         nginx -t && systemctl reload nginx
//     fi
    
//     # Clean up
//     rm \\\$TEMP_FILE
// fi
// EOL2
//                     chmod +x /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
//                     /etc/letsencrypt/renewal-hooks/post/update-ssl-params.sh
                    
//                     # Call setup_api_ssl function to configure SSL for API
//                     # Using the variables we sourced or set earlier
//                     echo "Calling setup_api_ssl with SERVER_NAME=$SERVER_NAME and TRACTION_IP=$TRACTION_IP"
//                     setup_api_ssl "$SERVER_NAME" "$TRACTION_IP"
                    
//                     # Update the API server block with the correct certificate paths
//                     if [ -f "/etc/nginx/sites-available/api" ]; then
//                         echo "Updating API server block with SSL certificates"
//                         certbot --nginx -d ${serverName} --non-interactive --expand --agree-tos -m ${letsEncryptEmail}
                        
//                         # If the above fails, manually ensure the API site has correct cert paths
//                         if ! grep -q "ssl_certificate" /etc/nginx/sites-available/api; then
//                             sed -i "s|#\s*SSL configuration.*|# SSL configuration\n    ssl_certificate /etc/letsencrypt/live/${serverName}/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/${serverName}/privkey.pem;|" /etc/nginx/sites-available/api
//                         fi
                        
//                         # Reload nginx to apply changes
//                         nginx -t && systemctl reload nginx
//                     fi
//                     break
//                 else
//                     echo "Attempt $attempt failed at $(date)"
//                     if [ $attempt -lt 3 ]; then
//                         echo "Waiting 10 minutes before retrying to respect rate limits"
//                         sleep 600
//                     fi
//                 fi
//             done
            
//             # Mark attempt regardless of success
//             touch "$CERT_REQUEST_FLAG"
            
//             # Double-check certificate directory existence with proper -d test
//             if [ "$cert_success" = false ] || [ ! -d "/etc/letsencrypt/live/${serverName}" ]; then
//                 echo "ERROR: All 3 attempts to obtain Let's Encrypt certificate failed at $(date)"
//                 echo "Domain: ${serverName}, Public IP: $PUBLIC_IP"
//                 echo "Next retry via cron in 3 hours. Check /var/log/certbot-retry.log for updates."
//                 echo "Manual fix: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail} --redirect"
//                 cat > /etc/cron.d/certbot-retry <<EOL3
// # Attempt to request SSL certificate every 3 hours if not obtained
// 0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect >> /var/log/certbot-retry.log 2>&1
// EOL3
//                 chmod 644 /etc/cron.d/certbot-retry
//             fi
//         fi
//     else
//         echo "===== DNS check failed ====="
//         echo "WARNING: ${serverName} doesn't resolve to server's IP $PUBLIC_IP"
//         echo "SSL certificate will not be obtained until DNS is properly configured."
        
//         cat > /etc/cron.d/certbot-dns-check <<EOL4
// # Check DNS and attempt certificate every 3 hours
// 0 */3 * * * root [ ! -d "/etc/letsencrypt/live/${serverName}" ] && [ -f "/var/lib/nginx-ssl-setup.lock" ] && if [ "\\\$(dig +short ${serverName})" = "$PUBLIC_IP" ]; then certbot --nginx -d ${serverName} --non-interactive --agree-tos -m ${letsEncryptEmail} --redirect; fi >> /var/log/certbot-dns-check.log 2>&1
// EOL4
//         chmod 644 /etc/cron.d/certbot-dns-check
        
//         echo "Created automated job to check DNS and request certificate every 3 hours"
//         echo "Manual command: certbot --nginx -d ${serverName} --agree-tos -m ${letsEncryptEmail} --redirect"
//     fi

//     # Set up certificate auto-renewal hooks
//     echo "===== Setting up certificate auto-renewal hooks ====="
//     mkdir -p /etc/letsencrypt/renewal-hooks/post/
//     cat > /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh <<EOL
// #!/bin/bash
// # Test Nginx configuration after certificate renewal
// nginx -t && systemctl reload nginx
// EOL
//     chmod +x /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh
// fi
// `;
// }