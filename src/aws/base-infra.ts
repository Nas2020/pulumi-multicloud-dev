import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as ip from "ip";

export interface BaseInfraOutputs {
    vpcId: pulumi.Output<string>;
    publicSubnetIds: pulumi.Output<string[]>;
    privateSubnetIds: pulumi.Output<string[]>;
    igwId: pulumi.Output<string>;
    publicRouteTableId: pulumi.Output<string>;
    privateRouteTableIds: pulumi.Output<string[]>;
    natGatewayIds: pulumi.Output<string[]>;
    natGateways: aws.ec2.NatGateway[]; 
}

function validateCidrs(cidrs: string[]): void {
    const ipRegex = /^(\d+\.){3}\d+\/\d+$/;
    cidrs.forEach(cidr => {
        if (!ipRegex.test(cidr)) {
            throw new Error(`Invalid CIDR format: ${cidr}`);
        }
    });

    // First CIDR is the VPC; others are subnets
    const vpcCidr = cidrs[0];
    const subnetCidrs = cidrs.slice(1);

    // Ensure all subnets are contained within the VPC CIDR
    const vpcSubnet = ip.cidrSubnet(vpcCidr);
    subnetCidrs.forEach(subnetCidr => {
        const subnet = ip.cidrSubnet(subnetCidr);
        if (!vpcSubnet.contains(subnet.networkAddress) || !vpcSubnet.contains(subnet.broadcastAddress)) {
            throw new Error(`Subnet CIDR ${subnetCidr} is not fully contained within VPC CIDR ${vpcCidr}`);
        }
    });

    // Check for overlaps among subnets
    for (let i = 0; i < subnetCidrs.length; i++) {
        for (let j = i + 1; j < subnetCidrs.length; j++) {
            const subnetA = ip.cidrSubnet(subnetCidrs[i]);
            const subnetB = ip.cidrSubnet(subnetCidrs[j]);
            if (subnetA.contains(subnetB.networkAddress) || subnetB.contains(subnetA.networkAddress)) {
                throw new Error(`Overlapping subnet CIDRs detected: ${subnetCidrs[i]} and ${subnetCidrs[j]}`);
            }
        }
    }
}

export function createBaseInfra(): BaseInfraOutputs {
    const config = new pulumi.Config();
    const azs = config.getObject<string[]>("awsAvailabilityZones") || ["us-east-1a", "us-east-1b"];
    const vpcCidr = config.get("awsVpcCidr") || "10.0.0.0/16";
    const publicSubnetCidrs = config.getObject<string[]>("awsPublicSubnetCidrs") || ["10.0.1.0/24", "10.0.3.0/24"];
    const privateSubnetCidrs = config.getObject<string[]>("awsPrivateSubnetCidrs") || ["10.0.2.0/24", "10.0.4.0/24"];

    // Validate CIDRs: VPC first, then subnets
    validateCidrs([vpcCidr, ...publicSubnetCidrs, ...privateSubnetCidrs]);
    if (azs.length !== publicSubnetCidrs.length || azs.length !== privateSubnetCidrs.length) {
        throw new Error("Number of availability zones must match number of subnets");
    }

    const vpc = new aws.ec2.Vpc("main-vpc", {
        cidrBlock: vpcCidr,
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: { Name: "main-vpc" },
    });

    const publicSubnets = azs.map((az, i) => new aws.ec2.Subnet(`public-subnet-${i}`, {
        vpcId: vpc.id,
        cidrBlock: publicSubnetCidrs[i],
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
        tags: { Name: `public-subnet-${az}` },
    }));

    const privateSubnets = azs.map((az, i) => new aws.ec2.Subnet(`private-subnet-${i}`, {
        vpcId: vpc.id,
        cidrBlock: privateSubnetCidrs[i],
        availabilityZone: az,
        tags: { Name: `private-subnet-${az}` },
    }));

    const igw = new aws.ec2.InternetGateway("main-igw", {
        vpcId: vpc.id,
        tags: { Name: "main-igw" },
    });

    const publicRouteTable = new aws.ec2.RouteTable("public-route-table", {
        vpcId: vpc.id,
        routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: igw.id }],
        tags: { Name: "public-route-table" },
    });

    publicSubnets.forEach((subnet, i) => {
        new aws.ec2.RouteTableAssociation(`public-rt-assoc-${i}`, {
            subnetId: subnet.id,
            routeTableId: publicRouteTable.id,
        });
    });

    const natGateways: aws.ec2.NatGateway[] = [];
    const natEips: aws.ec2.Eip[] = [];
    
    publicSubnets.forEach((subnet, i) => {
        const eip = new aws.ec2.Eip(`nat-eip-${i}`, { 
            domain: "vpc", 
            tags: { Name: `nat-eip-${i}` } 
        });
        natEips.push(eip);
        
        const nat = new aws.ec2.NatGateway(`nat-gw-${i}`, {
            subnetId: subnet.id,
            allocationId: eip.id,
            tags: { Name: `nat-gw-${i}` },
        });
        natGateways.push(nat);
    });

    const privateRouteTables = privateSubnets.map((subnet, i) => 
        new aws.ec2.RouteTable(`private-route-table-${i}`, {
            vpcId: vpc.id,
            routes: [{
                cidrBlock: "0.0.0.0/0",
                natGatewayId: natGateways[i].id,
            }],
            tags: { Name: `private-route-table-${azs[i]}` },
        })
    );

    privateSubnets.forEach((subnet, i) => {
        new aws.ec2.RouteTableAssociation(`private-rt-assoc-${i}`, {
            subnetId: subnet.id,
            routeTableId: privateRouteTables[i].id,
        });
    });

    return {
        vpcId: vpc.id,
        publicSubnetIds: pulumi.output(publicSubnets.map(s => s.id)),
        privateSubnetIds: pulumi.output(privateSubnets.map(s => s.id)),
        igwId: igw.id,
        publicRouteTableId: publicRouteTable.id,
        privateRouteTableIds: pulumi.output(privateRouteTables.map(rt => rt.id)),
        natGatewayIds: pulumi.output(natGateways.map(n => n.id)),
        natGateways,
    };
}