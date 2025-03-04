import * as pulumi from "@pulumi/pulumi";
import * as network from "@pulumi/azure-native/network";
import { BaseInfraOutputs } from "./base-infra";
import { SecuritySecretsOutputs } from "./security-secrets";
import { createAppInstance } from "./instances/app";
import { createWebInstance } from "./instances/web";

export interface VmInstancesOutputs {
    webPublicIp: pulumi.Output<string | undefined>;
    tractionPrivateIp: pulumi.Output<string | undefined>;
    controllerPrivateIp: pulumi.Output<string | undefined>;
    publicIpAddress: pulumi.Output<string | undefined>;
}


export function createVmInstances(
    baseInfra: BaseInfraOutputs,
    securitySecrets: SecuritySecretsOutputs
): VmInstancesOutputs {
    const config = new pulumi.Config();
    
    // Create a public IP for the web VM (equivalent to Elastic IP in AWS)
    const publicIp = new network.PublicIPAddress("web-public-ip", {
        resourceGroupName: baseInfra.resourceGroupName,
        publicIPAllocationMethod: network.IPAllocationMethod.Static,
        // publicIPAddressName removed as it may cause an error in some Azure regions
        tags: { Name: "web-public-ip" },
    });

    // Helper function to safely get an element from natGatewayIds array
    const getNatGatewayId = (index: number): pulumi.Output<string> => {
        return baseInfra.natGatewayIds.apply(ids => {
            if (ids && ids.length > index) {
                return ids[index];
            }
            return ids[0];
        });
    };

    // Create traction app instance in the first private subnet
    const tractionInstance = createAppInstance({
        name: "traction-test-instance",
        vmSize: config.get("tractionVmSize") || "Standard_D2s_v3",
        subnetId: baseInfra.privateSubnetIds.apply(ids => ids[0]),
        nsgId: securitySecrets.appNsgId,
        managedIdentityId: securitySecrets.managedIdentityId,
        resourceGroupName: baseInfra.resourceGroupName,
    }, { dependsOn: [baseInfra.natGateway] });

    // Create controller app instance in the second private subnet
    const controllerInstance = createAppInstance({
        name: "controller-test-instance",
        vmSize: config.get("controllerVmSize") || "Standard_B2ms",
        subnetId: baseInfra.privateSubnetIds.apply(ids => ids.length > 1 ? ids[1] : ids[0]),
        nsgId: securitySecrets.appNsgId,
        managedIdentityId: securitySecrets.managedIdentityId,
        resourceGroupName: baseInfra.resourceGroupName,
    }, { dependsOn: [baseInfra.natGateway] });

    // Create web instance (nginx equivalent) in the public subnet
    const webInstance = createWebInstance({
        name: "web-instance",
        vmSize: config.get("webVmSize") || "Standard_B1s",
        subnetId: baseInfra.publicSubnetIds.apply(ids => ids[0]),
        nsgId: securitySecrets.webNsgId,
        managedIdentityId: securitySecrets.managedIdentityId,
        resourceGroupName: baseInfra.resourceGroupName,
        publicIpId: publicIp.id,
        tractionIp: tractionInstance.privateIp,
        controllerIp: controllerInstance.privateIp,
    }, { dependsOn: [tractionInstance.vm, controllerInstance.vm] });

    return {
        webPublicIp: publicIp.ipAddress,
        tractionPrivateIp: tractionInstance.privateIp,
        controllerPrivateIp: controllerInstance.privateIp,
        publicIpAddress: publicIp.ipAddress,
    };
}