// File: src/azure/instances/types.ts
import * as compute from "@pulumi/azure-native/compute";
import * as pulumi from "@pulumi/pulumi";

export interface InstanceConfig {
    name: string;
    vmSize: string;
    subnetId: pulumi.Input<string>;
    nsgId: pulumi.Input<string>;
    managedIdentityId: pulumi.Input<string>;
    resourceGroupName: pulumi.Input<string>;
}

export interface WebConfig extends InstanceConfig {
    tractionIp: pulumi.Input<string>;
    controllerIp: pulumi.Input<string>;
    publicIpId: pulumi.Input<string>;
}

// Output interfaces
export interface AppInstanceOutputs {
    vm: compute.VirtualMachine;  
    vmId: pulumi.Output<string>;
    privateIp: pulumi.Output<string>;
}

export interface WebInstanceOutputs {
    vmId: pulumi.Output<string>;
    privateIp: pulumi.Output<string>;
}
