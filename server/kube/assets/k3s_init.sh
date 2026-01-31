#!/bin/bash

# 脚本第一个参数为 k3s token
export K3S_TOKEN="${1:-123456}"

# 国内二进制下载源
export INSTALL_K3S_MIRROR="cn"

# 国内源安装k3s
curl -sfL https://rancher-mirror.rancher.cn/k3s/k3s-install.sh | sh -s - server --cluster-init --system-default-registry "registry.cn-hangzhou.aliyuncs.com"