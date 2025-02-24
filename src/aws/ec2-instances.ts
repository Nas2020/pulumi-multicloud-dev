// File: src/aws/ec2-instances.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { BaseInfraOutputs } from "./base-infra";
import { SecuritySecretsOutputs } from "./security-secrets";
import { createAppInstance } from "./instances/app";
import { createNginxInstance } from "./instances/nginx";

export interface Ec2InstancesOutputs {
    nginxPublicIp: pulumi.Output<string>;
    tractionPrivateIp: pulumi.Output<string>;
    controllerPrivateIp: pulumi.Output<string>;
    elasticIp: pulumi.Output<string>;
}

export function createEc2Instances(
    baseInfra: BaseInfraOutputs, 
    securitySecrets: SecuritySecretsOutputs
): Ec2InstancesOutputs {
    const config = new pulumi.Config();

    const eip = new aws.ec2.Eip("nginx-eip", {
        domain: "vpc",
        tags: { Name: "nginx-eip" },
    });

    const tractionInstance = createAppInstance({
        name: "traction-test-instance",
        instanceType: config.get("tractionInstanceType") || "t2.large",
        subnetId: baseInfra.privateSubnetIds.apply(ids => ids[0]),
        securityGroupId: securitySecrets.appSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
    }, { dependsOn: [baseInfra.natGateways[0]] }); // Depend on the first NAT Gateway

    const controllerInstance = createAppInstance({
        name: "controller-test-instance",
        instanceType: config.get("controllerInstanceType") || "t2.medium",
        subnetId: baseInfra.privateSubnetIds.apply(ids => ids[1]),
        securityGroupId: securitySecrets.appSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
    }, { dependsOn: [baseInfra.natGateways[1]] }); // Depend on the second NAT Gateway

    const nginxInstance = createNginxInstance({
        name: "nginx-instance",
        instanceType: config.get("nginxInstanceType") || "t2.micro",
        subnetId: baseInfra.publicSubnetIds.apply(ids => ids[0]),
        securityGroupId: securitySecrets.nginxSecurityGroupId,
        iamInstanceProfile: securitySecrets.instanceProfileName,
        tractionIp: tractionInstance.privateIp,
        controllerIp: controllerInstance.privateIp,
        elasticIpId: eip.id,
        elasticIp: eip.publicIp,
    }, { dependsOn: [tractionInstance, controllerInstance] });

    return {
        nginxPublicIp: eip.publicIp,
        tractionPrivateIp: tractionInstance.privateIp,
        controllerPrivateIp: controllerInstance.privateIp,
        elasticIp: eip.publicIp,
    };
}
// import * as aws from "@pulumi/aws";
// import * as pulumi from "@pulumi/pulumi";
// import { BaseInfraOutputs } from "./base-infra";
// import { SecuritySecretsOutputs } from "./security-secrets";

// export interface Ec2InstancesOutputs {
//     nginxPublicIp: pulumi.Output<string>;
//     tractionPrivateIp: pulumi.Output<string>;
//     controllerPrivateIp: pulumi.Output<string>;
//     elasticIp: pulumi.Output<string>;
// }

// export function createEc2Instances(baseInfra: BaseInfraOutputs, securitySecrets: SecuritySecretsOutputs): Ec2InstancesOutputs {
//     const eip = new aws.ec2.Eip("nginx-eip", {
//         domain: "vpc",
//         tags: { Name: "nginx-eip" },
//     });

//     const tractionInstance = new aws.ec2.Instance("traction-test-instance", {
//         ami: "ami-0f9575d3d509bae0c", // Updated from your CLI check
//         instanceType: "t2.xlarge",
//         subnetId: baseInfra.privateSubnetId,
//         securityGroups: [securitySecrets.appSecurityGroupId],
//         userData: `#!/bin/bash
//             sudo apt update -y
//             sudo apt install -y docker.io
//             sudo systemctl start docker
//             sudo systemctl enable docker
//             sudo usermod -aG docker ubuntu
//             sudo docker run -d -p 80:80 nginxdemos/hello
//         `,
//         iamInstanceProfile: securitySecrets.instanceProfileName,
//         tags: { Name: "traction-test-instance" },
//     });

//     const controllerInstance = new aws.ec2.Instance("controller-test-instance", {
//         ami: "ami-0f9575d3d509bae0c",
//         instanceType: "t2.medium",
//         subnetId: baseInfra.privateSubnetId,
//         securityGroups: [securitySecrets.appSecurityGroupId],
//         userData: `#!/bin/bash
//             sudo apt update -y
//             sudo apt install -y docker.io
//             sudo systemctl start docker
//             sudo systemctl enable docker
//             sudo usermod -aG docker ubuntu
//             sudo docker run -d -p 80:80 nginxdemos/hello
//         `,
//         iamInstanceProfile: securitySecrets.instanceProfileName,
//         tags: { Name: "controller-test-instance" },
//     });

//     const nginxUserData = pulumi.all([eip.publicIp, tractionInstance.privateIp, controllerInstance.privateIp]).apply(([publicIp, tractionIp, controllerIp]) => `#!/bin/bash
//         sudo apt update -y
//         sudo apt install -y nginx certbot python3-certbot-nginx docker.io jq
//         sudo systemctl start docker
//         sudo systemctl enable docker
//         sudo usermod -aG docker ubuntu
//         echo "server {
//             listen 80;
//             server_name aws.limogi.ai;
//             location /traction { proxy_pass http://${tractionIp}:80; }
//             location /controller { proxy_pass http://${controllerIp}:80; }
//         }" > /etc/nginx/sites-available/default
//         sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/
//         sudo systemctl restart nginx
//         # Retry Certbot (will fail until rate limit clears, but HTTP should work)
//         for i in {1..10}; do
//             sudo certbot --nginx -d aws.limogi.ai --non-interactive --agree-tos -m admin@limogi.ai && break
//             echo "Certbot attempt \$i failed, waiting 60s before retry..."
//             sleep 60
//         done
//         sudo systemctl restart nginx
//     `);

//     const nginxInstance = new aws.ec2.Instance("nginx-instance", {
//         ami: "ami-0f9575d3d509bae0c",
//         instanceType: "t2.micro",
//         subnetId: baseInfra.publicSubnetId,
//         securityGroups: [securitySecrets.nginxSecurityGroupId],
//         userData: nginxUserData,
//         iamInstanceProfile: securitySecrets.instanceProfileName,
//         associatePublicIpAddress: false,
//         tags: { Name: "nginx-instance" },
//     });

//     const nginxEipAssoc = new aws.ec2.EipAssociation("nginx-eip-assoc", {
//         instanceId: nginxInstance.id,
//         allocationId: eip.id,
//     });

//     return {
//         nginxPublicIp: nginxInstance.publicIp,
//         tractionPrivateIp: tractionInstance.privateIp,
//         controllerPrivateIp: controllerInstance.privateIp,
//         elasticIp: eip.publicIp,
//     };
// }