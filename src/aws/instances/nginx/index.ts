// File: src/aws/nginx/index.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { NginxConfig } from "../types";
import { storeNginxScriptInS3 } from "./store-script";

export function createNginxInstance(
    config: NginxConfig, 
    scriptBucket: aws.s3.Bucket,
    opts?: pulumi.ComponentResourceOptions
): aws.ec2.Instance {
    const instanceConfig = new pulumi.Config();

    // Get configuration values
    const rawServerName = instanceConfig.get("awsNginxServerDNS") || "";
    const rawLetsEncryptEmail = instanceConfig.get("awsLetsEncryptEmail") || "";
    
    // Validate domain name and email
    const domainRegex = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;
    const serverName = domainRegex.test(rawServerName) ? rawServerName : "";
    
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

    // Store the full script in S3 and get the minimal bootstrap script
    const bootstrapScript = storeNginxScriptInS3(
        config,
        serverName,
        letsEncryptEmail,
        timestamp,
        scriptBucket
    );

    // Create the Nginx instance with the bootstrap script
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
        userData: bootstrapScript,
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