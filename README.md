# pulumi-multicloud --- README NOT UPDATED --- WIP
Pulumi IaC for deploying multi-cloud resources using Pulumi and TypeScript.

pulumi config set cloudProvider aws
pulumi config set availabilityZone us-east-1a

Quick Recap of Step 1
You successfully deployed:

VPC: main-vpc (CIDR: 10.0.0.0/16).
Public Subnet: public-subnet (CIDR: 10.0.1.0/24, us-east-1a).
Private Subnet: private-subnet (CIDR: 10.0.2.0/24, us-east-1a).
Internet Gateway: main-igw.
Route Table: public-route-table with association to the public subnet.


2. Secrets Manager Conflict
Error Message:
text
Wrap
Copy
InvalidRequestException: You can't create this secret because a secret with this name is already scheduled for deletion.
Affected Resource: app-secret.
Cause:
A previous pulumi destroy or failed deployment marked app-secrets for deletion, but AWS Secrets Manager has a 7-30 day deletion delay (default 30 days). Until it’s fully deleted, you can’t recreate it with the same name.
Fix:
Either wait for deletion (not practical now), recover the secret (if needed), or use a new secret name (e.g., app-secrets-v2).

If you don’t need app-secrets-v2 and want to reuse the name
aws secretsmanager delete-secret --secret-id app-secrets-v2 --region us-east-1 --force-delete-without-recovery