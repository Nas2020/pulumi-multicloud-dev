import * as pulumi from "@pulumi/pulumi";

// AWS imports
import { createBaseInfra as createAwsBaseInfra } from "./aws/base-infra";
import { createSecuritySecrets as createAwsSecuritySecrets } from "./aws/security-secrets";
import { createEc2Instances } from "./aws/ec2-instances";

// Azure imports
import { createBaseInfra as createAzureBaseInfra, BaseInfraOutputs as AzureBaseInfraOutputs } from "./azure/base-infra";
import { createSecuritySecrets as createAzureSecuritySecrets, SecuritySecretsOutputs as AzureSecuritySecretsOutputs } from "./azure/security-secrets";
import { createVmInstances } from "./azure/vm-instances";

const config = new pulumi.Config();
const cloudProvider = config.require("cloudProvider");

let infrastructureOutputs: any;

if (cloudProvider === "aws") {
    const baseInfraOutputs = createAwsBaseInfra();
    const securitySecretsOutputs = createAwsSecuritySecrets(baseInfraOutputs);
    const ec2InstancesOutputs = createEc2Instances(baseInfraOutputs, securitySecretsOutputs);

    infrastructureOutputs = {
        ...baseInfraOutputs,
        ...securitySecretsOutputs,
        ...ec2InstancesOutputs,
        privateRouteTableIds: baseInfraOutputs.privateRouteTableIds,
        natGatewayIds: baseInfraOutputs.natGatewayIds,
        nginxSecurityGroupId: securitySecretsOutputs.nginxSecurityGroupId,
        appSecurityGroupId: securitySecretsOutputs.appSecurityGroupId,
        cloudProvider
    };
} else if (cloudProvider === "azure") {
    const azureSubscriptionId = config.get("azureSubscriptionId") || "";
    const baseInfraOutputs = createAzureBaseInfra();
    const securitySecretsOutputs = createAzureSecuritySecrets(baseInfraOutputs);
    const vmInstancesOutputs = createVmInstances(baseInfraOutputs, securitySecretsOutputs);

    infrastructureOutputs = {
        ...baseInfraOutputs,
        ...securitySecretsOutputs,
        resourceGroupName: baseInfraOutputs.resourceGroupName,
        vnetId: baseInfraOutputs.vnetId,
        publicSubnetIds: baseInfraOutputs.publicSubnetIds,
        privateSubnetIds: baseInfraOutputs.privateSubnetIds,
        natGatewayIds: baseInfraOutputs.natGatewayIds,
        webNsgId: securitySecretsOutputs.webNsgId,
        appNsgId: securitySecretsOutputs.appNsgId,
        keyVaultUri: securitySecretsOutputs.keyVaultUri,
        managedIdentityId: securitySecretsOutputs.managedIdentityId,
        azureSubscriptionId,
        webPublicIp: vmInstancesOutputs.webPublicIp,
        tractionPrivateIp: vmInstancesOutputs.tractionPrivateIp,
        controllerPrivateIp: vmInstancesOutputs.controllerPrivateIp,
        publicIpAddress: vmInstancesOutputs.publicIpAddress,
        cloudProvider
    };
} else {
    throw new Error(`Unsupported cloud provider: "${cloudProvider}".`);
}

export const selectedCloudProvider = cloudProvider;
export const outputs = infrastructureOutputs;
