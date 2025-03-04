import * as pulumi from "@pulumi/pulumi";
import * as compute from "@pulumi/azure-native/compute";
import * as network from "@pulumi/azure-native/network";
import { InstanceConfig, AppInstanceOutputs } from "./types";

export function createAppInstance(
    instanceConfig: InstanceConfig,
    opts?: pulumi.ComponentResourceOptions
): AppInstanceOutputs {
    const pulConfig = new pulumi.Config();
    const adminUsername = pulConfig.get("azureAdminUsername") || "azureuser";
    const sshPublicKey = pulConfig.require("azureSshPublicKey");

    // Create network interface
    const nic = new network.NetworkInterface(`${instanceConfig.name}-nic`, {
        resourceGroupName: instanceConfig.resourceGroupName,
        networkInterfaceName: `${instanceConfig.name}-nic`,
        ipConfigurations: [{
            name: "ipconfig",
            subnet: {
                id: instanceConfig.subnetId,
            },
            privateIPAllocationMethod: network.IPAllocationMethod.Dynamic,
        }],
        networkSecurityGroup: {
            id: instanceConfig.nsgId,
        },
    }, opts);

    // Generate bootstrap script for app instance
    const bootstrapScript = `#!/bin/bash
set -ex
exec > >(tee /var/log/${instanceConfig.name}-userdata.log) 2>&1

echo "Starting ${instanceConfig.name} setup at $(date)"

# Test internet connectivity
echo "Testing internet access..."
curl -s https://www.google.com > /dev/null && echo "Internet access confirmed" || echo "No internet access"

# Update system and install dependencies with max 5 retries
retry_count=5
until apt-get update; do
    if [ $retry_count -le 0 ]; then
        echo "apt-get update failed after 5 attempts at $(date)"
        exit 1
    fi
    echo "apt-get update failed. Retrying... ($retry_count attempts left)"
    retry_count=$(($retry_count - 1))
    sleep 2
done

retry_count=5
until apt-get install -y docker.io curl netcat-traditional netcat-openbsd; do
    if [ $retry_count -le 0 ]; then
        echo "apt-get install failed after 5 attempts at $(date)"
        exit 1
    fi
    echo "apt-get install failed. Retrying... ($retry_count attempts left)"
    retry_count=$(($retry_count - 1))
    sleep 2
done

# Configure docker with better failure handling
systemctl start docker || {
    echo "Failed to start Docker service at $(date)"
    systemctl status docker > /var/log/docker-failure.log
    exit 1
}
systemctl enable docker
usermod -aG docker azureuser

# Wait for docker to be ready with detailed failure logging
timeout=60
until docker info >/dev/null 2>&1; do
    if [ $timeout -le 0 ]; then
        echo "Docker daemon failed to start after 60 seconds at $(date)"
        docker info --debug > /var/log/docker-startup-failure.log 2>&1 || true
        systemctl status docker >> /var/log/docker-startup-failure.log
        exit 1
    fi
    echo "Waiting for Docker daemon... ($timeout seconds remaining)"
    timeout=$(($timeout - 1))
    sleep 1
done

# Stop any existing containers
docker rm -f ${instanceConfig.name} || true

# Run new container
docker run -d \\
    --name ${instanceConfig.name} \\
    --restart always \\
    -p 80:80 \\
    nginxdemos/hello

# Verify container is running with extended timeout and retries
retry_count=5
timeout=60
until curl -s http://localhost:80 > /dev/null; do
    if [ $timeout -le 0 ]; then
        if [ $retry_count -le 0 ]; then
            echo "Container health check failed after 5 retry attempts at $(date)"
            docker logs ${instanceConfig.name} > /var/log/container-failure.log
            docker inspect ${instanceConfig.name} >> /var/log/container-failure.log
            exit 1
        fi
        echo "Health check failed, restarting container... ($retry_count retries left)"
        docker rm -f ${instanceConfig.name}
        docker run -d \\
            --name ${instanceConfig.name} \\
            --restart always \\
            -p 80:80 \\
            nginxdemos/hello
        retry_count=$(($retry_count - 1))
        timeout=60
    fi
    echo "Waiting for container to be healthy... ($timeout seconds remaining)"
    timeout=$(($timeout - 1))
    sleep 1
done

# Log final container status
echo "Container status after setup at $(date):" >> /var/log/${instanceConfig.name}-userdata.log
docker ps -a >> /var/log/${instanceConfig.name}-userdata.log

echo "${instanceConfig.name} setup complete at $(date)"`;

    // Create VM
    const vm = new compute.VirtualMachine(instanceConfig.name, {
        resourceGroupName: instanceConfig.resourceGroupName,
        vmName: instanceConfig.name,
        hardwareProfile: {
            vmSize: instanceConfig.vmSize,
        },
        osProfile: {
            computerName: instanceConfig.name,
            adminUsername: adminUsername,
            linuxConfiguration: {
                disablePasswordAuthentication: true,
                ssh: {
                    publicKeys: [{
                        path: `/home/${adminUsername}/.ssh/authorized_keys`,
                        keyData: sshPublicKey,
                    }],
                },
            },
            customData: Buffer.from(bootstrapScript).toString("base64"),
        },
        networkProfile: {
            networkInterfaces: [{
                id: nic.id,
                primary: true,
            }],
        },
        storageProfile: {
            imageReference: {
                publisher: "Canonical",
                offer: "0001-com-ubuntu-server-jammy",
                sku: "22_04-lts",
                version: "latest",
            },
            osDisk: {
                name: `${instanceConfig.name}-osdisk`,
                caching: "ReadWrite",
                createOption: "FromImage",
                managedDisk: {
                    storageAccountType: "Standard_LRS",
                },
            },
        },
        identity: {
            type: compute.ResourceIdentityType.UserAssigned,
            userAssignedIdentities: [instanceConfig.managedIdentityId],
        },
        tags: {
            Name: instanceConfig.name,
            AutoRecovery: "true"
        },
    }, { ...opts, dependsOn: [nic] });

    // Get the NIC's private IP address
    const privateIp = nic.ipConfigurations.apply(ipConfigs => {
        if (ipConfigs && ipConfigs.length > 0) {
            return ipConfigs[0].privateIPAddress as string;
        }
        return "";
    });

    return {
        vm,
        vmId: vm.id,
        privateIp: privateIp,
    };
}