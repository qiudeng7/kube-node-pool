#!/bin/bash

# 脚本第一个参数为 k3s token
K3S_TOKEN="${1:-123456}"

# 脚本第二个参数为 k3s master 地址
MASTER_IP="${2}"

curl -sfL https://get.k3s.io | sh -s - server --server https://${MASTER_IP}:6443