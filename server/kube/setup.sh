#!/bin/bash

# 在ubuntu中准备k8s环境
# TODO:
# 1. docker更换为containerd

# Working directory
mkdir -p /home/ubuntu/install-k8s && cd /home/ubuntu/install-k8s

# Disable swap
sudo swapoff -a

# Enable IP forwarding
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system
# Install Docker
install -m 0755 -d /etc/apt/keyrings
# Add Docker's official GPG key
sudo curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Get system architecture and OS version
ARCH=$(dpkg --print-architecture)
VERSION_CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")

# Add Docker repository
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker packages
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

cat > /tmp/daemon.json <<EOF
{
    "exec-opts":[
        "native.cgroupdriver=systemd"
    ]
}
EOF
sudo mkdir -p /etc/docker/
sudo mv /tmp/daemon.json /etc/docker/
sudo systemctl restart docker


# Install cri-dockerd
sudo wget https://gh-proxy.com/github.com/Mirantis/cri-dockerd/releases/download/v0.3.21/cri-dockerd-0.3.21.amd64.tgz
sudo tar -xf cri-dockerd-0.3.21.amd64.tgz
sudo install -o root -g root -m 0755 cri-dockerd/cri-dockerd /usr/local/bin/cri-dockerd


cat > /tmp/cri-docker.service <<EOF
[Unit]
Description=CRI Interface for Docker Application Container Engine
Documentation=https://docs.mirantis.com
After=network-online.target firewalld.service docker.service
Wants=network-online.target
Requires=cri-docker.socket

[Service]
Type=notify
ExecStart=/usr/local/bin/cri-dockerd --container-runtime-endpoint fd://
ExecReload=/bin/kill -s HUP $MAINPID
TimeoutSec=0
RestartSec=2
Restart=always

# Note that StartLimit* options were moved from "Service" to "Unit" in systemd 229.
# Both the old, and new location are accepted by systemd 229 and up, so using the old location
# to make them work for either version of systemd.
StartLimitBurst=3

# Note that StartLimitInterval was renamed to StartLimitIntervalSec in systemd 230.
# Both the old, and new name are accepted by systemd 230 and up, so using the old name to make
# this option work for either version of systemd.
StartLimitInterval=60s

# Having non-zero Limit*s causes performance problems due to accounting overhead
# in the kernel. We recommend using cgroups to do container-local accounting.
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity

# Comment TasksMax if your systemd version does not support it.
# Only systemd 226 and above support this option.
TasksMax=infinity
Delegate=yes
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/cri-docker.service /etc/systemd/system/

cat > /tmp/cri-docker.socket <<EOF
[Unit]
Description=CRI Docker Socket for the API
PartOf=cri-docker.service

[Socket]
ListenStream=%t/cri-dockerd.sock
SocketMode=0660
SocketUser=root
SocketGroup=docker

[Install]
WantedBy=sockets.target
EOF

sudo mv /tmp/cri-docker.socket /etc/systemd/system/

# Restart cri-docker
sudo systemctl daemon-reload
sudo systemctl enable --now cri-docker.socket
sudo systemctl start cri-docker

# Install kubeadm, kubelet, kubectl
curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/kubernetes/core%3A/stable%3A/v1.31/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
cat > /tmp/kubernetes.list <<EOF
deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://mirrors.tuna.tsinghua.edu.cn/kubernetes/core:/stable:/v1.31/deb/ /
EOF
sudo mv /tmp/kubernetes.list /etc/apt/sources.list.d/kubernetes.list

sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable kubelet

# Pull images
images=$(kubeadm config images list 2>/dev/null | grep "^registry\.k8s\.io/")
for img in $images; do
    name_tag=${img#registry.k8s.io/}

    # coredns is special
    if [[ $name_tag == coredns/* ]]; then
        aliyun_img="registry.aliyuncs.com/google_containers/${name_tag#coredns/}"
    else
        aliyun_img="registry.aliyuncs.com/google_containers/${name_tag}"
    fi

    echo "download: $aliyun_img"
    sudo docker pull $aliyun_img

    echo "rename: $img"
    sudo docker tag $aliyun_img $img

    echo "untag: $aliyun_img"
    sudo docker rmi $aliyun_img
    echo "---"
done


# Other
## k8s need it, while tencent ubuntu server do not installed default.
apt install conntrack
## tat client, ref: https://cloud.tencent.com/document/api/1340/52695
sudo wget -qO - https://tat-1258344699.cos-internal.accelerate.tencentcos.cn/tat_agent/tat_agent_installer.sh | sudo sh
