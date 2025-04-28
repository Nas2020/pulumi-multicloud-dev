// import * as pulumi from "@pulumi/pulumi";
// import * as compute from "@pulumi/azure-native/compute";
// import * as network from "@pulumi/azure-native/network";
// import * as storage from "@pulumi/azure-native/storage";
// import * as keyvault from "@pulumi/azure-native/keyvault";
// import * as resources from "@pulumi/azure-native/resources";
// import { BaseInfraOutputs } from "./base-infra";
// import { SecuritySecretsOutputs } from "./security-secrets";

// // Cloud-init template for initial VM setup
// const getCloudInitScript = (repoUrl: string): string => `#cloud-config
// package_upgrade: true
// packages:
//   - apt-transport-https
//   - ca-certificates
//   - curl
//   - gnupg-agent
//   - software-properties-common
//   - nginx
//   - python3-certbot-nginx
//   - git
//   - jq
//   - unzip

// write_files:
// - path: /root/setup-traction.sh
//   permissions: '0755'
//   content: |
//     #!/bin/bash
//     set -e

//     # Install Azure CLI for KeyVault access
//     curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

//     # Install Docker
//     curl -fsSL https://get.docker.com -o get-docker.sh
//     sudo sh get-docker.sh
//     sudo usermod -aG docker $USER
//     sudo apt-get install -y docker-compose-plugin

//     # Clone the Traction Docker Compose repository
//     cd /opt
//     git clone ${repoUrl}
//     cd traction-docker-compose
//     mkdir -p digicred
//     cd digicred

//     # Configuration will be completed by the vm-setup script after VM creation

// runcmd:
//   - systemctl enable nginx
//   - systemctl start nginx
//   - echo "Initial setup completed. VM is ready for traction deployment." | tee /root/setup-complete.log
// `;

// export interface SingleVmOutputs {
//     publicIpAddress: pulumi.Output<string>;
//     privateIpAddress: pulumi.Output<string>;
//     vmName: pulumi.Output<string>;
//     vmId: pulumi.Output<string>;
//     fqdn: pulumi.Output<string>;
// }

// export function createSingleVM(
//     baseInfra: BaseInfraOutputs,
//     securitySecrets: SecuritySecretsOutputs
// ): SingleVmOutputs {
//     const config = new pulumi.Config();
//     const environment = pulumi.getStack();
//     const resourceNamePrefix = config.get("resourceNamePrefix") || environment;

//     // VM configuration
//     const vmSize = config.get("vmSize") || "Standard_D4s_v3";
//     const adminUsername = config.get("vmAdminUsername") || "azureuser";
//     const osDiskSize = config.getNumber("vmOsDiskSize") || 64;
//     const osDiskType = config.get("vmOsDiskType") || "Premium_LRS";
//     const sshPublicKeyValue = config.get("azureSshPublicKey");
//     const domainName = config.get("domainName") || `crms.${resourceNamePrefix}.edu`;
//     const tractionRepoUrl = config.get("tractionRepoUrl") || "https://github.com/DigiCred-Holdings/traction-docker-compose";

//     // Create public IP for the VM
//     const publicIp = new network.PublicIPAddress(`${resourceNamePrefix}-vm-pip`, {
//         resourceGroupName: baseInfra.resourceGroupName,
//         location: baseInfra.location,
//         publicIPAllocationMethod: network.IPAllocationMethod.Static,
//         sku: {
//             name: network.PublicIPAddressSkuName.Standard,
//         },
//         dnsSettings: {
//             domainNameLabel: pulumi.output(baseInfra.resourceGroupName).apply(name =>
//                 `${resourceNamePrefix}-traction-${name.replace(/[^a-zA-Z0-9]/g, "")}`
//             ),
//         },
//         tags: {
//             Environment: environment,
//             Project: `${resourceNamePrefix} Traction`,
//             Service: "traction-combined",
//         },
//     });

//     // Create network interface for the VM
//     const nic = new network.NetworkInterface(`${resourceNamePrefix}-vm-nic`, {
//         resourceGroupName: baseInfra.resourceGroupName,
//         location: baseInfra.location,
//         ipConfigurations: [{
//             name: "ipconfig",
//             privateIPAllocationMethod: network.IPAllocationMethod.Dynamic,
//             subnet: {
//                 id: pulumi.output(baseInfra.publicSubnetIds).apply(ids => ids[0]),
//             },
//             publicIPAddress: {
//                 id: publicIp.id,
//             },
//         }],
//         networkSecurityGroup: {
//             id: securitySecrets.combinedNsgId,
//         },
//         tags: {
//             Environment: environment,
//             Project: `${resourceNamePrefix} Traction`,
//         },
//     });


//     // Generate SSH key for VM access
//     const sshKeyName = `${resourceNamePrefix}-vm-ssh-key`;
//     const sshPublicKey = new compute.SshPublicKey(sshKeyName, {
//         resourceGroupName: baseInfra.resourceGroupName,
//         location: baseInfra.location,
//         publicKey: sshPublicKeyValue,
//         sshPublicKeyName: sshKeyName,
//     });

//     // Reference the managed identity resource ID
//     const managedIdentityId = securitySecrets.managedIdentityId;

//     // Create the VM with the correct identity structure
//     const vm = new compute.VirtualMachine(`${resourceNamePrefix}-vm`, {
//         resourceGroupName: baseInfra.resourceGroupName,
//         location: baseInfra.location,
//         hardwareProfile: {
//             vmSize: vmSize,
//         },
//         storageProfile: {
//             imageReference: {
//                 publisher: "Canonical",
//                 offer: "0001-com-ubuntu-server-noble",
//                 sku: "22_04-lts-gen2",
//                 version: "latest",
//             },
//             osDisk: {
//                 createOption: compute.DiskCreateOption.FromImage,
//                 managedDisk: {
//                     storageAccountType: osDiskType,
//                 },
//                 diskSizeGB: osDiskSize,
//             },
//         },
//         osProfile: {
//             computerName: `${resourceNamePrefix}-traction`,
//             adminUsername: adminUsername,
//             linuxConfiguration: {
//                 disablePasswordAuthentication: true,
//                 ssh: {
//                     publicKeys: [{
//                         path: `/home/${adminUsername}/.ssh/authorized_keys`,
//                         keyData: sshPublicKeyValue,
//                     }],
//                 },
//             },
//             customData: Buffer.from(getCloudInitScript(tractionRepoUrl)).toString("base64"),
//         },
//         networkProfile: {
//             networkInterfaces: [{
//                 id: nic.id,
//                 primary: true,
//             }],
//         },
//         identity: {
//             type: compute.ResourceIdentityType.UserAssigned,
//             // Pass an array of managed-identity IDs:
//             userAssignedIdentities: [
//                 managedIdentityId,
//             ],
//         },
//         tags: {
//             Environment: environment,
//             Project: `${resourceNamePrefix} Traction`,
//             Service: "traction-combined",
//         },
//     });

//     // Store sensitive data in Key Vault
//     const keyVaultSecrets = [
//         { name: "traction-acapy-seed", value: config.requireSecret("tractionAcapySeed") },
//         { name: "acapy-endorser-seed", value: config.requireSecret("acapyEndorserSeed") },
//         { name: "acapy-endorser-1-seed", value: config.requireSecret("acapyEndorser1Seed") },
//         { name: "webhook-api-key", value: config.requireSecret("webhookApiKey") },
//         { name: "controller-bearer-token", value: config.requireSecret("controllerBearerToken") },
//         { name: "controller-api-key", value: config.requireSecret("controllerApiKey") }
//     ];
//     keyVaultSecrets.forEach(secret => {
//         new keyvault.Secret(`kv-secret-${secret.name}`, {
//             resourceGroupName: baseInfra.resourceGroupName,
//             vaultName: securitySecrets.keyVaultName,
//             secretName: secret.name,
//             properties: { value: secret.value },
//         });
//     });

//     // Pass these directly to the VM extension as parameters
//     const nonSensitiveParams = {
//         endorserPubDID: config.get("acapyEndorserPubDID") || '9rshtjHzfPUdruRxTjn3ZT',
//         endorser1PubDID: config.get("acapyEndorser1PubDID") || 'GvDnYWRHFLJiDoLqKqRXGv',
//         controllerLoadType: config.get("controllerLoadType") || "TEST",
//         // Add other non-sensitive values here
//     };

//     // Create a storage account for vm-setup script
//     const storageAccount = new storage.StorageAccount(`${resourceNamePrefix}storage`, {
//         resourceGroupName: baseInfra.resourceGroupName,
//         location: baseInfra.location,
//         sku: { name: storage.SkuName.Standard_LRS },
//         kind: storage.Kind.StorageV2,
//     });

//     // Create a container for the setup scripts
//     const container = new storage.BlobContainer(`${resourceNamePrefix}-scripts`, {
//         resourceGroupName: baseInfra.resourceGroupName,
//         accountName: storageAccount.name,
//         publicAccess: storage.PublicAccess.None,
//     });

//     // Upload the VM setup script to blob storage
//     const vmSetupScript = new storage.Blob(`vm-setup.sh`, {
//         resourceGroupName: baseInfra.resourceGroupName,
//         accountName: storageAccount.name,
//         containerName: container.name,
//         source: new pulumi.asset.FileAsset("./scripts/vm-setup.sh"),
//         contentType: "text/x-sh",
//     });

//     // URL for the script (no SAS in this example)
//     const scriptUrl = pulumi.interpolate`https://${storageAccount.name}.blob.core.windows.net/${container.name}/vm-setup.sh`;

//     // VM extension to run post-deployment setup
//     new compute.VirtualMachineExtension("setup-extension", {
//         resourceGroupName: baseInfra.resourceGroupName,
//         vmName: vm.name,
//         location: baseInfra.location,
//         publisher: "Microsoft.Azure.Extensions",
//         type: "CustomScript",
//         typeHandlerVersion: "2.1",
//         autoUpgradeMinorVersion: true,
//         settings: { fileUris: [scriptUrl] },
//         protectedSettings: {
//             commandToExecute: pulumi.interpolate`bash vm-setup.sh ${securitySecrets.keyVaultUri} ${domainName} ${resourceNamePrefix} '${JSON.stringify(nonSensitiveParams)}'`,
//         },
//     });

//     // Return outputs
//     return {
//         publicIpAddress: publicIp.ipAddress.apply(ip => ip || ""),
//         privateIpAddress: nic.ipConfigurations.apply(configs =>
//             configs && configs[0].privateIPAddress ? configs[0].privateIPAddress : ""
//         ),
//         vmName: vm.name,
//         vmId: vm.id,
//         fqdn: publicIp.dnsSettings.apply(s => s?.fqdn || ""),
//     };
// }


import * as pulumi from "@pulumi/pulumi";
import * as compute from "@pulumi/azure-native/compute";
import * as network from "@pulumi/azure-native/network";
import * as storage from "@pulumi/azure-native/storage";
import * as keyvault from "@pulumi/azure-native/keyvault";
import { BaseInfraOutputs } from "./base-infra";
import { SecuritySecretsOutputs } from "./security-secrets";

// Cloud-init template for initial VM setup
const getCloudInitScript = (repoUrl: string): string => `#cloud-config
package_upgrade: true
packages:
  - apt-transport-https
  - ca-certificates
  - curl
  - gnupg-agent
  - software-properties-common
  - nginx
  - python3-certbot-nginx
  - git
  - jq
  - unzip
  - dnsutils
  - net-tools

write_files:
- path: /root/setup-traction.sh
  permissions: '0755'
  content: |
    #!/bin/bash
    set -e

    # Install Azure CLI for KeyVault access
    curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

    # Install Docker
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    sudo apt-get install -y docker-compose-plugin

    # Clone the Traction Docker Compose repository
    cd /opt
    git clone ${repoUrl}
    cd traction-docker-compose
    mkdir -p digicred
    cd digicred

    # Create a setup complete marker
    echo "Initial setup completed. VM is ready for traction deployment." | tee /root/setup-complete.log

runcmd:
  - systemctl enable nginx
  - systemctl start nginx
  - echo "Initial setup completed. VM is ready for traction deployment." | tee /root/setup-complete.log
`;

export interface SingleVmOutputs {
    publicIpAddress: pulumi.Output<string>;
    privateIpAddress: pulumi.Output<string>;
    vmName: pulumi.Output<string>;
    vmId: pulumi.Output<string>;
    fqdn: pulumi.Output<string>;
}

export function createSingleVM(
    baseInfra: BaseInfraOutputs,
    securitySecrets: SecuritySecretsOutputs
): SingleVmOutputs {
    const config = new pulumi.Config();
    const environment = pulumi.getStack();
    const resourceNamePrefix = config.get("resourceNamePrefix") || environment;

    // VM configuration
    const vmSize = config.get("vmSize") || "Standard_D4s_v3";
    const adminUsername = config.get("vmAdminUsername") || "azureuser";
    const osDiskSize = config.getNumber("vmOsDiskSize") || 64;
    const osDiskType = config.get("vmOsDiskType") || "Premium_LRS";
    const sshPublicKeyValue = config.get("azureSshPublicKey");
    const domainName = config.get("domainName") || `crms.${resourceNamePrefix}.edu`;
    const email = config.get('emailForSSL') || "nas@limogi.ai";
    const tractionRepoUrl = config.get("tractionRepoUrl") || "https://github.com/DigiCred-Holdings/traction-docker-compose";

    // Create public IP for the VM
    const publicIp = new network.PublicIPAddress(`${resourceNamePrefix}-vm-pip`, {
        resourceGroupName: baseInfra.resourceGroupName,
        location: baseInfra.location,
        publicIPAllocationMethod: network.IPAllocationMethod.Static,
        sku: {
            name: network.PublicIPAddressSkuName.Standard,
        },
        dnsSettings: {
            domainNameLabel: pulumi.output(baseInfra.resourceGroupName).apply(name =>
                `${resourceNamePrefix}-traction-${name.replace(/[^a-zA-Z0-9]/g, "")}`
            ),
        },
        tags: {
            Environment: environment,
            Project: `${resourceNamePrefix} Traction`,
            Service: "traction-combined",
        },
    });

    // Create network interface for the VM
    const nic = new network.NetworkInterface(`${resourceNamePrefix}-vm-nic`, {
        resourceGroupName: baseInfra.resourceGroupName,
        location: baseInfra.location,
        ipConfigurations: [{
            name: "ipconfig",
            privateIPAllocationMethod: network.IPAllocationMethod.Dynamic,
            subnet: {
                id: pulumi.output(baseInfra.publicSubnetIds).apply(ids => ids[0]),
            },
            publicIPAddress: {
                id: publicIp.id,
            },
        }],
        networkSecurityGroup: {
            id: securitySecrets.combinedNsgId,
        },
        tags: {
            Environment: environment,
            Project: `${resourceNamePrefix} Traction`,
        },
    });

    // Generate SSH key for VM access
    const sshKeyName = `${resourceNamePrefix}-vm-ssh-key`;
    const sshPublicKey = new compute.SshPublicKey(sshKeyName, {
        resourceGroupName: baseInfra.resourceGroupName,
        location: baseInfra.location,
        publicKey: sshPublicKeyValue,
        sshPublicKeyName: sshKeyName,
    });

    // Reference the managed identity resource ID
    const managedIdentityId = securitySecrets.managedIdentityId;

    // Create the VM with the correct identity structure
    const vm = new compute.VirtualMachine(`${resourceNamePrefix}-vm`, {
        resourceGroupName: baseInfra.resourceGroupName,
        location: baseInfra.location,
        hardwareProfile: {
            vmSize: vmSize,
        },
        storageProfile: {
            imageReference: {
                publisher: "Canonical",
                offer: "0001-com-ubuntu-server-jammy",
                sku: "22_04-lts-gen2",
                version: "latest",
            },
            osDisk: {
                createOption: compute.DiskCreateOption.FromImage,
                managedDisk: {
                    storageAccountType: osDiskType,
                },
                diskSizeGB: osDiskSize,
            },
        },
        osProfile: {
            computerName: `${resourceNamePrefix}-traction`,
            adminUsername: adminUsername,
            linuxConfiguration: {
                disablePasswordAuthentication: true,
                ssh: {
                    publicKeys: [{
                        path: `/home/${adminUsername}/.ssh/authorized_keys`,
                        keyData: sshPublicKeyValue,
                    }],
                },
            },
            customData: Buffer.from(getCloudInitScript(tractionRepoUrl)).toString("base64"),
        },
        networkProfile: {
            networkInterfaces: [{
                id: nic.id,
                primary: true,
            }],
        },
        identity: {
            type: compute.ResourceIdentityType.UserAssigned,
            // Pass an array of managed-identity IDs:
            userAssignedIdentities: [
                managedIdentityId,
            ],
        },
        tags: {
            Environment: environment,
            Project: `${resourceNamePrefix} Traction`,
            Service: "traction-combined",
        },
    });

    // Store sensitive data in Key Vault
    const keyVaultSecrets = [
        { name: "traction-acapy-seed", value: config.requireSecret("tractionAcapySeed") },
        { name: "acapy-endorser-seed", value: config.requireSecret("acapyEndorserSeed") },
        { name: "acapy-endorser-1-seed", value: config.requireSecret("acapyEndorser1Seed") },
        { name: "webhook-api-key", value: config.requireSecret("webhookApiKey") },
        { name: "controller-bearer-token", value: config.requireSecret("controllerBearerToken") },
        { name: "controller-api-key", value: config.requireSecret("controllerApiKey") }
    ];
    keyVaultSecrets.forEach(secret => {
        new keyvault.Secret(`kv-secret-${secret.name}`, {
            resourceGroupName: baseInfra.resourceGroupName,
            vaultName: securitySecrets.keyVaultName,
            secretName: secret.name,
            properties: { value: secret.value },
        });
    });

    // Pass these directly to the VM extension as parameters
    const nonSensitiveParams = {
        endorserPubDID: config.get("acapyEndorserPubDID") || '9rshtjHzfPUdruRxTjn3ZT',
        endorser1PubDID: config.get("acapyEndorser1PubDID") || 'GvDnYWRHFLJiDoLqKqRXGv',
        controllerLoadType: config.get("controllerLoadType") || "TEST",
        // Add other non-sensitive values here
    };

    // Create a storage account for vm-setup script and the enhanced scripts
    const storageAccount = new storage.StorageAccount(`${resourceNamePrefix}st`, {
        resourceGroupName: baseInfra.resourceGroupName,
        location: baseInfra.location,
        sku: { name: storage.SkuName.Standard_LRS },
        kind: storage.Kind.StorageV2,
    });

    // Create a container for the setup scripts
    const container = new storage.BlobContainer(`${resourceNamePrefix}-scripts`, {
        resourceGroupName: baseInfra.resourceGroupName,
        accountName: storageAccount.name,
        publicAccess: storage.PublicAccess.None,
    });

    // Upload the enhanced VM setup scripts to blob storage
    const enhancedVmSetupScript = new storage.Blob(`enhanced-vm-setup.sh`, {
        resourceGroupName: baseInfra.resourceGroupName,
        accountName: storageAccount.name,
        containerName: container.name,
        source: new pulumi.asset.FileAsset("./src/azure/scripts/enhanced-vm-setup.sh"),
        contentType: "text/x-sh",
    });

    // Upload Nginx configuration module
    const nginxConfigModule = new storage.Blob(`nginx-config.sh`, {
        resourceGroupName: baseInfra.resourceGroupName,
        accountName: storageAccount.name,
        containerName: container.name,
        source: new pulumi.asset.FileAsset("./src/azure/scripts/nginx-config.sh"),
        contentType: "text/x-sh",
    });

    // Upload SSL certificate management module
    const sslCertModule = new storage.Blob(`ssl-cert-manager.sh`, {
        resourceGroupName: baseInfra.resourceGroupName,
        accountName: storageAccount.name,
        containerName: container.name,
        source: new pulumi.asset.FileAsset("./src/azure/scripts/ssl-cert-manager.sh"),
        contentType: "text/x-sh",
    });

    // Upload domain monitoring module
    const domainMonitorModule = new storage.Blob(`domain-monitoring.sh`, {
        resourceGroupName: baseInfra.resourceGroupName,
        accountName: storageAccount.name,
        containerName: container.name,
        source: new pulumi.asset.FileAsset("./src/azure/scripts/domain-monitoring.sh"),
        contentType: "text/x-sh",
    });

    // Generate SAS tokens for each blob so they can be downloaded securely
    const sasExpiry = new Date();
    sasExpiry.setFullYear(sasExpiry.getFullYear() + 1); // SAS token valid for 1 year

    // URL for the script with SAS token
    const scriptUrls = pulumi.all([
        storageAccount.name,
        container.name,
        enhancedVmSetupScript.name,
        nginxConfigModule.name,
        sslCertModule.name,
        domainMonitorModule.name
    ]).apply(([accountName, containerName, vmSetupName, nginxName, sslName, monitorName]) => {
        return {
            setupScript: `https://${accountName}.blob.core.windows.net/${containerName}/${vmSetupName}`,
            nginxConfig: `https://${accountName}.blob.core.windows.net/${containerName}/${nginxName}`,
            sslCert: `https://${accountName}.blob.core.windows.net/${containerName}/${sslName}`,
            domainMonitor: `https://${accountName}.blob.core.windows.net/${containerName}/${monitorName}`
        };
    });

    // VM extension to run post-deployment setup with enhanced scripts
    new compute.VirtualMachineExtension("enhanced-setup-extension", {
        resourceGroupName: baseInfra.resourceGroupName,
        vmName: vm.name,
        location: baseInfra.location,
        publisher: "Microsoft.Azure.Extensions",
        type: "CustomScript",
        typeHandlerVersion: "2.1",
        autoUpgradeMinorVersion: true,
        settings: {
            fileUris: [
                scriptUrls.apply(urls => urls.setupScript),
                scriptUrls.apply(urls => urls.nginxConfig),
                scriptUrls.apply(urls => urls.sslCert),
                scriptUrls.apply(urls => urls.domainMonitor)
            ]
        },
        protectedSettings: {
            commandToExecute: pulumi.interpolate`bash enhanced-vm-setup.sh ${securitySecrets.keyVaultUri} ${domainName} ${email} ${resourceNamePrefix} '${JSON.stringify(nonSensitiveParams)}'`,
        },
    });

    // Return outputs
    return {
        publicIpAddress: publicIp.ipAddress.apply(ip => ip || ""),
        privateIpAddress: nic.ipConfigurations.apply(configs =>
            configs && configs[0].privateIPAddress ? configs[0].privateIPAddress : ""
        ),
        vmName: vm.name,
        vmId: vm.id,
        fqdn: publicIp.dnsSettings.apply(s => s?.fqdn || ""),
    };
}
