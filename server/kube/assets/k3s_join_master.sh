#!/bin/bash

# 脚本第一个参数为 k3s token
export K3S_TOKEN="${1:-123456}"

# 脚本第二个参数为 k3s master 地址
export MASTER_IP="${2}"

curl -sfL https://rancher-mirror.rancher.cn/k3s/k3s-install.sh | K3S_TOKEN="${K3S_TOKEN}" sh -s - server --server https://${MASTER_IP}:6443 --system-default-registry "registry.cn-hangzhou.aliyuncs.com"
