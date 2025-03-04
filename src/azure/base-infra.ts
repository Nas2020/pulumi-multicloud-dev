import * as pulumi from "@pulumi/pulumi";
import * as network from "@pulumi/azure-native/network";
import * as resources from "@pulumi/azure-native/resources";
import * as cidrTools from "cidr-tools";

export interface BaseInfraOutputs {
    resourceGroupName: pulumi.Output<string>;
    vnetId: pulumi.Output<string>;
    publicSubnetIds: pulumi.Output<string[]>;
    privateSubnetIds: pulumi.Output<string[]>;
    natGatewayIds: pulumi.Output<string[]>;
    publicIpIds: pulumi.Output<string[]>;
    natGateway: network.NatGateway; 
}

function validateCidrs(vnetCidr: string, subnets: string[]): void {
    const ipRegex = /^(\d+\.){3}\d+\/\d+$/;

    [vnetCidr, ...subnets].forEach(cidr => {
        if (!ipRegex.test(cidr)) {
            throw new Error(`Invalid CIDR format: ${cidr}`);
        }
    });

    // Ensure all subnets are inside the VNet CIDR
    subnets.forEach(subnet => {
        if (!cidrTools.containsCidr(vnetCidr, subnet)) {
            throw new Error(`Subnet CIDR ${subnet} is not within VNet CIDR ${vnetCidr}`);
        }
    });

    // Ensure no overlapping subnets
    for (let i = 0; i < subnets.length; i++) {
        for (let j = i + 1; j < subnets.length; j++) {
            if (cidrTools.overlapCidr(subnets[i], subnets[j])) {
                throw new Error(`Overlapping subnets detected: ${subnets[i]} and ${subnets[j]}`);
            }
        }
    }
}

export function createBaseInfra(): BaseInfraOutputs {
    const config = new pulumi.Config();
    const region = config.get("azureRegion") || "eastus"; 
    const vnetCidr = config.get("azureVnetCidr") || "10.1.0.0/16";
    const publicSubnetCidrs = config.getObject<string[]>("azurePublicSubnetCidrs") || ["10.1.1.0/24"];
    const privateSubnetCidrs = config.getObject<string[]>("azurePrivateSubnetCidrs") || ["10.1.2.0/24"];
    const resourceGroupName = config.get("resourceGroupName") || "dg-resource-group"; 

    validateCidrs(vnetCidr, [...publicSubnetCidrs, ...privateSubnetCidrs]);

    const resourceGroup = new resources.ResourceGroup("main-rg", {
        resourceGroupName,
        location: region,
    });

    const vnet = new network.VirtualNetwork("main-vnet", {
        resourceGroupName: resourceGroup.name,
        location: region,
        addressSpace: { addressPrefixes: [vnetCidr] },
        enableDdosProtection: false,
        virtualNetworkName: "main-vnet",
    });

    // Create public subnets
    const publicSubnets = publicSubnetCidrs.map((cidr, i) => new network.Subnet(`public-subnet-${i}`, {
        resourceGroupName: resourceGroup.name,
        virtualNetworkName: vnet.name,
        addressPrefix: cidr,
        subnetName: `public-subnet-${i}`,
    }));

    // Create NAT Gateway with public IP
    const natPublicIp = new network.PublicIPAddress("nat-pip", {
        resourceGroupName: resourceGroup.name,
        location: region,
        publicIpAddressName: "nat-pip",
        publicIPAllocationMethod: network.IPAllocationMethod.Static,
        sku: { name: network.PublicIPAddressSkuName.Standard },
    });

    // Create a single NAT Gateway with the public IP
    const natGateway = new network.NatGateway("nat-gw", {
        resourceGroupName: resourceGroup.name,
        location: region,
        natGatewayName: "nat-gw",
        sku: { name: "Standard" },
        publicIpAddresses: [{ id: natPublicIp.id }],
    });

    // Create private subnets with NAT Gateway association
    const privateSubnets = privateSubnetCidrs.map((cidr, i) => new network.Subnet(`private-subnet-${i}`, {
        resourceGroupName: resourceGroup.name,
        virtualNetworkName: vnet.name,
        addressPrefix: cidr,
        subnetName: `private-subnet-${i}`,
        natGateway: { id: natGateway.id },
    }));

    return {
        resourceGroupName: resourceGroup.name,
        vnetId: vnet.id,
        publicSubnetIds: pulumi.output(publicSubnets.map(s => s.id)),
        privateSubnetIds: pulumi.output(privateSubnets.map(s => s.id)),
        natGatewayIds: pulumi.output([natGateway.id]),
        publicIpIds: pulumi.output([natPublicIp.id]),
        natGateway,
    };
}