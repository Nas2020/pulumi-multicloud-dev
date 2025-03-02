// File: src/azure/instances/types.ts
import * as azure from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";

export interface InstanceConfig {
    name: string;
    vmSize: string;
    subnetId: pulumi.Output<string>;
    networkSecurityGroupId: pulumi.Output<string>;
    resourceGroupName: string;
    managedIdentityId: pulumi.Output<string>;
}

export interface NginxConfig extends InstanceConfig {
    tractionIp: pulumi.Output<string>;
    controllerIp: pulumi.Output<string>;
    publicIpId: pulumi.Output<string>;
    publicIp: pulumi.Output<string>;
    dependsOn?: azure.compute.VirtualMachine[];
}

export function createAppInstance(config: InstanceConfig, opts?: pulumi.ComponentResourceOptions): azure.compute.VirtualMachine;
export function createNginxInstance(config: NginxConfig, opts?: pulumi.ComponentResourceOptions): azure.compute.VirtualMachine;