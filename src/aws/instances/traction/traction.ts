// /src/aws/instances/traction.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { InstanceConfig } from "../types";
import { 
    generateBaseSetupScript, 
    generateTractionAppSetupScript, 
    generateFinalizationScript 
} from "./user-data-scripts";

export function createTractionInstance(
    config: InstanceConfig,
    secretArn: pulumi.Output<string>,
    configBucket: pulumi.Output<string>,
    configKey: pulumi.Output<string>,
    nginxPublicIp: pulumi.Output<string>,
    opts?: pulumi.ComponentResourceOptions
): aws.ec2.Instance {

    const pulumiConfig = new pulumi.Config();

    // Get the current region
    const currentRegion = aws.config.region || "us-east-1";

    // Get server DNS
    const awsNginxServerDNS = pulumiConfig.get("awsNginxServerDNS") || nginxPublicIp
    
    // Combine the modular user data scripts into a complete script
    const userData = pulumi.interpolate`${generateBaseSetupScript(config.name, awsNginxServerDNS)}
${generateTractionAppSetupScript(currentRegion, secretArn, configBucket, configKey)}
${generateFinalizationScript(config.name)}`;

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
        userData: userData,
        iamInstanceProfile: config.iamInstanceProfile,
        tags: { 
            Name: config.name,
            Service: "traction",
            Product: "DigiCred",
            Environment: pulumi.getStack(),
            AutoRecovery: "true"
        },
    }, opts);

    return instance;
}