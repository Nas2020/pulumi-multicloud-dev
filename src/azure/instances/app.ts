// File: src/azure/instances/app.ts
import * as azure from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";
import { InstanceConfig } from "./types";

export function createAppInstance(config: InstanceConfig, opts?: pulumi.ComponentResourceOptions): azure.compute.VirtualMachine {
    const nic = new azure.network.NetworkInterface(`${config.name}-nic`, {
        resourceGroupName: config.resourceGroupName,
        location: "eastus",
        ipConfigurations: [{
            name: `${config.name}-ipconfig`,
            subnet: { id: config.subnetId },
            privateIPAllocationMethod: "Dynamic",
        }],
        networkSecurityGroup: { id: config.networkSecurityGroupId },
    }, opts);

    const ubuntuImage = azure.compute.getVirtualMachineImage({
        location: "eastus",
        publisher: "Canonical",
        offer: "0001-com-ubuntu-server-jammy",
        sku: "22_04-lts",
        version: "latest",
    });

    const vm = new azure.compute.VirtualMachine(config.name, {
        resourceGroupName: config.resourceGroupName,
        location: "eastus",
        vmSize: config.vmSize,
        networkInterfaceIds: [nic.id],
        identity: { type: "UserAssigned", userAssignedIdentities: { [config.managedIdentityId]: {} } },
        osProfile: {
            computerName: config.name,
            adminUsername: "ubuntu",
            adminPassword: "DisabledForSshKey",
            customData: Buffer.from(`#!/bin/bash
set -ex
exec > >(tee /var/log/${config.name}-userdata.log) 2>&1

echo "Starting ${config.name} setup at $(date)"

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

systemctl start docker || { echo "Failed to start Docker service at $(date)"; systemctl status docker > /var/log/docker-failure.log; exit 1; }
systemctl enable docker
usermod -aG docker ubuntu

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

docker rm -f ${config.name} || true
docker run -d --name ${config.name} --restart always -p 80:80 nginxdemos/hello

retry_count=5
timeout=60
until curl -s http://localhost:80 > /dev/null; do
    if [ $timeout -le 0 ]; then
        if [ $retry_count -le 0 ]; then
            echo "Container health check failed after 5 retry attempts at $(date)"
            docker logs ${config.name} > /var/log/container-failure.log
            docker inspect ${config.name} >> /var/log/container-failure.log
            exit 1
        fi
        echo "Health check failed, restarting container... ($retry_count retries left)"
        docker rm -f ${config.name}
        docker run -d --name ${config.name} --restart always -p 80:80 nginxdemos/hello
        retry_count=$(($retry_count - 1))
        timeout=60
    fi
    echo "Waiting for container to be healthy... ($timeout seconds remaining)"
    timeout=$(($timeout - 1))
    sleep 1
done

echo "Container status after setup at $(date):" >> /var/log/${config.name}-userdata.log
docker ps -a >> /var/log/${config.name}-userdata.log
echo "${config.name} setup complete at $(date)"`).toString("base64"),
        },
        storageProfile: {
            imageReference: {
                publisher: ubuntuImage.then(img => img.publisher),
                offer: ubuntuImage.then(img => img.offer),
                sku: ubuntuImage.then(img => img.sku),
                version: ubuntuImage.then(img => img.version),
            },
            osDisk: {
                createOption: "FromImage",
                managedDisk: { storageAccountType: "Standard_LRS" },
            },
        },
        tags: { Name: config.name, AutoRecovery: "true" },
    }, { ...opts, dependsOn: [nic] });

    return vm;
}