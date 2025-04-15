// // File: src/aws/nginx/config-templates.ts
// import * as pulumi from "@pulumi/pulumi";
// import { NginxConfig } from "../types";

// /**
//  * Get the basic Nginx configuration template
//  */
// export function getNginxBaseConfig(config: NginxConfig, serverName: string): pulumi.Output<string> {
//     // Create a local variable for tractionIp to use in the interpolated string
//     const tractionIp = config.tractionIp;
    
//     return pulumi.interpolate`
// # First, create a proper global configuration file
// cat > /etc/nginx/nginx.conf <<EOL_GLOBAL
// user www-data;
// worker_processes auto;
// pid /run/nginx.pid;
// include /etc/nginx/modules-enabled/*.conf;

// events {
//     worker_connections 1024;
//     multi_accept on;
// }

// http {
//     # Basic settings
//     sendfile on;
//     tcp_nopush on;
//     tcp_nodelay on;
//     keepalive_timeout 65;
//     types_hash_max_size 2048;
//     server_tokens off;

//     # MIME types
//     include /etc/nginx/mime.types;
//     default_type application/octet-stream;

//     # Logging format
//     log_format main '\$remote_addr - \$remote_user [\$time_local] "\$request" '
//                     '\$status \$body_bytes_sent "\$http_referer" '
//                     '"\$http_user_agent" "\$http_x_forwarded_for"';
    
//     # Logging settings
//     access_log /var/log/nginx/access.log main;
//     error_log /var/log/nginx/error.log warn;

//     # Enable gzip compression for better performance
//     gzip on;
//     gzip_disable "msie6";
//     gzip_vary on;
//     gzip_proxied any;
//     gzip_comp_level 5;
//     gzip_min_length 256;
//     gzip_types
//       application/atom+xml
//       application/javascript
//       application/json
//       application/ld+json
//       application/manifest+json
//       application/rss+xml
//       application/vnd.geo+json
//       application/vnd.ms-fontobject
//       application/x-font-ttf
//       application/x-web-app-manifest+json
//       application/xhtml+xml
//       application/xml
//       font/opentype
//       image/bmp
//       image/svg+xml
//       image/x-icon
//       text/cache-manifest
//       text/css
//       text/plain
//       text/vcard
//       text/vnd.rim.location.xloc
//       text/vtt
//       text/x-component
//       text/x-cross-domain-policy;

//     # Virtual Host Configs
//     include /etc/nginx/conf.d/*.conf;
//     include /etc/nginx/sites-enabled/*;
// }
// EOL_GLOBAL

// # Store important configuration in environment variables that are persisted
// # This makes them available to other scripts like the SSL setup script
// echo "TRACTION_IP=${config.tractionIp}" >> /etc/environment
// echo "CONTROLLER_IP=${config.controllerIp}" >> /etc/environment
// echo "SERVER_NAME=${serverName}" >> /etc/environment

// # Also make them available in the current shell
// export TRACTION_IP="${config.tractionIp}"
// export CONTROLLER_IP="${config.controllerIp}"
// export SERVER_NAME="${serverName}"

// # Now create the site-specific configuration
// cat > /etc/nginx/sites-available/default <<EOL
// server {
//     listen 80 default_server;
//     listen [::]:80 default_server;
//     server_name ${serverName};

//     # Security headers
//     add_header X-Content-Type-Options "nosniff" always;
//     add_header X-Frame-Options "SAMEORIGIN" always;
//     add_header X-XSS-Protection "1; mode=block" always;
//     add_header Referrer-Policy "strict-origin-when-cross-origin" always;
//     add_header Content-Security-Policy "connect-src *;" always;
//     # add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src *;" always;

//     # Basic settings
//     client_max_body_size 64M;

//     # Main logging
//     access_log /var/log/nginx/access.log main buffer=512k flush=1m;
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

//     # Let's Encrypt cert validation path (always include for potential future SSL setup)
//     location /.well-known/acme-challenge/ {
//         root /var/www/html;
//         allow all;
//     }

//     # Static assets with caching
//     location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
//         proxy_pass http://${config.tractionIp}:5101;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
        
//         # Caching settings
//         expires 7d;
//         add_header Cache-Control "public, max-age=604800";
//         proxy_cache_valid 200 7d;
        
//         access_log off;
//     }

//     # Root location redirects to Traction UI
//     location / {
//         proxy_pass http://${config.tractionIp}:5101;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
        
//         # WebSocket support
//         proxy_set_header Upgrade \\\$http_upgrade;
//         proxy_set_header Connection "upgrade";
        
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
//         proxy_next_upstream error timeout http_502 http_503 http_504;
//         proxy_next_upstream_tries 3;
//         proxy_intercept_errors on;
//         proxy_buffering on;
//         access_log /var/log/nginx/traction_ui_access.log main buffer=512k;
//         error_log /var/log/nginx/traction_ui_error.log warn;
//     }

//     location /assets/ {
//         proxy_pass http://${config.tractionIp}:5101;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
//         expires 7d;
//         add_header Cache-Control "public, max-age=604800";
//         proxy_cache_valid 200 7d;
//     }

//     location /img/ {
//         proxy_pass http://${config.tractionIp}:5101;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
//     }

//     # Keep the controller path for admin access 
//     location /controller/ {
//         rewrite ^/controller/(.*) /\$1 break;
//         access_log /var/log/nginx/controller_access.log main buffer=512k;
//         error_log /var/log/nginx/controller_error.log warn;
//         proxy_pass http://${config.controllerIp}:80;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
//         proxy_next_upstream error timeout http_502 http_503 http_504;
//         proxy_next_upstream_tries 3;
//         proxy_intercept_errors on;
//         proxy_buffering on;
//     }

//     # Useful redirects
//     location = /traction {
//         return 301 /;
//     }
    
//     location = /controller {
//         return 301 /controller/;
//     }

//     # Custom error page
//     error_page 502 503 504 /maintenance.html;
//     location = /maintenance.html {
//         root /var/www/html;
//         internal;
//     }

//     # Health check endpoint
//     location = /health {
//         access_log off;
//         return 200 'OK';
//         add_header Content-Type text/plain;
//     }
// }
// EOL

// # Create maintenance page
// cat > /var/www/html/maintenance.html <<EOL2
// <!DOCTYPE html>
// <html>
// <head>
//     <title>DigiCred Maintenance</title>
//     <style>
//         body {
//             font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
//             background-color: #f8f9fa;
//             color: #333;
//             text-align: center;
//             padding: 50px;
//             margin: 0;
//         }
//         .container {
//             max-width: 600px;
//             margin: 0 auto;
//             background-color: white;
//             border-radius: 8px;
//             padding: 30px;
//             box-shadow: 0 2px 10px rgba(0,0,0,0.1);
//         }
//         h1 {
//             color: #0056b3;
//         }
//         p {
//             font-size: 16px;
//             line-height: 1.6;
//         }
//         .icon {
//             font-size: 72px;
//             margin-bottom: 20px;
//         }
//     </style>
// </head>
// <body>
//     <div class="container">
//         <div class="icon">🛠️</div>
//         <h1>We'll be back soon!</h1>
//         <p>Sorry for the inconvenience. The DigiCred service is currently undergoing maintenance or is temporarily unavailable.</p>
//         <p>Please try again in a few minutes.</p>
//     </div>
// </body>
// </html>
// EOL2

// # New server block to listen on port 8032 directly
// cat >> /etc/nginx/sites-available/default <<EOL3
// server {
//     listen 8032;
//     server_name ${serverName};

//     location / {
//         proxy_pass http://${config.tractionIp}:8032;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;

//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;

//         access_log /var/log/nginx/api_direct_access.log main;
//         error_log /var/log/nginx/api_direct_error.log warn;
//     }
// }
// EOL3

// # Create separate setup_api_ssl.sh script file
// mkdir -p /usr/local/bin
// cat > /usr/local/bin/setup_api_ssl.sh <<'SETUP_API_SSL_SCRIPT'
// #!/bin/bash

// setup_api_ssl() {
//   local serverName="$1"
//   local tractionIp="$2"

//   echo "Running setup_api_ssl with domain: ${serverName}, traction IP: ${tractionIp}"
  
//   if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
//     echo "Setting up SSL-enabled API server on port 8032..."
    
//     # Create API server block with SSL
//     cat > /etc/nginx/sites-available/api <<EOL_API
// server {
//     listen 8032 ssl;
//     server_name ${serverName};
    
//     # SSL configuration
//     ssl_certificate /etc/letsencrypt/live/${serverName}/fullchain.pem;
//     ssl_certificate_key /etc/letsencrypt/live/${serverName}/privkey.pem;
    
//     # SSL parameters
//     ssl_protocols TLSv1.2 TLSv1.3;
//     ssl_prefer_server_ciphers on;
//     ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
//     ssl_session_timeout 1d;
//     ssl_session_cache shared:SSL:10m;
//     ssl_session_tickets off;
    
//     # Security headers
//     add_header X-Content-Type-Options "nosniff" always;
//     add_header X-Frame-Options "SAMEORIGIN" always;
//     add_header X-XSS-Protection "1; mode=block" always;
//     add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
//     # Proxy configuration
//     location / {
//         proxy_pass http://${tractionIp}:8032;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
        
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
        
//         access_log /var/log/nginx/api_ssl_access.log main;
//         error_log /var/log/nginx/api_ssl_error.log warn;
//     }
// }
// EOL_API
    
//     # Enable the API site
//     ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api
    
//     # Test and reload Nginx
//     nginx -t && systemctl reload nginx
    
//     echo "SSL-enabled API server configuration complete"
//   else
//     echo "SSL certificates not found, skipping API SSL setup"
    
//     # Create non-SSL API server as fallback
//     cat > /etc/nginx/sites-available/api <<EOL_API
// server {
//     listen 8032;
//     server_name ${serverName};
    
//     location / {
//         proxy_pass http://${tractionIp}:8032;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
        
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
        
//         access_log /var/log/nginx/api_access.log main;
//         error_log /var/log/nginx/api_error.log warn;
//     }
// }
// EOL_API
    
//     # Enable the API site
//     ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api
    
//     # Test and reload Nginx
//     nginx -t && systemctl reload nginx
//   fi
// }

// # Export the function so it can be sourced
// export -f setup_api_ssl
// SETUP_API_SSL_SCRIPT

// # Make the script executable
// chmod +x /usr/local/bin/setup_api_ssl.sh

// # Create a non-SSL API config initially (will be replaced later when SSL is available)
// cat > /etc/nginx/sites-available/api <<EOL_API_INITIAL
// server {
//     listen 8032;
//     server_name ${serverName};
    
//     location / {
//         proxy_pass http://${config.tractionIp}:8032;
//         proxy_http_version 1.1;
//         proxy_set_header Host \\\$host;
//         proxy_set_header X-Real-IP \\\$remote_addr;
//         proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto \\\$scheme;
        
//         proxy_connect_timeout 60s;
//         proxy_send_timeout 60s;
//         proxy_read_timeout 60s;
        
//         access_log /var/log/nginx/api_access.log main;
//         error_log /var/log/nginx/api_error.log warn;
//     }
// }
// EOL_API_INITIAL

// # Enable the API site - this is safe now since we've created a default config
// ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api

// chmod 644 /var/www/html/maintenance.html

// # Set proper permissions and enable config
// chmod 644 /etc/nginx/sites-available/default
// chown root:root /etc/nginx/sites-available/default
// ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
// rm -f /etc/nginx/sites-enabled/default.bak
// `;
// }


// File: src/aws/nginx/config-templates.ts
import * as pulumi from "@pulumi/pulumi";
import { NginxConfig } from "../types";

/**
 * Get the basic Nginx configuration template
 */
export function getNginxBaseConfig(config: NginxConfig, serverName: string): pulumi.Output<string> {
    // Create a local variable for tractionIp to use in the interpolated string
    const tractionIp = config.tractionIp;
    
    return pulumi.interpolate`
# First, create a proper global configuration file
cat > /etc/nginx/nginx.conf <<EOL_GLOBAL
user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 1024;
    multi_accept on;
}

http {
    # Basic settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    # MIME types
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging format
    log_format main '\$remote_addr - \$remote_user [\$time_local] "\$request" '
                    '\$status \$body_bytes_sent "\$http_referer" '
                    '"\$http_user_agent" "\$http_x_forwarded_for"';
    
    # Logging settings
    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    # Enable gzip compression for better performance
    gzip on;
    gzip_disable "msie6";
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types
      application/atom+xml
      application/javascript
      application/json
      application/ld+json
      application/manifest+json
      application/rss+xml
      application/vnd.geo+json
      application/vnd.ms-fontobject
      application/x-font-ttf
      application/x-web-app-manifest+json
      application/xhtml+xml
      application/xml
      font/opentype
      image/bmp
      image/svg+xml
      image/x-icon
      text/cache-manifest
      text/css
      text/plain
      text/vcard
      text/vnd.rim.location.xloc
      text/vtt
      text/x-component
      text/x-cross-domain-policy;

    # Virtual Host Configs
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOL_GLOBAL

# Create a basic ssl-params.conf initially so Nginx can start
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/ssl-params.conf <<EOL_INITIAL_SSL_PARAMS
# Initial SSL Configuration (will be expanded later)
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:10m;
ssl_session_tickets off;
EOL_INITIAL_SSL_PARAMS

# Store important configuration in environment variables that are persisted
# This makes them available to other scripts like the SSL setup script
echo "TRACTION_IP=${config.tractionIp}" >> /etc/environment
echo "CONTROLLER_IP=${config.controllerIp}" >> /etc/environment
echo "SERVER_NAME=${serverName}" >> /etc/environment

# Also make them available in the current shell
export TRACTION_IP="${config.tractionIp}"
export CONTROLLER_IP="${config.controllerIp}"
export SERVER_NAME="${serverName}"

# Now create the site-specific configuration for HTTP (redirects to HTTPS)
cat > /etc/nginx/sites-available/default <<EOL
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${serverName};

    # Main logging
    access_log /var/log/nginx/http_access.log main buffer=512k flush=1m;
    error_log /var/log/nginx/http_error.log warn;

    # Let's Encrypt cert validation path (always include for potential future SSL setup)
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }

    # Redirect all HTTP requests to HTTPS
    location / {
        return 301 https://\\\$host\\\$request_uri;
    }
}
EOL

# Create maintenance page
cat > /var/www/html/maintenance.html <<EOL2
<!DOCTYPE html>
<html>
<head>
    <title>DigiCred Maintenance</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f8f9fa;
            color: #333;
            text-align: center;
            padding: 50px;
            margin: 0;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #0056b3;
        }
        p {
            font-size: 16px;
            line-height: 1.6;
        }
        .icon {
            font-size: 72px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🛠️</div>
        <h1>We'll be back soon!</h1>
        <p>Sorry for the inconvenience. The DigiCred service is currently undergoing maintenance or is temporarily unavailable.</p>
        <p>Please try again in a few minutes.</p>
    </div>
</body>
</html>
EOL2

# Create an SSL-enabled version of the default server as a template
mkdir -p /etc/nginx/templates
cat > /etc/nginx/templates/default-ssl.template <<EOL_SSL
server {
    listen 443 ssl;
    listen [::]:443 ssl;
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
    add_header Content-Security-Policy "connect-src *;" always;
    
    # Basic settings
    client_max_body_size 64M;

    # Main logging
    access_log /var/log/nginx/https_access.log main buffer=512k flush=1m;
    error_log /var/log/nginx/https_error.log warn;

    # Timeouts
    client_body_timeout 60s;
    client_header_timeout 60s;
    keepalive_timeout 75s;
    send_timeout 60s;

    # Global proxy settings
    proxy_buffers 8 16k;
    proxy_buffer_size 16k;
    proxy_busy_buffers_size 32k;
    
    # Static assets with caching
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://${config.tractionIp}:5101;
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
        proxy_pass http://${config.tractionIp}:5101;
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
        access_log /var/log/nginx/traction_ui_access.log main buffer=512k;
        error_log /var/log/nginx/traction_ui_error.log warn;
    }

    location /assets/ {
        proxy_pass http://${config.tractionIp}:5101;
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
        proxy_pass http://${config.tractionIp}:5101;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
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

# Create function to deploy SSL config when certificates are available
cat > /usr/local/bin/deploy_ssl_config.sh <<'DEPLOY_SSL_SCRIPT'
#!/bin/bash

deploy_ssl_config() {
  local serverName="$1"
  
  if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
    echo "Deploying HTTPS server configuration..."
    
    # Process the template
    cat /etc/nginx/templates/default-ssl.template | \
      sed "s/\${serverName}/${serverName}/g" > /etc/nginx/sites-available/default-ssl
    
    # Enable the site
    ln -sf /etc/nginx/sites-available/default-ssl /etc/nginx/sites-enabled/default-ssl
    
    # Test and reload
    nginx -t && systemctl reload nginx
    
    echo "HTTPS server configuration deployed successfully"
  else
    echo "SSL certificates not found, skipping HTTPS server deployment"
  fi
}

export -f deploy_ssl_config
DEPLOY_SSL_SCRIPT
chmod +x /usr/local/bin/deploy_ssl_config.sh

# Create separate setup_api_ssl.sh script file
mkdir -p /usr/local/bin
cat > /usr/local/bin/setup_api_ssl.sh <<'SETUP_API_SSL_SCRIPT'
#!/bin/bash

setup_api_ssl() {
  local serverName="$1"
  local tractionIp="$2"

  echo "Running setup_api_ssl with domain: ${serverName}, traction IP: ${tractionIp}"
  
  if [ -d "/etc/letsencrypt/live/${serverName}" ]; then
    echo "Setting up SSL-enabled API server on port 8032..."
    
    # Create API server block with SSL
    cat > /etc/nginx/sites-available/api <<EOL_API
server {
    listen 8032 ssl;
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
        proxy_pass http://${tractionIp}:8032;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        access_log /var/log/nginx/api_ssl_access.log main;
        error_log /var/log/nginx/api_ssl_error.log warn;
    }
}
EOL_API

 # Enable the API site
    ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api
    
    # Test and reload Nginx
    nginx -t && systemctl reload nginx
    
    echo "SSL-enabled API server configuration complete"
  else
    echo "SSL certificates not found, skipping API SSL setup"
    
    # Create non-SSL API server as fallback
    cat > /etc/nginx/sites-available/api <<EOL_API
server {
    listen 8032;
    server_name ${serverName};
    
    location / {
        proxy_pass http://${tractionIp}:8032;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        access_log /var/log/nginx/api_access.log main;
        error_log /var/log/nginx/api_error.log warn;
    }
}
EOL_API
    
    # Enable the API site
    ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api
    
    # Test and reload Nginx
    nginx -t && systemctl reload nginx
  fi
}

# Export the function so it can be sourced
export -f setup_api_ssl
SETUP_API_SSL_SCRIPT

# Make the script executable
chmod +x /usr/local/bin/setup_api_ssl.sh

# New server block for Cape Fear Controller
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
        
        access_log /var/log/nginx/controller_app_access.log main;
        error_log /var/log/nginx/controller_app_error.log warn;
    }
}
EOL_CONTROLLER

# Create a non-SSL API config initially (will be replaced later when SSL is available)
cat > /etc/nginx/sites-available/api <<EOL_API_INITIAL
server {
    listen 8032;
    server_name ${serverName};
    
    location / {
        proxy_pass http://${config.tractionIp}:8032;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        access_log /var/log/nginx/api_access.log main;
        error_log /var/log/nginx/api_error.log warn;
    }
}
EOL_API_INITIAL

# Enable the API site - this is safe now since we've created a default config
ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/api
# Enable the controller site
ln -sf /etc/nginx/sites-available/controller /etc/nginx/sites-enabled/controller

chmod 644 /var/www/html/maintenance.html

# Set proper permissions and enable config
chmod 644 /etc/nginx/sites-available/default
chown root:root /etc/nginx/sites-available/default
ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/default.bak
`;
}