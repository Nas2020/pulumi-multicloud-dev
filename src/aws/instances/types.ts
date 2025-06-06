// File: src/aws/instances/types.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface InstanceConfig {
    name: string;
    instanceType: string;
    subnetId: pulumi.Output<string>;
    securityGroupId: pulumi.Output<string>;
    iamInstanceProfile: pulumi.Output<string>;
}

export interface NginxConfig extends InstanceConfig {
    tractionIp: pulumi.Output<string>;
    controllerIp: pulumi.Output<string>;
    elasticIpId: pulumi.Output<string>;
    elasticIp: pulumi.Output<string>;
    dependsOn?: aws.ec2.Instance[];
}