import * as pulumi from "@pulumi/pulumi";
import * as network from "@pulumi/azure-native/network";
import * as keyvault from "@pulumi/azure-native/keyvault";
import * as authorization from "@pulumi/azure-native/authorization";
import * as identity from "@pulumi/azure-native/managedidentity";
import { BaseInfraOutputs } from "./base-infra";

export interface SecuritySecretsOutputs {
    combinedNsgId: pulumi.Output<string>;
    keyVaultId: pulumi.Output<string>;
    keyVaultUri: pulumi.Output<string>;
    keyVaultName: pulumi.Output<string>;
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
    const keyVaultName = config.get("keyVaultName") || "miami-dade-kv";
    const environment = pulumi.getStack();
    const resourceNamePrefix = config.get("resourceNamePrefix") || environment;
    
    // Create a consolidated Network Security Group for deployment
    // This combines the rules that were previously in separate NSGs
    const combinedNsg = new network.NetworkSecurityGroup(`${resourceNamePrefix}-nsg`, {
        resourceGroupName: baseInfra.resourceGroupName,
        networkSecurityGroupName: `${resourceNamePrefix}-nsg`,
        securityRules: [
            // HTTP and HTTPS access
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
            // SSH access
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
            // Tenant UI
            {
                name: "allow-tenant-ui",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "5101",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 130,
                direction: "Inbound",
            },
            // Traction Agent ports
            {
                name: "allow-traction-agent-ports",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "8030-8031",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 140,
                direction: "Inbound",
            },
            // Tenant Proxy
            {
                name: "allow-tenant-proxy",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "8032",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 150,
                direction: "Inbound",
            },
            // Controller
            {
                name: "allow-controller",
                protocol: "Tcp",
                sourcePortRange: "*",
                destinationPortRange: "3000",
                sourceAddressPrefix: "*",
                destinationAddressPrefix: "*",
                access: "Allow",
                priority: 160,
                direction: "Inbound",
            },
            // Allow all outbound traffic
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
        tags: {
            Environment: pulumi.getStack(),
            Project: "Miami-Dade Traction",
        },
    });

    // Create a Managed Identity for VM instances
    const managedIdentity = new identity.UserAssignedIdentity("vm-identity", {
        resourceGroupName: baseInfra.resourceGroupName,
        resourceName: `${resourceNamePrefix}-vm-identity`,
        tags: {
            Environment: environment,
            Project: `${resourceNamePrefix} Traction`,
        },
    });

    // Create a combined Key Vault for all secrets
    const keyVault = new keyvault.Vault(`${resourceNamePrefix}-secrets`, {
        resourceGroupName: baseInfra.resourceGroupName,
        vaultName: pulumi.interpolate`${keyVaultName}`,
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
            accessPolicies: [],
        },
        tags: {
            Environment: environment,
            Project: `${resourceNamePrefix} Traction`,
            Service: "traction-combined"
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
    new authorization.RoleAssignment("kv-secrets-user-role", {
        principalId: managedIdentity.principalId,
        principalType: "ServicePrincipal",
        roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6`, // Key Vault Secrets User
        scope: keyVault.id,
    });

    // Grant necessary Key Vault roles to the Service Principal that Pulumi is using
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
        combinedNsgId: combinedNsg.id,
        keyVaultId: keyVault.id,
        keyVaultName: keyVault.name,
        keyVaultUri: pulumi.output(keyVault.properties.vaultUri).apply(uri => uri || ""),
        managedIdentityId: managedIdentity.id,
        managedIdentityPrincipalId: managedIdentity.principalId,
    };
}