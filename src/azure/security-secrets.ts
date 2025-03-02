// import * as pulumi from "@pulumi/pulumi";
// import * as azure from "@pulumi/azure-native";
// import * as network from "@pulumi/azure-native/network";
// import * as keyvault from "@pulumi/azure-native/keyvault";
// import * as authorization from "@pulumi/azure-native/authorization";
// import * as identity from "@pulumi/azure-native/managedidentity";
// import { BaseInfraOutputs } from "./base-infra";

// export interface SecuritySecretsOutputs {
//     webNsgId: pulumi.Output<string>;
//     appNsgId: pulumi.Output<string>;
//     keyVaultId: pulumi.Output<string>;
//     keyVaultUri: pulumi.Output<string>;
//     managedIdentityId: pulumi.Output<string>;
//     managedIdentityPrincipalId: pulumi.Output<string>;
// }

// export function createSecuritySecrets(baseInfra: BaseInfraOutputs): SecuritySecretsOutputs {
//     const config = new pulumi.Config();
//     const sshSourceAddressPrefixes = config.getObject<string[]>("azureSshSourceAddressPrefixes") || ["0.0.0.0/0"];
    
//     // Create Network Security Group for web/nginx instances (public facing)
//     const webNsg = new network.NetworkSecurityGroup("web-nsg", {
//         resourceGroupName: baseInfra.resourceGroupName,
//         networkSecurityGroupName: "web-nsg",
//         securityRules: [
//             {
//                 name: "allow-http",
//                 protocol: "Tcp",
//                 sourcePortRange: "*",
//                 destinationPortRange: "80",
//                 sourceAddressPrefix: "*",
//                 destinationAddressPrefix: "*",
//                 access: "Allow",
//                 priority: 100,
//                 direction: "Inbound",
//             },
//             {
//                 name: "allow-https",
//                 protocol: "Tcp",
//                 sourcePortRange: "*",
//                 destinationPortRange: "443",
//                 sourceAddressPrefix: "*",
//                 destinationAddressPrefix: "*",
//                 access: "Allow",
//                 priority: 110,
//                 direction: "Inbound",
//             },
//             {
//                 name: "allow-ssh",
//                 protocol: "Tcp",
//                 sourcePortRange: "*",
//                 destinationPortRange: "22",
//                 sourceAddressPrefixes: sshSourceAddressPrefixes,
//                 destinationAddressPrefix: "*",
//                 access: "Allow",
//                 priority: 120,
//                 direction: "Inbound",
//             },
//             {
//                 name: "allow-outbound-all",
//                 protocol: "*",
//                 sourcePortRange: "*",
//                 destinationPortRange: "*",
//                 sourceAddressPrefix: "*",
//                 destinationAddressPrefix: "*",
//                 access: "Allow",
//                 priority: 100,
//                 direction: "Outbound",
//             },
//         ],
//     });

//     // Create Network Security Group for application instances (private)
//     const appNsg = new network.NetworkSecurityGroup("app-nsg", {
//         resourceGroupName: baseInfra.resourceGroupName,
//         networkSecurityGroupName: "app-nsg",
//         securityRules: [
//             {
//                 name: "allow-http-from-web",
//                 protocol: "Tcp",
//                 sourcePortRange: "*",
//                 destinationPortRange: "80",
//                 sourceAddressPrefix: "*", // In practice you would limit this to the web subnet CIDR
//                 destinationAddressPrefix: "*",
//                 access: "Allow",
//                 priority: 100,
//                 direction: "Inbound",
//             },
//             {
//                 name: "allow-ssh-from-web",
//                 protocol: "Tcp",
//                 sourcePortRange: "*",
//                 destinationPortRange: "22",
//                 sourceAddressPrefix: "*", // In practice you would limit this to the web subnet CIDR
//                 destinationAddressPrefix: "*",
//                 access: "Allow",
//                 priority: 110,
//                 direction: "Inbound",
//             },
//             {
//                 name: "allow-outbound-all",
//                 protocol: "*",
//                 sourcePortRange: "*",
//                 destinationPortRange: "*",
//                 sourceAddressPrefix: "*",
//                 destinationAddressPrefix: "*",
//                 access: "Allow",
//                 priority: 100,
//                 direction: "Outbound",
//             },
//         ],
//     });

//     // Create a Managed Identity for VM instances (equivalent to IAM role in AWS)
//     const managedIdentity = new identity.UserAssignedIdentity("vm-identity", {
//         resourceGroupName: baseInfra.resourceGroupName,
//         resourceName: "vm-identity",
//     });

//     // Create a Key Vault (equivalent to AWS Secrets Manager)
//     const keyVault = new keyvault.Vault("app-keyvault", {
//         resourceGroupName: baseInfra.resourceGroupName,
//         vaultName: pulumi.interpolate`app-keyvault-${pulumi.getStack()}`,
//         properties: {
//             enabledForDeployment: true,
//             enabledForDiskEncryption: true,
//             enabledForTemplateDeployment: true,
//             tenantId: "00000000-0000-0000-0000-000000000000", // You need to replace this with your actual tenant ID
//             sku: {
//                 family: "A",
//                 name: "standard",
//             },
//             networkAcls: {
//                 bypass: "AzureServices",
//                 defaultAction: "Deny",
//                 ipRules: [],
//                 virtualNetworkRules: [],
//             },
//             accessPolicies: [
//                 {
//                     tenantId: "00000000-0000-0000-0000-000000000000", // Replace with your tenant ID
//                     objectId: managedIdentity.principalId,
//                     permissions: {
//                         keys: ["Get", "List"],
//                         secrets: ["Get", "List", "Set"],
//                         certificates: ["Get", "List"],
//                     },
//                 },
//             ],
//         },
//     });

//     // Add a secret to the Key Vault (equivalent to the AWS secret)
//     const secret = new keyvault.Secret("test-secret", {
//         resourceGroupName: baseInfra.resourceGroupName,
//         vaultName: keyVault.name,
//         secretName: "TEST-KEY",
//         properties: {
//             value: "hello",
//         },
//     });

//     // Grant the VM Managed Identity access to Azure resources like Key Vault
//     // Note: In a real implementation, you'd need to get the actual subscription ID
//     const subscriptionId = "00000000-0000-0000-0000-000000000000"; // Replace with your subscription ID
    
//     // Assign the VM Identity to the VM Contributor role
//     // This is a placeholder - in a real implementation you'd create a custom role with minimal permissions
//     new authorization.RoleAssignment("vm-contributor-role", {
//         principalId: managedIdentity.principalId,
//         principalType: "ServicePrincipal",
//         roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/9980e02c-c2be-4d73-94e8-173b1dc7cf3c`, // VM Contributor role
//         scope: pulumi.interpolate`/subscriptions/${subscriptionId}/resourceGroups/${baseInfra.resourceGroupName}`,
//     });

//     return {
//         webNsgId: webNsg.id,
//         appNsgId: appNsg.id,
//         keyVaultId: keyVault.id,
//         keyVaultUri: keyVault.properties.vaultUri,
//         managedIdentityId: managedIdentity.id,
//         managedIdentityPrincipalId: managedIdentity.principalId,
//     };
// }