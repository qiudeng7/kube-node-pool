#!/bin/bash


# 在 腾讯云Ubuntu 中准备 k8s 环境

# 解析命令行参数
CLASH_CONFIG_URL="${1:-$DEFAULT_CLASH_URL}"

# 设置非交互模式
export DEBIAN_FRONTEND=noninteractive

# 工作目录
mkdir -p /home/ubuntu/install-k8s && cd /home/ubuntu/install-k8s

# 开梯子
# 不能用clash for linux install，订阅15分钟失效
# git clone --branch master --depth 1 https://cdn.gh-proxy.org/https://github.com/nelvko/clash-for-linux-install.git
# cd clash-for-linux-install
# sed -i "s|^CLASH_CONFIG_URL=.*|CLASH_CONFIG_URL=${CLASH_CONFIG_URL}|" ./.env
# bash install.sh
# 加载 clashctl 命令
# . /home/ubuntu/clashctl/scripts/cmd/clashctl.sh

# 禁用 swap
sudo swapoff -a

# 启用 IP 转发
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system

# 安装containerd 腾讯云mirror自带
# sudo apt update
# sudo apt install ca-certificates curl
# sudo install -m 0755 -d /etc/apt/keyrings
# sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
# sudo chmod a+r /etc/apt/keyrings/docker.asc
# sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
# Types: deb
# URIs: https://download.docker.com/linux/ubuntu
# Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
# Components: stable
# Signed-By: /etc/apt/keyrings/docker.asc
# EOF
# sudo apt update
sudo apt install containerd -y
# 配置containerd cgroup
sudo bash -c "containerd config default > /etc/containerd/config.toml"
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd


# 安装 kubeadm、kubelet、kubectl
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
curl -fsSL https://mirrors.cqupt.edu.cn/kubernetes/core:/stable:/v1.35/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://mirrors.cqupt.edu.cn/kubernetes/core:/stable:/v1.35/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable --now kubelet

# 其他
## k8s 需要此工具，但腾讯云 Ubuntu 服务器默认未安装
sudo apt install conntrack
## tat 客户端，参考：https://cloud.tencent.com/document/api/1340/52695
# sudo wget -qO - https://tat-1258344699.cos-internal.accelerate.tencentcos.cn/tat_agent/tat_agent_installer.sh | sudo sh

# sudo kubeadm init --pod-network-cidr 10.244.0.0/24 --v=5 --image-repository k8s.m.daocloud.io