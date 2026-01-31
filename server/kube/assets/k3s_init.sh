#!/bin/bash

# 脚本第一个参数为 k3s token
export K3S_TOKEN="${1:-123456}"

# 国内二进制下载源
export INSTALL_K3S_MIRROR="cn"

# 国内源安装k3s
curl -sfL https://rancher-mirror.rancher.cn/k3s/k3s-install.sh | sh -s - server --cluster-init --system-default-registry "registry.cn-hangzhou.aliyuncs.com"

# 等待 K3s 服务启动
echo "Waiting for K3s service to be ready..."
MAX_WAIT=180  # 最多等待 180 秒
WAIT_TIME=0

while [ $WAIT_TIME -lt $MAX_WAIT ]; do
  # 检查服务是否运行
  if systemctl is-active --quiet k3s.service; then
    # 检查 API 端口是否开放
    if curl -sfk https://localhost:6443/healthz &>/dev/null; then
      # 检查是否可以获取节点信息
      NODES=$(sudo k3s kubectl get nodes -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)

      if [ -n "$NODES" ]; then
        # 检查是否有至少一个 Ready 状态的节点
        READY_COUNT=$(sudo k3s kubectl get nodes -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null | grep -c "true" || echo "0")

        if [ "$READY_COUNT" -gt 0 ]; then
          echo "✓ K3s service is ready"
          echo "Cluster nodes:"
          sudo k3s kubectl get nodes
          exit 0
        else
          echo "  Nodes found but not ready yet..."
        fi
      fi
    fi
  fi

  WAIT_TIME=$((WAIT_TIME + 5))
  echo "  Still waiting... (${WAIT_TIME}s/${MAX_WAIT}s)"
  sleep 5
done

echo "✗ Timeout: K3s service did not start within ${MAX_WAIT}s"
echo "Checking service status:"
systemctl status k3s.service --no-pager
echo ""
echo "Checking K3s logs:"
journalctl -u k3s.service --no-pager -n 50
exit 1
