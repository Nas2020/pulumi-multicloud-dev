// azure-config-updater.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import * as https from 'https';
import { spawnSync } from 'child_process';

async function getCurrentIP(): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get('https://api.ipify.org', (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data.trim()));
        }).on('error', (err) => {
            console.warn(`Failed to get IP: ${err.message}`);
            resolve('0.0.0.0'); // Fallback
        });
    });
}

function runCommand(command: string, args: string[]): { stdout: string, stderr: string, success: boolean } {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    return {
        stdout: result.stdout?.trim() || '',
        stderr: result.stderr?.trim() || '',
        success: result.status === 0
    };
}

function getSSHPublicKey(): string | null {
    const homeDir = os.homedir();
    const sshDir = path.join(homeDir, '.ssh');
    
    // Check multiple possible locations
    const possibleKeyPaths = [
        path.join(sshDir, 'id_rsa.pub'),
        path.join(sshDir, 'id_rsa_pulumi_azure.pub'),
        path.join(sshDir, 'id_ed25519.pub')
    ];
    
    for (const keyPath of possibleKeyPaths) {
        if (fs.existsSync(keyPath)) {
            return fs.readFileSync(keyPath, 'utf8').trim();
        }
    }
    
    return null;
}

async function updatePulumiConfig() {
    console.log('Checking Azure CLI installation...');
    const azCliCheck = runCommand('az', ['--version']);
    if (!azCliCheck.success) {
        console.error('Azure CLI is not installed. Please install it first.');
        console.error('Visit: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli');
        return false;
    }
    
    console.log('Checking Azure login status...');
    const azLoginCheck = runCommand('az', ['account', 'show']);
    if (!azLoginCheck.success) {
        console.error('You are not logged in to Azure. Please run "az login" first.');
        return false;
    }
    
    // Parse account info
    const accountInfo = JSON.parse(azLoginCheck.stdout);
    const subscriptionId = accountInfo.id;
    const tenantId = accountInfo.tenantId;
    
    // Get service principal
    console.log('Getting service principal information...');
    const spName = 'pulumi-service-principal'; // Update as needed
    const spInfoResult = runCommand('az', ['ad', 'sp', 'list', '--display-name', spName, '--query', '[0].id', '-o', 'tsv']);
    const servicePrincipalId = spInfoResult.success ? spInfoResult.stdout : '';
    
    // Get current IP
    console.log('Getting current IP address...');
    const currentIp = await getCurrentIP();
    
    // Get SSH public key
    console.log('Getting SSH public key...');
    const sshPublicKey = getSSHPublicKey();
    if (!sshPublicKey) {
        console.error('SSH public key not found. Please generate an SSH key first.');
        return false;
    }
    
    // Display collected information
    console.log('\nCollected information:');
    console.log(`Azure Subscription ID: ${subscriptionId}`);
    console.log(`Azure Tenant ID: ${tenantId}`);
    console.log(`Azure Service Principal Object ID: ${servicePrincipalId || '(not found)'}`);
    console.log(`Current IP Address: ${currentIp}`);
    console.log(`SSH Public Key: ${sshPublicKey.substring(0, 40)}...`);
    
    // Update Pulumi config
    console.log('\nUpdating Pulumi configuration...');
    
    const setPulumiConfig = (key: string, value: string | null) => {
        if (!value) return false;
        const result = runCommand('pulumi', ['config', 'set', `pulumi-multicloud:${key}`, value]);
        return result.success;
    };
    
    setPulumiConfig('azureSubscriptionId', subscriptionId);
    setPulumiConfig('azureTenantId', tenantId);
    if (servicePrincipalId) {
        setPulumiConfig('azurePulumiServicePrincipalObjectId', servicePrincipalId);
    }
    setPulumiConfig('azureCurrentIpAddressForKeyVault', currentIp);
    setPulumiConfig('azureSshPublicKey', sshPublicKey);
    
    console.log('Pulumi configuration updated successfully!');
    return true;
}

// Run the function
updatePulumiConfig().catch(error => {
    console.error('Error updating Pulumi configuration:', error);
});