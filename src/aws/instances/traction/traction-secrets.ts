// File: src/aws/traction-secrets.ts
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface TractionSecretsOutputs {
    secretArn: pulumi.Output<string>;
}

export function createTractionSecrets(): TractionSecretsOutputs {
    const config = new pulumi.Config();
    const environment = pulumi.getStack();
    
    // Use proper secrets handling with better defaults
    const tractionSeed = config.getSecret("awsTractionSeed") || "DigiCred00CrMS00Static0000000000";
    const walletKey = config.getSecret("awsTractionWalletKey") || "digicredkey";
    const adminApiKey = config.getSecret("awsTractionAdminAPIkey") || "digicred-me";
    const jwtSecret = config.getSecret("awsTractionJWTSecret") || "change-me";
    const dbPassword = config.getSecret("awsTractionDBPassword") || "postgresPass";
    const innkeeperWalletKey = config.getSecret("awsInnkeeperWalletKey") || "change-me";
    const endorserSeed = config.getSecret("awsEndorserSeed") || "DigiCredSeedNasT0000000000000001";
    const endorserSeed1 = config.getSecret("awsEndorserSeed1") || "DigiCredSeedNasT0000000000000002";
    const endorserApiKey = config.getSecret("awsEndorserApiKey") || "change-me";
    const endorserAcapyAdminApiKey = config.getSecret("awsEndorserAcapyAdminApiKey") || "change-me";
    const endorserWalletKey = config.getSecret("awsEndorserWalletKey") || "key";
    const endorserWebhookApiKey = config.getSecret("awsEndorserWebhookApiKey") || "1234";
    const endorserPsqlAdminPwd = config.getSecret("awsEndorserPsqlAdminPwd") || "tractionadminPass";
    const endorserPsqlUserPwd = config.getSecret("awsEndorserPsqlUserPwd") || "tractionPass";
    
    // Create a secret for sensitive values
    const tractionSecret = new aws.secretsmanager.Secret("traction-secrets", {
        name: `traction-secrets-${environment}`,
        description: "Secrets for Traction/DigiCred configuration",
        tags: { 
            Name: `traction-secrets-${environment}`,
            Environment: environment,
            Service: "traction" 
        },
    });
    
    // Store sensitive values in the secret
    const secretVersion = new aws.secretsmanager.SecretVersion("traction-secrets-version", {
        secretId: tractionSecret.id,
        secretString: pulumi.all([
            tractionSeed, 
            walletKey, 
            adminApiKey, 
            jwtSecret, 
            dbPassword, 
            innkeeperWalletKey,
            endorserSeed,
            endorserSeed1,
            endorserApiKey,
            endorserAcapyAdminApiKey,
            endorserWalletKey,
            endorserWebhookApiKey,
            endorserPsqlAdminPwd,
            endorserPsqlUserPwd
        ]).apply(([
            seed, 
            wKey, 
            apiKey, 
            jwt, 
            dbPwd, 
            innWKey,
            endSeed,
            endSeed1,
            endApiKey,
            endAcapyApiKey,
            endWKey,
            endWebhookKey,
            endPsqlAdminPwd,
            endPsqlUserPwd
        ]) => JSON.stringify({
            TRACTION_SEED: seed,
            TRACTION_ACAPY_WALLET_ENCRYPTION_KEY: wKey,
            ACAPY_ADMIN_API_KEY: apiKey,
            ACAPY_MULTITENANT_JWT_SECRET: jwt,
            POSTGRESQL_PASSWORD: dbPwd,
            ENDORSER_POSTGRESQL_PASSWORD: dbPwd,
            TRACTION_INNKEEPER_WALLET_KEY: innWKey,
            ACAPY_ENDORSER_SEED: endSeed,
            ACAPY_ENDORSER_SEED_1: endSeed1,
            ENDORSER_ACAPY_ADMIN_URL_API_KEY: endAcapyApiKey,
            ENDORSER_API_ADMIN_KEY: endApiKey,
            ENDORSER_ACAPY_WALLET_ENCRYPTION_KEY: endWKey,
            ENDORSER_ACAPY_WEBHOOK_URL_API_KEY: endWebhookKey,
            ENDORSER_PSQL_ADMIN_PWD: endPsqlAdminPwd,
            ENDORSER_PSQL_USER_PWD: endPsqlUserPwd
        })),
    });
    
    return {
        secretArn: tractionSecret.arn,
    };
}