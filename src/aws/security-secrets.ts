import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { BaseInfraOutputs } from "./base-infra";

export interface SecuritySecretsOutputs {
    nginxSecurityGroupId: pulumi.Output<string>;
    appSecurityGroupId: pulumi.Output<string>;
    secretArn: pulumi.Output<string>;
    instanceProfileName: pulumi.Output<string>;
}

export function createSecuritySecrets(baseInfra: BaseInfraOutputs): SecuritySecretsOutputs {
    const config = new pulumi.Config();
    const sshCidrBlocks = config.getObject<string[]>("awsSshCidrBlocks") || ["0.0.0.0/0"];
    
    // Create VPC security group for nginx
    const nginxSecurityGroup = new aws.ec2.SecurityGroup("nginx-sg", {
        vpcId: baseInfra.vpcId,
        description: "Security group for nginx instance",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 80,
                toPort: 80,
                cidrBlocks: ["0.0.0.0/0"],
                description: "HTTP inbound"
            },
            {
                protocol: "tcp",
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ["0.0.0.0/0"],
                description: "HTTPS inbound"
            },
            {
                protocol: "tcp",
                fromPort: 22,
                toPort: 22,
                cidrBlocks: sshCidrBlocks,
                description: "SSH inbound"
            }
        ],
        egress: [
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow all outbound traffic"
            }
        ],
        tags: { Name: "nginx-sg" }
    });

    // Create VPC security group for application instances
    const appSecurityGroup = new aws.ec2.SecurityGroup("app-sg", {
        vpcId: baseInfra.vpcId,
        description: "Security group for application instances",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 80,
                toPort: 80,
                securityGroups: [nginxSecurityGroup.id],
                description: "Allow HTTP from nginx"
            },
            {
                protocol: "tcp",
                fromPort: 22,
                toPort: 22,
                securityGroups: [nginxSecurityGroup.id],
                description: "Allow SSH from nginx"
            }
        ],
        egress: [
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow all outbound traffic"
            }
        ],
        tags: { Name: "app-sg" }
    });

    const secret = new aws.secretsmanager.Secret("app-secrets-v2", {
        name: "app-secrets-v2",
        tags: { Name: "app-secrets-v2" },
    });

    const secretVersion = new aws.secretsmanager.SecretVersion("app-secrets-v2-version", {
        secretId: secret.id,
        secretString: JSON.stringify({ TEST_KEY: "hello" }),
    });

    const role = new aws.iam.Role("ec2-role", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Principal: { Service: "ec2.amazonaws.com" },
                    Action: "sts:AssumeRole",
                },
            ],
        }),
        tags: { Name: "ec2-role" },
    });

    const secretsPolicyAttachment = new aws.iam.RolePolicyAttachment("secrets-policy", {
        role: role.name,
        policyArn: "arn:aws:iam::aws:policy/SecretsManagerReadWrite",
    });

    const ssmPolicyAttachment = new aws.iam.RolePolicyAttachment("ssm-policy", {
        role: role.name,
        policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    });

    const instanceProfile = new aws.iam.InstanceProfile("ec2-profile", {
        role: role.name,
        tags: { Name: "ec2-profile" },
    });

    return {
        nginxSecurityGroupId: nginxSecurityGroup.id,
        appSecurityGroupId: appSecurityGroup.id,
        secretArn: secret.arn,
        instanceProfileName: instanceProfile.name,
    };
}