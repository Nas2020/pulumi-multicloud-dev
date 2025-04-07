// File: src/aws/ec2-instances.ts
import { createTractionSecrets } from "./traction-secrets";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { BaseInfraOutputs } from "./base-infra";
import { SecuritySecretsOutputs } from "./security-secrets";
import { createTractionInstance } from "./instances/traction";
import { createControllerInstance } from "./instances/controller";
import { createNginxInstance } from "./instances/nginx";
import { createTractionConfig } from "./traction-config";

export interface Ec2InstancesOutputs {
    nginxPublicIp: pulumi.Output<string>;
    tractionPrivateIp: pulumi.Output<string>;
    controllerPrivateIp: pulumi.Output<string>;
    elasticIp: pulumi.Output<string>;
    tractionSecretArn: pulumi.Output<string>;
    tractionConfigBucket: pulumi.Output<string>;
}

export function createEc2Instances(
    baseInfra: BaseInfraOutputs, 
    securitySecrets: SecuritySecretsOutputs
): Ec2InstancesOutputs {
    const config = new pulumi.Config();
    
    // Create Traction configuration and secrets
    const tractionSecrets = createTractionSecrets();
    const tractionConfig = createTractionConfig();
    
    // Create S3 bucket for scripts (new)
    const scriptsBucket = new aws.s3.Bucket("scripts-bucket", {
        bucket: `scripts-${pulumi.getStack()}-${pulumi.getOrganization()}-${pulumi.getProject()}`,
        acl: "private",
        versioning: {
            enabled: true,
        },
        tags: {
            Name: `scripts-${pulumi.getStack()}`,
            Environment: pulumi.getStack(),
            Service: "infrastructure"
        },
    });
    
    // Create EIP and other resources as before
    const eip = new aws.ec2.Eip("nginx-eip", {
        domain: "vpc",
        tags: { Name: "nginx-eip" },
    });
    
    const tractionInstance = createTractionInstance(
        {
            name: "traction-instance",
            instanceType: config.get("awsTractionInstanceType") || "t2.large",
            subnetId: baseInfra.privateSubnetIds.apply(ids => ids[0]),
            securityGroupId: securitySecrets.tractionSecurityGroupId,
            iamInstanceProfile: securitySecrets.instanceProfileName,
        }, 
        tractionSecrets.secretArn,
        tractionConfig.configBucket,
        tractionConfig.configObjectKey,
        eip.publicIp,
        { dependsOn: [baseInfra.natGateways[0]] }
    );
    
    const controllerInstance = createControllerInstance({
        name: "controller-instance",
        instanceType: config.get("awsControllerInstanceType") || "t2.medium",
        subnetId: baseInfra.privateSubnetIds.apply(ids => ids[1]),
        securityGroupId: securitySecrets.appSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
    }, { dependsOn: [baseInfra.natGateways[1]] });
    
    // Pass the scripts bucket to the Nginx instance creation
    const nginxInstance = createNginxInstance({
        name: "nginx-instance",
        instanceType: config.get("awsNginxInstanceType") || "t2.micro",
        subnetId: baseInfra.publicSubnetIds.apply(ids => ids[0]),
        securityGroupId: securitySecrets.nginxSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
        tractionIp: tractionInstance.privateIp,
        controllerIp: controllerInstance.privateIp,
        elasticIpId: eip.id,
        elasticIp: eip.publicIp,
    }, scriptsBucket, { dependsOn: [tractionInstance, controllerInstance] });
    
      return {
        nginxPublicIp: eip.publicIp,
        tractionPrivateIp: tractionInstance.privateIp,
        controllerPrivateIp: controllerInstance.privateIp,
        elasticIp: eip.publicIp,
        tractionSecretArn: tractionSecrets.secretArn,
        tractionConfigBucket: tractionConfig.configBucket,
    };
}