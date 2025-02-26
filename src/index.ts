import * as pulumi from "@pulumi/pulumi";
import { createBaseInfra, BaseInfraOutputs } from "./aws/base-infra";
import { createSecuritySecrets, SecuritySecretsOutputs } from "./aws/security-secrets";
import { createEc2Instances, Ec2InstancesOutputs } from "./aws/ec2-instances";

const config = new pulumi.Config();
const cloudProvider = config.require("cloudProvider");

let baseInfraOutputs: BaseInfraOutputs;
let securitySecretsOutputs: SecuritySecretsOutputs;
let ec2InstancesOutputs: Ec2InstancesOutputs;

if (cloudProvider === "aws") {
    baseInfraOutputs = createBaseInfra();
    securitySecretsOutputs = createSecuritySecrets(baseInfraOutputs);
    ec2InstancesOutputs = createEc2Instances(baseInfraOutputs, securitySecretsOutputs);
} else {
    throw new Error(`Unsupported cloud provider: "${cloudProvider}". Only "aws" is currently supported. Please check your Pulumi.dev.yaml config under "pulumi-multicloud:cloudProvider".`);
}

export const selectedCloudProvider = cloudProvider;
export const infrastructureOutputs = {
    ...baseInfraOutputs,
    ...securitySecretsOutputs,
    ...ec2InstancesOutputs,
    privateRouteTableIds: baseInfraOutputs.privateRouteTableIds,
    natGatewayIds: baseInfraOutputs.natGatewayIds,
    nginxSecurityGroupId: securitySecretsOutputs.nginxSecurityGroupId,
    appSecurityGroupId: securitySecretsOutputs.appSecurityGroupId,
};
