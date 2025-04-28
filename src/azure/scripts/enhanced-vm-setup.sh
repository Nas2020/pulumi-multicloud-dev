#!/bin/bash
# Enhanced VM Setup Script for DigiCred CRMS Traction Deployment
# This script sets up the Traction application with improved error handling, logging,
# and domain validation before configuring Nginx and SSL certificates.

# Enable error handling
set -e

# Setup logging
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

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Validate arguments
if [ "$#" -lt 4 ]; then
    log "ERROR" "Usage: $0 <key-vault-uri> <domain-name> <email> <org-prefix> [non-sensitive-params-json]"
    exit 1
fi

KEY_VAULT_URI=$1
DOMAIN_NAME=$2
EMAIL=$3
ORG_PREFIX=$4
NON_SENSITIVE_PARAMS=${5:-'{}'}

log "INFO" "Starting ${ORG_PREFIX} Traction setup..."
log "INFO" "Domain name: ${DOMAIN_NAME}"

# Validate domain name format
if ! [[ $DOMAIN_NAME =~ ^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
    log "ERROR" "Invalid domain name format: ${DOMAIN_NAME}"
    exit 1
fi

# Function to validate email format
validate_email() {
    local email="$1"
    local email_regex="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    
    if [[ $email =~ $email_regex ]]; then
        return 0  # Valid email
    else
        return 1  # Invalid email
    fi
}

# Email validation
if [ -z "$EMAIL" ]; then
    log "WARN" "No email provided, using admin@${DOMAIN_NAME} as fallback for SSL certificate"
    EMAIL="admin@${DOMAIN_NAME}"
fi

if ! validate_email "$EMAIL"; then
    log "ERROR" "Invalid email format: ${EMAIL}"
    log "WARN" "Using admin@${DOMAIN_NAME} as fallback for SSL certificate"
    EMAIL="admin@${DOMAIN_NAME}"
fi

log "INFO" "Using email ${EMAIL} for SSL certificate and notifications"

# Install required utilities
install_dependencies() {
    log "INFO" "Installing dependencies..."
    apt_updated=false
    
    for pkg in jq curl dnsutils nginx certbot python3-certbot-nginx; do
        if ! command_exists "$pkg"; then
            if ! $apt_updated; then
                log "INFO" "Updating package index..."
                sudo apt-get update
                apt_updated=true
            fi
            log "INFO" "Installing $pkg..."
            sudo apt-get install -y $pkg
        fi
    done
}

# Parse non-sensitive parameters from JSON
parse_non_sensitive_params() {
    local param_name=$1
    local default_value=$2
    local value=$(echo $NON_SENSITIVE_PARAMS | jq -r ".$param_name // \"$default_value\"")
    echo "$value"
}

# Function to validate domain DNS resolution
validate_domain() {
    local domain=$1
    local max_attempts=24  # Check every 5 minutes for 2 hours
    local attempt=1
    local wait_time=300    # 5 minutes
    
    log "INFO" "Validating domain DNS resolution for ${domain}..."
    
    # Get public IP of the VM
    local public_ip=$(curl -s http://checkip.amazonaws.com) || public_ip=$(curl -s http://ifconfig.me)
    if [ -z "$public_ip" ]; then
        log "ERROR" "Failed to determine public IP address"
        return 1
    fi
    
    log "INFO" "This server's public IP address: ${public_ip}"
    
    while [ $attempt -le $max_attempts ]; do
        log "INFO" "DNS resolution check attempt ${attempt}/${max_attempts}..."
        
        # Check if domain resolves to our IP
        local resolved_ip=$(dig +short ${domain})
        
        if [ -z "$resolved_ip" ]; then
            log "WARN" "Domain ${domain} does not resolve to any IP address yet."
        elif [ "$resolved_ip" == "$public_ip" ]; then
            log "INFO" "Domain ${domain} correctly resolves to this server's IP (${public_ip})."
            return 0
        else
            log "WARN" "Domain ${domain} resolves to ${resolved_ip}, but this server's IP is ${public_ip}."
        fi
        
        if [ $attempt -lt $max_attempts ]; then
            log "INFO" "Waiting ${wait_time} seconds before next DNS check..."
            sleep $wait_time
        fi
        
        ((attempt++))
    done
    
    log "ERROR" "Domain validation failed after ${max_attempts} attempts. Please ensure ${domain} is properly configured to point to ${public_ip}."
    return 1
}

# Setup Nginx configurations
setup_nginx() {
    log "INFO" "Setting up Nginx..."
    
    # Create Nginx configuration directory if it doesn't exist
    sudo mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
    
    # Setup Nginx configuration for HTTP (pre-SSL)
    sudo tee /etc/nginx/sites-available/traction.conf > /dev/null << EOF
server {
    listen 80;
    server_name ${DOMAIN_NAME};
    
    # For Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # Redirect all other HTTP traffic to HTTPS after certificate is issued
    location / {
        return 301 https://\\\$host\\\$request_uri;
    }
}
EOF

    # Enable the site
    sudo ln -sf /etc/nginx/sites-available/traction.conf /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test and reload Nginx
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "Nginx HTTP configuration applied successfully"
        return 0
    else
        log "ERROR" "Nginx configuration failed validation"
        return 1
    fi
}

# Setup SSL with Certbot with retry mechanism
setup_ssl() {
    local domain=$1
    local email=$2
    local max_attempts=5
    local attempt=1
    local wait_time=30
    
    # Create webroot directory for ACME challenge
    sudo mkdir -p /var/www/html/.well-known/acme-challenge
    sudo chown -R www-data:www-data /var/www/html
    
    log "INFO" "Setting up SSL certificates for ${domain} using email ${email}..."
    
    while [ $attempt -le $max_attempts ]; do
        log "INFO" "Certbot attempt ${attempt}/${max_attempts}..."
        
        if sudo certbot --nginx --non-interactive --agree-tos \
           --email "${email}" -d "${domain}" \
           --deploy-hook "systemctl reload nginx" 2>&1 | tee -a $LOGFILE; then
            log "INFO" "SSL certificate successfully issued for ${domain}"
            
            # Update Nginx config for HTTPS with the full reverse proxy setup
            setup_nginx_https
            return 0
        else
            log "WARN" "Certbot attempt ${attempt} failed. Checking for rate limits..."
            
            # Check if we hit rate limits
            if grep -q "too many failed authorizations recently" $LOGFILE; then
                log "ERROR" "Hit Let's Encrypt rate limit. Please wait at least 1 hour before trying again."
                return 1
            fi
            
            # Exponential backoff for retries
            wait_time=$((wait_time * 2))
            log "INFO" "Waiting ${wait_time} seconds before retry..."
            sleep $wait_time
        fi
        
        ((attempt++))
    done
    
    log "ERROR" "Failed to obtain SSL certificate after ${max_attempts} attempts."
    return 1
}

# Setup HTTPS Nginx configuration after SSL is ready
setup_nginx_https() {
    log "INFO" "Setting up Nginx HTTPS configuration..."
    
    sudo tee /etc/nginx/sites-available/traction-https.conf > /dev/null << EOF
server {
    listen 443 ssl;
    server_name ${DOMAIN_NAME};
    
    # SSL parameters will be added by Certbot
    
    # Access and error logs
    access_log /var/log/nginx/traction-access.log;
    error_log /var/log/nginx/traction-error.log;
    
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
}
EOF

    sudo ln -sf /etc/nginx/sites-available/traction-https.conf /etc/nginx/sites-enabled/
    
    # Test and reload Nginx
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "INFO" "Nginx HTTPS configuration applied successfully"
        return 0
    else
        log "ERROR" "Nginx HTTPS configuration failed validation"
        return 1
    fi
}

# Function to retrieve a secret from Key Vault
get_azure_secret() {
    local secret_name=$1
    local max_attempts=3
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        log "INFO" "Retrieving secret ${secret_name} from Key Vault (attempt ${attempt}/${max_attempts})..."
        
        local value=$(az keyvault secret show --vault-uri $KEY_VAULT_URI --name $secret_name --query "value" -o tsv 2>>$LOGFILE)
        
        if [ $? -eq 0 ] && [ -n "$value" ]; then
            echo "$value"
            return 0
        else
            log "WARN" "Failed to retrieve secret ${secret_name}. Retrying..."
            sleep 5
        fi
        
        ((attempt++))
    done
    
    log "ERROR" "Failed to retrieve secret ${secret_name} after ${max_attempts} attempts"
    return 1
}

# Function to setup the Traction application
setup_traction() {
    log "INFO" "Setting up Traction application..."
    
    # Create the Traction directory structure
    TRACTION_DIR="/opt/traction-docker-compose/digicred"
    mkdir -p $TRACTION_DIR
    cd $TRACTION_DIR
    
    # Retrieve configuration values from Key Vault
    log "INFO" "Retrieving configuration from Key Vault..."
    
    # Login using the VM's managed identity first
    if ! command_exists az; then
        log "INFO" "Azure CLI not found, installing..."
        curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
    fi
    
    log "INFO" "Logging in with managed identity..."
    if ! az login --identity; then
        log "ERROR" "Failed to login with managed identity"
        return 1
    fi
    
    # Retrieve all necessary secrets
    TRACTION_ACAPY_SEED=$(get_azure_secret "traction-acapy-seed")
    ACAPY_ENDORSER_SEED=$(get_azure_secret "acapy-endorser-seed")
    ACAPY_ENDORSER_SEED_1=$(get_azure_secret "acapy-endorser-1-seed")
    WEBHOOK_API_KEY=$(get_azure_secret "webhook-api-key")
    CONTROLLER_API_KEY=$(get_azure_secret "controller-api-key")
    CONTROLLER_BEARER_TOKEN=$(get_azure_secret "controller-bearer-token")
    
    # Check if any secrets failed to retrieve
    if [ -z "$TRACTION_ACAPY_SEED" ] || [ -z "$ACAPY_ENDORSER_SEED" ] || 
       [ -z "$ACAPY_ENDORSER_SEED_1" ] || [ -z "$WEBHOOK_API_KEY" ] || 
       [ -z "$CONTROLLER_API_KEY" ] || [ -z "$CONTROLLER_BEARER_TOKEN" ]; then
        log "ERROR" "Failed to retrieve all required secrets from Key Vault"
        return 1
    fi
    
    # Parse non-sensitive values
    ACAPY_ENDORSER_PUBLIC_DID=$(parse_non_sensitive_params "endorserPubDID" "9rshtjHzfPUdruRxTjn3ZT")
    ACAPY_ENDORSER_1_PUBLIC_DID=$(parse_non_sensitive_params "endorser1PubDID" "GvDnYWRHFLJiDoLqKqRXGv")
    LOAD_TYPE=$(parse_non_sensitive_params "controllerLoadType" "TEST")
    
    # Get the VM's public IP address
    PUBLIC_IP=$(curl -s http://checkip.amazonaws.com) || PUBLIC_IP=$(curl -s http://ifconfig.me)
    if [ -z "$PUBLIC_IP" ]; then
        log "WARN" "Failed to determine public IP address"
        PUBLIC_IP="127.0.0.1"  # Fallback to localhost
    else
        log "INFO" "Public IP address: $PUBLIC_IP"
    fi
    
    # Create the environment and configuration files
    log "INFO" "Creating Traction configuration files..."
    
    # Create .env file
    cat > .env << EOF
# ------------------------------------------------------------
# Traction configuration
# ------------------------------------------------------------

TRACTION_ACAPY_SEED=${TRACTION_ACAPY_SEED}

# Exposed service ports
TRACTION_ACAPY_HTTP_PORT=8030
TRACTION_ACAPY_ADMIN_PORT=8031
TRACTION_ACAPY_ADMIN_URL=http://traction-agent:8031

#
# Wallet Storage
#
TRACTION_ACAPY_WALLET_NAME=traction-wallet
TRACTION_ACAPY_WALLET_ENCRYPTION_KEY=key
TRACTION_ACAPY_WALLET_SCHEME=DatabasePerWallet

# Multitenancy configuration vars
TRACTION_MULTITENANCY_CONFIGURATION_WALLET_TYPE=single-wallet-askar
TRACTION_MULTITENANCY_CONFIGURATION_WALLET_NAME=askar-wallet

# ------------------------------------------------------------
# Aca-Py Startup configuration environment variables
# ------------------------------------------------------------

# Public endpoint URL that is registered on the ledger
ACAPY_ENDPOINT=https://${DOMAIN_NAME}/agent/

ACAPY_AUTO_PROVISION=true
ACAPY_WALLET_TYPE=askar
ACAPY_WALLET_STORAGE_TYPE=postgres_storage
ACAPY_LABEL="${ORG_PREFIX} Agent"
ACAPY_GENESIS_URL=http://genesis.digicred.services:9000/genesis
ACAPY_GENESIS_URL_1=http://genesis.digicred.services:9000/genesis
ACAPY_GENESIS_TRANSACTIONS_LIST=ledgers.yml
ACAPY_READ_ONLY_LEDGER=false

ACAPY_ADMIN_API_KEY=digicred-me
ACAPY_ADMIN_INSECURE_MODE=false

ACAPY_AUTO_ACCEPT_INVITES=true
ACAPY_AUTO_ACCEPT_REQUESTS=true
ACAPY_AUTO_RESPOND_MESSAGES=true
ACAPY_AUTO_RESPOND_CREDENTIAL_PROPOSAL=false
ACAPY_AUTO_RESPOND_CREDENTIAL_OFFER=false
ACAPY_AUTO_RESPOND_CREDENTIAL_REQUEST=true
ACAPY_AUTO_RESPOND_PRESENTATION_PROPOSAL=true
ACAPY_AUTO_RESPOND_PRESENTATION_REQUEST=false
ACAPY_AUTO_VERIFY_PRESENTATION=true
ACAPY_AUTO_PING_CONNECTION=true
ACAPY_MONITOR_PING=true
ACAPY_PUBLIC_INVITES=true

ACAPY_LOG_LEVEL=info 

ACAPY_MULTITENANT=true
ACAPY_MULTITENANT_ADMIN=true
ACAPY_MULTITENANT_JWT_SECRET=digicred-me
ACAPY_MULTITENANCY_CONFIGURATION={"wallet_type":"\${TRACTION_MULTITENANCY_CONFIGURATION_WALLET_TYPE}","wallet_name":"\${TRACTION_MULTITENANCY_CONFIGURATION_WALLET_NAME}"}

ACAPY_EMIT_NEW_DIDCOMM_PREFIX=true
ACAPY_EMIT_NEW_DIDCOMM_MIME_TYPE=true

ACAPY_ENDORSER_ROLE=author
ACAPY_ENDORSER_ALIAS=endorser
ACAPY_AUTO_REQUEST_ENDORSEMENT=true
ACAPY_AUTO_WRITE_TRANSACTIONS=true
ACAPY_AUTO_PROMOTE_AUTHOR_DID=true

ACAPY_CREATE_REVOCATION_TRANSACTIONS=true

ACAPY_TAILS_SERVER_BASE_URL=https://tails-test.vonx.io
ACAPY_TAILS_SERVER_UPLOAD_URL=https://tails-test.vonx.io

ACAPY_NOTIFY_REVOCATION=true
ACAPY_MONITOR_REVOCATION_NOTIFICATION=true

ACAPY_PRESERVE_EXCHANGE_RECORDS=true
ACAPY_AUTO_STORE_CREDENTIAL=true

ACAPY_PLUGIN_CONFIG=plugin-config.yml

# ------------------------------------------------------------
# Postgres Storage
# ------------------------------------------------------------

POSTGRESQL_HOST=traction-db
POSTGRESQL_PORT=5432
POSTGRESQL_USER=postgres
POSTGRESQL_PASSWORD=postgresPass
POSTGRESQL_DB=traction_acapy

# ------------------------------------------------------------
# Endorser Configuration
# ------------------------------------------------------------

ACAPY_ENDORSER_SEED=${ACAPY_ENDORSER_SEED}
ACAPY_ENDORSER_SEED_1=${ACAPY_ENDORSER_SEED_1}
ACAPY_ENDORSER_PUBLIC_DID=${ACAPY_ENDORSER_PUBLIC_DID}
ACAPY_ENDORSER_1_PUBLIC_DID=${ACAPY_ENDORSER_1_PUBLIC_DID}

# ------------------------------------------------------------
# Endorser Services
# ------------------------------------------------------------

ENDORSER_SERVICE_HOST=localhost
ENDORSER_SERVICE_PORT=5300
ENDORSER_1_SERVICE_PORT=5301
ENDORSER_API_PORT=5000
ENDORSER_API_1_PORT=5001

ACAPY_ENDORSER_ADMIN_PORT=9031
ACAPY_ENDORSER_HTTP_PORT=9030
ACAPY_ENDORSER_ENDPOINT=http://endorser-agent:9030
ACAPY_ENDORSER_1_ADMIN_PORT=9033
ACAPY_ENDORSER_1_HTTP_PORT=9032
ACAPY_ENDORSER_1_ENDPOINT=http://endorser-agent-1:9032

ENDORSER_AGENT_NAME="Endorser Agent"
ENDORSER_CONNECTION_ALIAS=endorser


ENDORSER_ACAPY_ADMIN_URL_API_KEY=digicred-me
ENDORSER_ACAPY_ADMIN_CONFIG=--admin-api-key \${ENDORSER_ACAPY_ADMIN_URL_API_KEY}
ENDORSER_ACAPY_WEBHOOK_URL_API_KEY=0e6eb09282024d0d4ccf8c44b9abea

ENDORSER_WEBHOOK_URL=http://endorser-api:5000/webhook#\${ENDORSER_ACAPY_WEBHOOK_URL_API_KEY}
ENDORSER_1_WEBHOOK_URL=http://endorser-api-1:5001/webhook#\${ENDORSER_ACAPY_WEBHOOK_URL_API_KEY}

ENDORSER_ACAPY_ADMIN_URL=http://endorser-agent:9031
ENDORSER_1_ACAPY_ADMIN_URL=http://endorser-agent-1:9033

ENDORSER_ACAPY_WALLET_TYPE=askar
ENDORSER_ACAPY_WALLET_STORAGE_TYPE=postgres_storage
ENDORSER_ACAPY_WALLET_DATABASE=endorser-wallet
ENDORSER_1_ACAPY_WALLET_DATABASE=endorser-wallet-1
ENDORSER_ACAPY_WALLET_ENCRYPTION_KEY=key

ENDORSER_POSTGRESQL_HOST=endorser-db
ENDORSER_1_POSTGRESQL_HOST=endorser-db-1
ENDORSER_POSTGRESQL_PORT=5433
ENDORSER_1_POSTGRESQL_PORT=5434
ENDORSER_POSTGRESQL_USER=postgres
ENDORSER_POSTGRESQL_PASSWORD=postgresPass

## endorser
ENDORSER_PSQL_DB=traction
ENDORSER_PSQL_ADMIN=tractionadminuser
ENDORSER_PSQL_ADMIN_PWD=tractionadminPass
ENDORSER_PSQL_USER=tractionuser
ENDORSER_PSQL_USER_PWD=tractionPass

ENDORSER_API_ADMIN_USER=endorser
ENDORSER_API_ADMIN_KEY=digicred-me

# ------------------------------------------------------------
# Tenant UI Configuration
# ------------------------------------------------------------
TENANT_UI_PORT=5101

SERVER_TRACTION_URL=https://${DOMAIN_NAME}/proxy
FRONTEND_TENANT_PROXY_URL=https://${DOMAIN_NAME}/proxy
IMAGE_BUILDTIME=
IMAGE_TAG=scripts_tenant-ui:latest
IMAGE_VERSION=latest
UX_APP_TITLE=${ORG_PREFIX} Tenant Console
UX_APP_INNKEEPER_TITLE=${ORG_PREFIX} Innkeeper Console
UX_SIDEBAR_TITLE=${ORG_PREFIX}
UX_COPYRIGHT=2024 © DigiCred Holdings
UX_OWNER=DigiCred Holdings
FRONTEND_QUICK_CONNECT_ENDORSER_NAME=digicred-endorser

# ------------------------------------------------------------
# Aca-py Admin Reverse Proxy (for tenant access) Configuration
# ------------------------------------------------------------

TENANT_PROXY_PORT=8032

# ------------------------------------------------------------
# Plugins
# ------------------------------------------------------------

TRACTION_INNKEEPER_TENANT_ID=innkeeper
TRACTION_INNKEEPER_WALLET_NAME=traction_innkeeper
TRACTION_INNKEEPER_WALLET_KEY=change-me


# ------------------------------------------------------------
# Controller config
# ------------------------------------------------------------

# CRMS Connections
API_BASE_URL=https://${DOMAIN_NAME}/proxy
SWAGGER_API_URL=https://${DOMAIN_NAME}/proxy
BEARER_TOKEN=${CONTROLLER_BEARER_TOKEN}
API_KEY=${CONTROLLER_API_KEY}

PORT=3000
HOST=0.0.0.0

# Organization Information
SCHOOL="${ORG_PREFIX} University"
SCHOOL_WELCOME_MESSAGE="Welcome to the ${ORG_PREFIX} credential service!"
ISSUE_STUDENT_ID_MESSAGE="We are sending you your student ID credential. You will be able to use this to prove that you are a current student at your school. Click View Offer and Accept to receive your Student ID."
ISSUE_STUDENT_TRANSCRIPT_MESSAGE="We have sent your transcripts. You will be able to use this to demonstrate your scholastic accomplishments. Click View Offer and Accept to receive your Transcript."
REQUEST_STUDENT_ID_VERIFICATION_MESSAGE="We need to verify your student ID."
REQUEST_STUDENT_TRANSCRIPT_VERIFICATION_MESSAGE="Please verify your credential."

# Redis
REDIS_HOST=localhost
REDIS_PASSWORD=redis-password
REDIS_DB=0
REDIS_PORT=6379

# PostgreSQL 
WORKFLOW_DB_USER=postgres
WORKFLOW_DB_PASSWORD=dbsecret
WORKFLOW_DB_NAME=
WORKFLOW_DB_HOST=postgres
WORKFLOW_DB_PORT=5432

WEBHOOK_API_KEY=${WEBHOOK_API_KEY}
LOAD_TYPE=${LOAD_TYPE}
EOF

    # Create ledgers.yml
    cat > ledgers.yml << EOF
- id: digicred
  is_production: true
  is_write: true
  genesis_url: 'http://genesis.digicred.services:9000/genesis'
  endorser_did: `${ACAPY_ENDORSER_PUBLIC_DID}`
  endorser_alias: 'digicred-endorser'
- id: digicred-1
  is_production: true
  is_write: true
  genesis_url: 'http://genesis.digicred.services:9000/genesis'
  endorser_did: `${ACAPY_ENDORSER_1_PUBLIC_DID}`
  endorser_alias: 'digicred-endorser-1'
EOF

    # Create plugin-config.yml
    cat > plugin-config.yml << EOF
multitenant_provider:
  manager:
    class_name: "multitenant_provider.v1_0.manager.AskarMultitokenMultitenantManager"
    always_check_provided_wallet_key: true
  errors:
    on_unneeded_wallet_key: false
  token_expiry:
    units: months
    amount: 3

traction_innkeeper:
  innkeeper_wallet:
    tenant_id: innkeeper
    wallet_name: traction_innkeeper
    wallet_key: change-me
    print_key: true
    print_token: true
    connect_to_endorser: [
      {
        "endorser_alias": "digicred-endorser",
        "ledger_id": "digicred",
      },
      {
        "endorser_alias": "digicred-endorser-1",
        "ledger_id": "digicred-1",
      }
    ]
    create_public_did: ["digicred", "digicred-1"]
  reservation:
    auto_approve: true
    expiry_minutes: 2880
    auto_issuer: true

basicmessage_storage:
  wallet_enabled: true
EOF

    # Create endorser-acapy-args.yml
    cat > endorser-acapy-args.yml << EOF
auto-accept-invites: true
auto-accept-requests: true
auto-respond-messages: true
auto-ping-connection: true
auto-provision: true
monitor-ping: true
public-invites: true
plugin: 'aries_cloudagent.messaging.jsonld'
outbound-transport: http
log-level: info
endorser-protocol-role: endorser
requests-through-public-did: true
auto-endorse-transactions: true
EOF

    return 0
}

# Function to start Docker Compose
start_docker() {
    log "INFO" "Starting Docker and Docker Compose..."
    
    # Install Docker if not already installed
    if ! command_exists docker; then
        log "INFO" "Docker not found, installing..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER
    fi
    
    # Install Docker Compose if not already installed
    if ! command_exists docker-compose && ! docker compose version > /dev/null 2>&1; then
        log "INFO" "Docker Compose plugin not found, installing..."
        sudo apt-get update
        sudo apt-get install -y docker-compose-plugin
    fi
    
    # Start Traction using Docker Compose
    log "INFO" "Starting Traction application with Docker Compose..."
    cd /opt/traction-docker-compose/digicred
    
    if docker compose up -d; then
        log "INFO" "Traction application started successfully"
        return 0
    else
        log "ERROR" "Failed to start Traction application with Docker Compose"
        return 1
    fi
}

# Setup cron job for certificate renewal
setup_cron() {
    log "INFO" "Setting up cron job for certificate renewal..."
    
    # Add cron job for certificate renewal
    (crontab -l 2>/dev/null || echo "") | grep -v "certbot renew" | \
    { cat; echo "0 0,12 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'"; } | \
    crontab -
    
    log "INFO" "Cron job added for certificate renewal"
}

# Setup status check for application
setup_status_monitor() {
    log "INFO" "Setting up application status monitoring..."
    
    # Create status monitor script
    sudo tee /usr/local/bin/check-traction-status.sh > /dev/null << 'EOF'
#!/bin/bash
LOG_FILE="/var/log/traction-status.log"
echo "$(date): Checking Traction application status..." >> $LOG_FILE

# Check if Docker is running
if ! systemctl is-active --quiet docker; then
    echo "$(date): Docker service is not running. Attempting to start..." >> $LOG_FILE
    systemctl start docker
fi

# Check if Nginx is running
if ! systemctl is-active --quiet nginx; then
    echo "$(date): Nginx service is not running. Attempting to start..." >> $LOG_FILE
    systemctl start nginx
fi

# Check if Traction containers are running
cd /opt/traction-docker-compose/digicred
if ! docker compose ps | grep -q "Up"; then
    echo "$(date): Traction containers are not running. Attempting to start..." >> $LOG_FILE
    docker compose up -d
fi

# Check if SSL certificate is valid and not about to expire
if certbot certificates | grep -q "INVALID"; then
    echo "$(date): SSL certificate is invalid. Attempting to renew..." >> $LOG_FILE
    certbot renew --quiet --deploy-hook 'systemctl reload nginx'
fi

echo "$(date): Status check completed." >> $LOG_FILE
EOF

    sudo chmod +x /usr/local/bin/check-traction-status.sh
    
    # Add cron job to run status check hourly
    (crontab -l 2>/dev/null || echo "") | \
    { cat; echo "0 * * * * /usr/local/bin/check-traction-status.sh"; } | \
    crontab -
    
    log "INFO" "Status monitoring setup completed"
}

# Main execution flow
main() {
    log "INFO" "Starting main execution flow..."
    
    # Install dependencies
    install_dependencies
    
    # Validate domain DNS resolution
    if ! validate_domain "$DOMAIN_NAME"; then
        log "WARN" "Domain validation failed but proceeding with setup..."
    fi
    
    # Setup initial Nginx config for HTTP
    if ! setup_nginx; then
        log "ERROR" "Failed to setup Nginx. Exiting."
        exit 1
    fi
    
    # Setup Traction configuration
    if ! setup_traction; then
        log "ERROR" "Failed to setup Traction configuration. Exiting."
        exit 1
    fi
    
    # Setup SSL certificates using the provided email
    if ! setup_ssl "$DOMAIN_NAME" "$EMAIL"; then
        log "ERROR" "Failed to setup SSL certificates. HTTP-only mode will be used."
        # Continue anyway, as we might be testing without DNS
    fi
    
    # Start Docker Compose
    if ! start_docker; then
        log "ERROR" "Failed to start Docker Compose. Exiting."
        exit 1
    fi
    
    # Setup cron jobs
    setup_cron
    
    # Setup status monitoring
    setup_status_monitor
    
    log "INFO" "${ORG_PREFIX} Traction deployment completed successfully!"
    log "INFO" "Access the application at https://${DOMAIN_NAME} or http://${DOMAIN_NAME} if SSL is not yet configured."
    
    return 0
}

# Execute main function
main

exit 0