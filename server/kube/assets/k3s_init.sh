#!/bin/bash

# 脚本第一个参数为 k3s token
K3S_TOKEN="${1:-123456}"

curl -sfL https://get.k3s.io | sh -s - server --cluster-init