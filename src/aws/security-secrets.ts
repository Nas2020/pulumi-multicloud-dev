///src/aws/security-secrets.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { BaseInfraOutputs } from "./base-infra";

export interface SecuritySecretsOutputs {
    nginxSecurityGroupId: pulumi.Output<string>;
    controllerSecurityGroupId: pulumi.Output<string>;
    tractionSecurityGroupId: pulumi.Output<string>;
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
            },
            {
                protocol: "tcp",
                fromPort: 8032,
                toPort: 8032,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Tenant Proxy direct access (for frontend hardcoded port)"
            },
            {
                protocol: "tcp",
                fromPort: 3008,
                toPort: 3008,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Cape Fear Controller direct access"
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
    const controllerSecurityGroup = new aws.ec2.SecurityGroup("controller-sg", {
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
            },
            {
                protocol: "tcp",
                fromPort: 3008,
                toPort: 3008,
                securityGroups: [nginxSecurityGroup.id],
                description: "Allow HTTP from nginx"
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

    const tractionSecurityGroup = new aws.ec2.SecurityGroup("traction-sg", {
        vpcId: baseInfra.vpcId,
        description: "Security group for traction instance",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 5101,
                toPort: 5101,
                securityGroups: [nginxSecurityGroup.id],
                description: "Tenant UI from NGINX"
            },
            {
                protocol: "tcp",
                fromPort: 8030,
                toPort: 8031,
                securityGroups: [nginxSecurityGroup.id],
                description: "Traction Agent Ports from NGINX"
            },
            {
                protocol: "tcp",
                fromPort: 8032,
                toPort: 8032,
                securityGroups: [nginxSecurityGroup.id],
                description: "Tenant Proxy"
            },
            {
                protocol: "tcp",
                fromPort: 9030,
                toPort: 9033,
                securityGroups: [nginxSecurityGroup.id],
                description: "Endorser Agents"
            },
            {
                protocol: "tcp",
                fromPort: 1080,
                toPort: 1080,
                securityGroups: [nginxSecurityGroup.id],
                description: "MailDev UI (if needed)"
            },
            {
                protocol: "tcp",
                fromPort: 1025,
                toPort: 1025,
                securityGroups: [nginxSecurityGroup.id],
                description: "MailDev SMTP (if needed)"
            },
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
        tags: { Name: "traction-sg" }
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

    // Add S3 access policy for the EC2 instances
    const s3Policy = new aws.iam.Policy("s3-access-policy", {
        description: "Allow EC2 instances to access S3 buckets",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "s3:GetObject",
                        "s3:ListBucket"
                    ],
                    Resource: [
                        "arn:aws:s3:::*",
                        "arn:aws:s3:::*/*"
                    ]
                }
            ]
        })
    });

    const s3PolicyAttachment = new aws.iam.RolePolicyAttachment("s3-policy", {
        role: role.name,
        policyArn: s3Policy.arn,
    });

    const instanceProfile = new aws.iam.InstanceProfile("ec2-profile", {
        role: role.name,
        tags: { Name: "ec2-profile" },
    });

    return {
        nginxSecurityGroupId: nginxSecurityGroup.id,
        controllerSecurityGroupId: controllerSecurityGroup.id,
        tractionSecurityGroupId: tractionSecurityGroup.id,
        instanceProfileName: instanceProfile.name,
    };
}