import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface ControllerSecretsOutputs {
    secretArn: pulumi.Output<string>;
}

export function createControllerSecrets(): ControllerSecretsOutputs {
    const config = new pulumi.Config();
    const environment = pulumi.getStack();
    
    // Get secret values from config or use defaults
    const ellucianApiKey = config.getSecret("ellucianApiKey") || "7c3f9cd6-c107-4a49-aac1-0c196e993355";
    const bearerToken = config.getSecret("bearerToken") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ3YWxsZXRfaWQiOiI2NGYxZjY2ZC1mMDgzLTQwZjItOGFkMC1iNzJmMTU1ZDVjNGIiLCJpYXQiOjE3NDQ0OTUyMDEsImV4cCI6MTc3NTk0NDgwMX0.kjIfZ5_8WMZbNJlDDairGpFWqk--LSslh56HA-GuYYQ";
    const apiKey = config.getSecret("apiKey") || "e3cb2bdc955447d3bde80baeef01176f"; 
    const redisPassword = config.getSecret("redisPassword") || "super-secret-password";
    const dbPassword = config.getSecret("dbPassword") || "password123";
    
    // Create a secret for sensitive values
    const controllerSecret = new aws.secretsmanager.Secret("controller-secrets", {
        name: `controller-secrets-${environment}`,
        description: "Secrets for Cape Fear ACA-Py Controller configuration",
        tags: {
            Name: `controller-secrets-${environment}`,
            Environment: environment,
            Service: "cape-fear-controller"
        },
    });
    
    // Store sensitive values in the secret
    const secretVersion = new aws.secretsmanager.SecretVersion("controller-secrets-version", {
        secretId: controllerSecret.id,
        secretString: pulumi.all([
            ellucianApiKey,
            bearerToken,
            apiKey,
            redisPassword,
            dbPassword
        ]).apply(([
            ellucianKey,
            bearerTok,
            apiK,
            redisPwd,
            dbPwd
        ]) => JSON.stringify({
            ELLUCIAN_API_KEY: ellucianKey,
            BEARER_TOKEN: bearerTok,
            API_KEY: apiK,
            REDIS_PASSWORD: redisPwd,
            WORKFLOW_DB_PASSWORD: dbPwd
        })),
    });
    
    return {
        secretArn: controllerSecret.arn,
    };
}