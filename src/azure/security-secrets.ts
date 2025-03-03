import * as pulumi from "@pulumi/pulumi";
import * as network from "@pulumi/azure-native/network";
import * as keyvault from "@pulumi/azure-native/keyvault";
import * as authorization from "@pulumi/azure-native/authorization";
import * as identity from "@pulumi/azure-native/managedidentity";
import { BaseInfraOutputs } from "./base-infra";

export interface SecuritySecretsOutputs {
    webNsgId: pulumi.Output<string>;
    appNsgId: pulumi.Output<string>;
    keyVaultId: pulumi.Output<string>;
    keyVaultUri: pulumi.Output<string>;
    managedIdentityId: pulumi.Output<string>;
    managedIdentityPrincipalId: pulumi.Output<string>;
}

export function createSecuritySecrets(baseInfra: BaseInfraOutputs): SecuritySecretsOutputs {
    const config = new pulumi.Config();
    const sshSourceAddressPrefixes = config.getObject<string[]>("azureSshSourceAddressPrefixes") || ["0.0.0.0/0"];
    const subscriptionId = config.get("azureSubscriptionId") || "";
    const tenantId = config.get("azureTenantId") || "";
    // Get the current client's IP address to allow it through the Key Vault firewall
    const currentIp = config.get("azureCurrentIpAddressForKeyVault") || "0.0.0.0/0";

    // Create Network Security Group for web/nginx instances (public facing)
    const webNsg = new network.NetworkSecurityGroup("web-nsg", {
        resourceGroupName: baseInfra.resourceGroupName,
        networkSecurityGroupName: "web-nsg",
        securityRules: [
            {
                name: "allow-http",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "80",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 100,
                direction: "Inbound",
            },
            {
                name: "allow-https",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "443",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 110,
                direction: "Inbound",
            },
            {
                name: "allow-ssh",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "22",
                sourceAddressPrefixes: sshSourceAddressPrefixes,
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 120,
                direction: "Inbound",
            },
            {
                name: "allow-outbound-all",
                protocol: "*",
                sourcePortRange: "*",
                destinationPortRange: "*",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 100,
                direction: "Outbound",
            },
        ],
    });

    // Create Network Security Group for application instances (private)
    const appNsg = new network.NetworkSecurityGroup("app-nsg", {
        resourceGroupName: baseInfra.resourceGroupName,
        networkSecurityGroupName: "app-nsg",
        securityRules: [
            {
                name: "allow-http-from-web",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "80",
                sourceAddressPrefix: "*", // In practice you would limit this to the web subnet CIDR
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 100,
                direction: "Inbound",
            },
            {
                name: "allow-ssh-from-web",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "22",
                sourceAddressPrefix: "*", // In practice you would limit this to the web subnet CIDR
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 110,
                direction: "Inbound",
            },
            {
                name: "allow-outbound-all",
                protocol: "*",
                sourcePortRange: "*",
                destinationPortRange: "*",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 100,
                direction: "Outbound",
            },
        ],
    });

    // Create a Managed Identity for VM instances (equivalent to IAM role in AWS)
    const managedIdentity = new identity.UserAssignedIdentity("vm-identity", {
        resourceGroupName: baseInfra.resourceGroupName,
        resourceName: "vm-identity",
    });

    // Create a Key Vault (equivalent to AWS Secrets Manager)
    const keyVault = new keyvault.Vault("app-keyvault", {
        resourceGroupName: baseInfra.resourceGroupName,
        vaultName: pulumi.interpolate`app-keyvault-${pulumi.getStack()}`,
        properties: {
            enabledForDeployment: true,
            enabledForDiskEncryption: true,
            enabledForTemplateDeployment: true,
            tenantId,
            sku: {
                family: "A",
                name: "standard",
            },
            enableRbacAuthorization: true,
            networkAcls: {
                bypass: "AzureServices",
                defaultAction: "Deny",
                ipRules: [
                    {
                        value: currentIp
                    }
                ],
                virtualNetworkRules: [],
            },
            accessPolicies: [
            ],
        },
    });

    // Add a secret to the Key Vault (equivalent to the AWS secret)
    const secret = new keyvault.Secret("test-secret", {
        resourceGroupName: baseInfra.resourceGroupName,
        vaultName: keyVault.name,
        secretName: "TEST-KEY",
        properties: {
            value: "hello",
        },
    });

    // Assign the VM Identity to the VM Contributor role
    new authorization.RoleAssignment("vm-contributor-role", {
        principalId: managedIdentity.principalId,
        principalType: "ServicePrincipal",
        roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/9980e02c-c2be-4d73-94e8-173b1dc7cf3c`,
        scope: pulumi.interpolate`/subscriptions/${subscriptionId}/resourceGroups/${baseInfra.resourceGroupName}`,
    });

    // Assign Key Vault role to the VM Managed Identity
    // Key Vault Secrets User built-in role allows reading secrets
    new authorization.RoleAssignment("kv-secrets-user-role", {
        principalId: managedIdentity.principalId,
        principalType: "ServicePrincipal",
        roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6`, // Key Vault Secrets User
        scope: keyVault.id,
    });

    // Grant necessary Key Vault roles to the Service Principal that Pulumi is using
    // This needs to be the Object ID of the Service Principal you created earlier
    const pulumiSpObjectId = config.get("azurePulumiServicePrincipalObjectId") || "";
    if (pulumiSpObjectId) {
        // Assign Key Vault Administrator role to the Pulumi Service Principal
        new authorization.RoleAssignment("pulumi-kv-admin-role", {
            principalId: pulumiSpObjectId,
            principalType: "ServicePrincipal",
            roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/00482a5a-887f-4fb3-b363-3b7fe8e74483`, // Key Vault Administrator
            scope: keyVault.id,
        });
        
        // Add Key Vault Secrets Officer role which specifically allows secret deletion
        new authorization.RoleAssignment("pulumi-kv-secrets-officer-role", {
            principalId: pulumiSpObjectId,
            principalType: "ServicePrincipal",
            roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/b86a8fe4-44ce-4948-aee5-eccb2c155cd7`, // Key Vault Secrets Officer
            scope: keyVault.id,
        });
    }

    return {
        webNsgId: webNsg.id,
        appNsgId: appNsg.id,
        keyVaultId: keyVault.id,
        keyVaultUri: pulumi.output(keyVault.properties.vaultUri).apply(uri => uri || ""),
        managedIdentityId: managedIdentity.id,
        managedIdentityPrincipalId: managedIdentity.principalId,
    };
}