// import * as pulumi from "@pulumi/pulumi";
// import * as azure from "@pulumi/azure-native";
// import * as compute from "@pulumi/azure-native/compute";
// import * as network from "@pulumi/azure-native/network";
// import { BaseInfraOutputs } from "./base-infra";
// import { SecuritySecretsOutputs } from "./security-secrets";

// export interface VmInstancesOutputs {
//     webVmIds: pulumi.Output<string[]>;
//     appVmIds: pulumi.Output<string[]>;
//     webVmPublicIps: pulumi.Output<string[]>;
// }

// export function createVmInstances(
//     baseInfra: BaseInfraOutputs,
//     securitySecrets: SecuritySecretsOutputs
// ): VmInstancesOutputs {
//     const config = new pulumi.Config();
//     const vmSize = config.get("azureVmSize") || "Standard_B2s";
//     const adminUsername = config.get("azureAdminUsername") || "azureuser";
//     const sshPublicKey = config.require("azureSshPublicKey"); // You must provide an SSH public key

//     // Create public IPs for web VMs
//     const webPublicIps = baseInfra.publicSubnetIds.apply(subnetIds => {
//         return subnetIds.map((subnetId, i) => {
//             return new network.PublicIPAddress(`web-vm-pip-${i}`, {
//                 resourceGroupName: baseInfra.resourceGroupName,
//                 publicIPAllocationMethod: network.IPAllocationMethod.Dynamic,
//                 publicIPAddressName: `web-vm-pip-${i}`,
//             });
//         });
//     });

//     // Create network interfaces for web VMs
//     const webNics = baseInfra.publicSubnetIds.apply(subnetIds => {
//         return subnetIds.map((subnetId, i) => {
//             return new network.NetworkInterface(`web-vm-nic-${i}`, {
//                 resourceGroupName: baseInfra.resourceGroupName,
//                 networkInterfaceName: `web-vm-nic-${i}`,
//                 ipConfigurations: [{
//                     name: "ipconfig",
//                     subnet: {
//                         id: subnetId,
//                     },
//                     publicIPAddress: {
//                         id: webPublicIps[i].id,
//                     },
//                 }],
//                 networkSecurityGroup: {
//                     id: securitySecrets.webNsgId,
//                 },
//             });
//         });
//     });

//     // Create web VMs (nginx equivalent)
//     const webVms = webNics.apply(nics => {
//         return nics.map((nic, i) => {
//             return new compute.VirtualMachine(`web-vm-${i}`, {
//                 resourceGroupName: baseInfra.resourceGroupName,
//                 vmName: `web-vm-${i}`,
//                 location: nic.location,
//                 hardwareProfile: {
//                     vmSize: vmSize,
//                 },
//                 osProfile: {
//                     computerName: `web-vm-${i}`,
//                     adminUsername: adminUsername,
//                     linuxConfiguration: {
//                         disablePasswordAuthentication: true,
//                         ssh: {
//                             publicKeys: [{
//                                 path: `/home/${adminUsername}/.ssh/authorized_keys`,
//                                 keyData: sshPublicKey,
//                             }],
//                         },
//                     },
//                 },
//                 networkProfile: {
//                     networkInterfaces: [{
//                         id: nic.id,
//                         primary: true,
//                     }],
//                 },
//                 storageProfile: {
//                     imageReference: {
//                         publisher: "Canonical",
//                         offer: "UbuntuServer",
//                         sku: "18.04-LTS",
//                         version: "latest",
//                     },
//                     osDisk: {
//                         name: `web-vm-osdisk-${i}`,
//                         caching: "ReadWrite",
//                         createOption: "FromImage",
//                         managedDisk: {
//                             storageAccountType: "Standard_LRS",
//                         },
//                     },
//                 },
//                 identity: {
//                     type: "UserAssigned",
//                     userAssignedIdentities: {
//                         [securitySecrets.managedIdentityId.apply(id => id)]: {},
//                     },
//                 },
//             });
//         });
//     });

//     // Create network interfaces for app VMs
//     const appNics = baseInfra.privateSubnetIds.apply(subnetIds => {
//         return subnetIds.map((subnetId, i) => {
//             return new network.NetworkInterface(`app-vm-nic-${i}`, {
//                 resourceGroupName: baseInfra.resourceGroupName,
//                 networkInterfaceName: `app-vm-nic-${i}`,
//                 ipConfigurations: [{
//                     name: "ipconfig",
//                     subnet: {
//                         id: subnetId,
//                     },
//                 }],
//                 networkSecurityGroup: {
//                     id: securitySecrets.appNsgId,
//                 },
//             });
//         });
//     });

//     // Create app VMs (application servers)
//     const appVms = appNics.apply(nics => {
//         return nics.map((nic, i) => {
//             return new compute.VirtualMachine(`app-vm-${i}`, {
//                 resourceGroupName: baseInfra.resourceGroupName,
//                 vmName: `app-vm-${i}`,
//                 location: nic.location,
//                 hardwareProfile: {
//                     vmSize: vmSize,
//                 },
//                 osProfile: {
//                     computerName: `app-vm-${i}`,
//                     adminUsername: adminUsername,
//                     linuxConfiguration: {
//                         disablePasswordAuthentication: true,
//                         ssh: {
//                             publicKeys: [{
//                                 path: `/home/${adminUsername}/.ssh/authorized_keys`,
//                                 keyData: sshPublicKey,
//                             }],
//                         },
//                     },
//                 },
//                 networkProfile: {
//                     networkInterfaces: [{
//                         id: nic.id,
//                         primary: true,
//                     }],
//                 },
//                 storageProfile: {
//                     imageReference: {
//                         publisher: "Canonical",
//                         offer: "UbuntuServer",
//                         sku: "18.04-LTS",
//                         version: "latest",
//                     },
//                     osDisk: {
//                         name: `app-vm-osdisk-${i}`,
//                         caching: "ReadWrite",
//                         createOption: "FromImage",
//                         managedDisk: {
//                             storageAccountType: "Standard_LRS",
//                         },
//                     },
//                 },
//                 identity: {
//                     type: "UserAssigned",
//                     userAssignedIdentities: {
//                         [securitySecrets.managedIdentityId.apply(id => id)]: {},
//                     },
//                 },
//             });
//         });
//     });

//     // Get public IPs once they are allocated
//     const webVmPublicIps = webPublicIps.apply(ips => {
//         return pulumi.all(ips.map(ip => ip.ipAddress));
//     });

//     return {
//         webVmIds: webVms.apply(vms => pulumi.all(vms.map(vm => vm.id))),
//         appVmIds: appVms.apply(vms => pulumi.all(vms.map(vm => vm.id))),
//         webVmPublicIps: webVmPublicIps,
//     };
// }