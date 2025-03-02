// import * as pulumi from "@pulumi/pulumi";
// import { createBaseInfra, BaseInfraOutputs } from "./aws/base-infra";
// import { createSecuritySecrets, SecuritySecretsOutputs } from "./aws/security-secrets";
// import { createEc2Instances, Ec2InstancesOutputs } from "./aws/ec2-instances";

// const config = new pulumi.Config();
// const cloudProvider = config.require("cloudProvider");

// let baseInfraOutputs: BaseInfraOutputs;
// let securitySecretsOutputs: SecuritySecretsOutputs;
// let ec2InstancesOutputs: Ec2InstancesOutputs;

// if (cloudProvider === "aws") {
//     baseInfraOutputs = createBaseInfra();
//     securitySecretsOutputs = createSecuritySecrets(baseInfraOutputs);
//     ec2InstancesOutputs = createEc2Instances(baseInfraOutputs, securitySecretsOutputs);
// } else {
//     throw new Error(`Unsupported cloud provider: "${cloudProvider}". Only "aws" is currently supported. Please check your Pulumi.dev.yaml config under "pulumi-multicloud:cloudProvider".`);
// }

// export const selectedCloudProvider = cloudProvider;
// export const infrastructureOutputs = {
//     ...baseInfraOutputs,
//     ...securitySecretsOutputs,
//     ...ec2InstancesOutputs,
//     privateRouteTableIds: baseInfraOutputs.privateRouteTableIds,
//     natGatewayIds: baseInfraOutputs.natGatewayIds,
//     nginxSecurityGroupId: securitySecretsOutputs.nginxSecurityGroupId,
//     appSecurityGroupId: securitySecretsOutputs.appSecurityGroupId,
// };


import * as pulumi from "@pulumi/pulumi";

// AWS imports
import { createBaseInfra as createAwsBaseInfra, BaseInfraOutputs as AwsBaseInfraOutputs } from "./aws/base-infra";
import { createSecuritySecrets as createAwsSecuritySecrets, SecuritySecretsOutputs as AwsSecuritySecretsOutputs } from "./aws/security-secrets";
import { createEc2Instances, Ec2InstancesOutputs } from "./aws/ec2-instances";

// Azure imports
import { createBaseInfra as createAzureBaseInfra, BaseInfraOutputs as AzureBaseInfraOutputs } from "./azure/base-infra";
// import { createSecuritySecrets as createAzureSecuritySecrets, SecuritySecretsOutputs as AzureSecuritySecretsOutputs } from "./azure/security-secrets";
// import { createVmInstances, VmInstancesOutputs } from "./azure/vm-instances";

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
        cloudProvider: "aws",
    };
} else if (cloudProvider === "azure") {
    const azureSubscriptionId = config.get("azureSubscriptionId") || "";
    const baseInfraOutputs = createAzureBaseInfra();

    infrastructureOutputs = {
        ...baseInfraOutputs,
        resourceGroupName: baseInfraOutputs.resourceGroupName,
        vnetId: baseInfraOutputs.vnetId,
        publicSubnetIds: baseInfraOutputs.publicSubnetIds,
        privateSubnetIds: baseInfraOutputs.privateSubnetIds,
        natGatewayIds: baseInfraOutputs.natGatewayIds,
        azureSubscriptionId: azureSubscriptionId,
        cloudProvider: "azure",
    };
} else {
    throw new Error(`Unsupported cloud provider: "${cloudProvider}".`);
}

export const selectedCloudProvider = cloudProvider;
export const outputs = infrastructureOutputs;
