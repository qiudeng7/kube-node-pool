#!/bin/bash

# 脚本第一个参数为 clash 订阅链接
CLASH_CONFIG_URL="${1:-$DEFAULT_CLASH_URL}"

# 安装clash
git clone --branch master --depth 1 https://cdn.gh-proxy.org/https://github.com/nelvko/clash-for-linux-install.git
cd clash-for-linux-install
sed -i "s|^CLASH_CONFIG_URL=.*|CLASH_CONFIG_URL=${CLASH_CONFIG_URL}|" ./.env
bash install.sh

# 加载 clashctl 命令
. /home/ubuntu/clashctl/scripts/cmd/clashctl.sh