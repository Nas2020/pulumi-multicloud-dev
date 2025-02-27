// File: src/aws/ec2-instances.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { BaseInfraOutputs } from "./base-infra";
import { SecuritySecretsOutputs } from "./security-secrets";
import { createAppInstance } from "./instances/app";
import { createNginxInstance } from "./instances/nginx";

export interface Ec2InstancesOutputs {
    nginxPublicIp: pulumi.Output<string>;
    tractionPrivateIp: pulumi.Output<string>;
    controllerPrivateIp: pulumi.Output<string>;
    elasticIp: pulumi.Output<string>;
}

export function createEc2Instances(
    baseInfra: BaseInfraOutputs, 
    securitySecrets: SecuritySecretsOutputs
): Ec2InstancesOutputs {
    const config = new pulumi.Config();

    const eip = new aws.ec2.Eip("nginx-eip", {
        domain: "vpc",
        tags: { Name: "nginx-eip" },
    });

    const tractionInstance = createAppInstance({
        name: "traction-test-instance",
        instanceType: config.get("tractionInstanceType") || "t2.large",
        subnetId: baseInfra.privateSubnetIds.apply(ids => ids[0]),
        securityGroupId: securitySecrets.appSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
    }, { dependsOn: [baseInfra.natGateways[0]] }); // Depend on the first NAT Gateway

    const controllerInstance = createAppInstance({
        name: "controller-test-instance",
        instanceType: config.get("controllerInstanceType") || "t2.medium",
        subnetId: baseInfra.privateSubnetIds.apply(ids => ids[1]),
        securityGroupId: securitySecrets.appSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
    }, { dependsOn: [baseInfra.natGateways[1]] }); // Depend on the second NAT Gateway

    const nginxInstance = createNginxInstance({
        name: "nginx-instance",
        instanceType: config.get("nginxInstanceType") || "t2.micro",
        subnetId: baseInfra.publicSubnetIds.apply(ids => ids[0]),
        securityGroupId: securitySecrets.nginxSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
        tractionIp: tractionInstance.privateIp,
        controllerIp: controllerInstance.privateIp,
        elasticIpId: eip.id,
        elasticIp: eip.publicIp,
    }, { dependsOn: [tractionInstance, controllerInstance] });

    return {
        nginxPublicIp: eip.publicIp,
        tractionPrivateIp: tractionInstance.privateIp,
        controllerPrivateIp: controllerInstance.privateIp,
        elasticIp: eip.publicIp,
    };
}