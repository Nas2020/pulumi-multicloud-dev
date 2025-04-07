// File: src/aws/nginx/store-script.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { NginxConfig } from "../types";
import { getNginxInitScript } from "./init-script";

/**
 * Stores the Nginx initialization script in S3 and returns a minimal bootstrap script
 */
export function storeNginxScriptInS3(
    config: NginxConfig,
    serverName: string,
    letsEncryptEmail: string,
    timestamp: string,
    bucket: aws.s3.Bucket
): pulumi.Output<string> {
    // Generate the full initialization script
    const fullScript = getNginxInitScript(config, serverName, letsEncryptEmail, timestamp);
    
    // Create a unique key for the script in S3
    const scriptKey = `scripts/nginx-init-${timestamp.replace(/[:.]/g, "-")}.sh`;
    
    // Upload the script to S3
    const scriptObject = new aws.s3.BucketObject("nginx-init-script", {
        bucket: bucket.id,
        key: scriptKey,
        content: fullScript,
        contentType: "text/x-shellscript",
    });
    
    // Generate a minimal bootstrap script to download and run the full script
    return pulumi.interpolate`#!/bin/bash
set -e
exec > >(tee /var/log/nginx-bootstrap.log) 2>&1

echo "===== Starting Nginx bootstrap ====="
echo "Installing AWS CLI if needed..."
apt-get update
apt-get install -y awscli

echo "Downloading Nginx setup script from S3..."
aws s3 cp s3://${bucket.bucket}/${scriptKey} /tmp/nginx-setup.sh

echo "Making script executable..."
chmod +x /tmp/nginx-setup.sh

echo "Running setup script..."
/tmp/nginx-setup.sh

echo "Bootstrap complete!"`;
}