/**
 * Kubernetes 集群管理模块
 *
 * 提供以下功能：
 * 1. 初始化 control-plane 节点
 * 2. 让节点加入集群
 * 3. 检查集群节点状态
 * 4. 获取集群 kubeconfig
 */

import { KubeConfig, CoreV1Api } from '@kubernetes/client-node'
import { SSHConfig, execSSH, uploadContent, uploadAndExecScript } from './ssh.js'
import { getSetupScript, getKubeadmConfig } from './getAssets.js'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 节点状态
 */
export interface NodeStatus {
  /** 节点名称 */
  name: string
  /** 节点状态（Ready、NotReady 等） */
  status: string
  /** 节点角色（control-plane、worker 等） */
  roles: string[]
  /** Kubernetes 版本 */
  version: string
  /** 内部 IP 地址 */
  internalIP: string
}

/**
 * kubeadm init 结果
 */
export interface InitResult {
  /** 初始化是否成功 */
  success: boolean
  /** kubeconfig 内容 */
  kubeconfig?: string
  /** 加入集群的命令 */
  joinCommand?: string
  /** 错误信息 */
  error?: string
}

/**
 * 加入集群结果
 */
export interface JoinResult {
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
}

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 初始化节点为 control-plane
 *
 * 在远程服务器上执行 setup 脚本，然后使用配置文件运行 kubeadm init 初始化集群
 *
 * @param config - SSH 配置
 * @returns 初始化结果
 *
 * @example
 * ```typescript
 * const result = await initControlPlane({
 *   host: '192.168.1.100',
 *   username: 'ubuntu',
 *   password: 'your-password'
 * })
 *
 * if (result.success) {
 *   console.log('kubeconfig:', result.kubeconfig)
 *   console.log('join command:', result.joinCommand)
 * } else {
 *   console.error('初始化失败:', result.error)
 * }
 * ```
 */
export async function initControlPlane(config: SSHConfig): Promise<InitResult> {
  try {
    // 1. 获取并上传 setup 脚本并执行
    const setupScript = getSetupScript()
    const setupRemotePath = '/tmp/setup-k8s.sh'

    await uploadAndExecScript(config, setupScript, setupRemotePath)

    // 2. 获取并上传 kubeadm 配置文件
    const kubeadmConfig = getKubeadmConfig()
    const configRemotePath = '/tmp/kubeadm-config.yaml'

    await uploadContent(config, kubeadmConfig, configRemotePath)

    // 3. 运行 kubeadm init，使用配置文件
    // 配置文件中已指定 cri-socket 和网络配置

    try {
      await execSSH(config, `sudo kubeadm init --config=${configRemotePath}`)
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      }
    }

    // 4. 获取 kubeconfig
    const kubeconfig = await execSSH(config, 'sudo cat /etc/kubernetes/admin.conf')

    // 5. 获取 join 命令
    try {
      const joinCommand = await execSSH(config, 'sudo kubeadm token create --print-join-command')

      return {
        success: true,
        kubeconfig,
        joinCommand,
      }
    } catch (error: any) {
      // 即使获取 join 命令失败，初始化可能仍然成功
      return {
        success: true,
        kubeconfig,
        error: `初始化成功但获取 join 命令失败: ${error.message}`,
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * 让节点加入集群
 *
 * 在远程服务器上执行 setup 脚本，然后运行 kubeadm join 加入集群
 *
 * @param config - SSH 配置
 * @param joinCommand - 加入集群的命令（从 control-plane 获取）
 * @returns 加入结果
 *
 * @example
 * ```typescript
 * const result = await joinCluster({
 *   host: '192.168.1.101',
 *   username: 'ubuntu',
 *   password: 'your-password'
 * }, 'kubeadm join 192.168.1.100:6443 --token xxx --discovery-token-ca-cert-hash sha256:xxx')
 *
 * if (result.success) {
 *   console.log('节点成功加入集群')
 * } else {
 *   console.error('加入集群失败:', result.error)
 * }
 * ```
 */
export async function joinCluster(config: SSHConfig, joinCommand: string): Promise<JoinResult> {
  try {
    // 1. 获取并上传 setup 脚本并执行
    const setupScript = getSetupScript()
    const setupRemotePath = '/tmp/setup-k8s.sh'

    await uploadAndExecScript(config, setupScript, setupRemotePath)

    // 2. 执行 join 命令
    // 添加 cri-socket 参数
    const commandWithCriSocket = joinCommand.replace(
      /kubeadm join/,
      'sudo kubeadm join --cri-socket=/run/cri-dockerd.sock'
    )

    await execSSH(config, commandWithCriSocket)

    return {
      success: true,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * 检查 Kubernetes 集群节点状态
 *
 * 使用 kubectl 或 Kubernetes API 获取节点状态
 *
 * @param kubeconfigContent - kubeconfig 文件内容
 * @returns 节点状态列表
 *
 * @example
 * ```typescript
 * const nodes = await getNodes(kubeconfigContent)
 *
 * nodes.forEach(node => {
 *   console.log(`节点: ${node.name}`)
 *   console.log(`状态: ${node.status}`)
 *   console.log(`角色: ${node.roles.join(', ')}`)
 *   console.log(`版本: ${node.version}`)
 *   console.log(`IP: ${node.internalIP}`)
 * })
 * ```
 */
export async function getNodes(kubeconfigContent: string): Promise<NodeStatus[]> {
  // 创建临时 kubeconfig
  const kc = new KubeConfig()

  try {
    // 从字符串加载 kubeconfig
    kc.loadFromString(kubeconfigContent)

    // 创建 CoreV1Api
    const k8sApi = kc.makeApiClient(CoreV1Api)

    // 获取节点列表
    const res = await k8sApi.listNode()

    return res.items.map((node: any) => {
      // 获取节点状态
      const conditions = node.status?.conditions || []
      const readyCondition = conditions.find((c: any) => c.type === 'Ready')
      const status = readyCondition?.status === 'True' ? 'Ready' : 'NotReady'

      // 获取节点角色
      const labels = node.metadata?.labels || {}
      const roles: string[] = []

      if (labels['node-role.kubernetes.io/control-plane']) {
        roles.push('control-plane')
      }
      if (labels['node-role.kubernetes.io/master']) {
        roles.push('master')
      }
      if (!roles.includes('control-plane') && !roles.includes('master')) {
        roles.push('worker')
      }

      // 获取 Kubernetes 版本
      const version = node.status?.nodeInfo?.kubeletVersion || 'unknown'

      // 获取内部 IP
      const addresses = node.status?.addresses || []
      const internalIPObj = addresses.find((a: any) => a.type === 'InternalIP')
      const internalIP = internalIPObj?.address || ''

      return {
        name: node.metadata?.name || '',
        status,
        roles,
        version,
        internalIP,
      }
    })
  } catch (error: any) {
    throw new Error(`获取节点列表失败: ${error.message}`)
  }
}

/**
 * 获取集群 kubeconfig
 *
 * 从远程服务器获取 /etc/kubernetes/admin.conf 的内容
 *
 * @param config - SSH 配置
 * @returns kubeconfig 内容
 *
 * @example
 * ```typescript
 * const kubeconfig = await getKubeconfig({
 *   host: '192.168.1.100',
 *   username: 'ubuntu',
 *   password: 'your-password'
 * })
 *
 * // 保存到文件
 * fs.writeFileSync('kubeconfig.yaml', kubeconfig)
 *
 * // 或者直接用于 API 调用
 * const nodes = await getNodes(kubeconfig)
 * ```
 */
export async function getKubeconfig(config: SSHConfig): Promise<string> {
  try {
    const kubeconfig = await execSSH(config, 'sudo cat /etc/kubernetes/admin.conf')
    return kubeconfig
  } catch (error: any) {
    throw new Error(`获取 kubeconfig 失败: ${error.message}`)
  }
}

// ============================================================================
// 重新导出依赖模块的类型和函数
// ============================================================================

// 类型导出使用 export type (TypeScript interface 在运行时不存在)
export type { SSHConfig } from './ssh.js'
export { getSetupScript, getKubeadmConfig } from './getAssets.js'
export { execSSH, uploadFile, uploadContent, uploadAndExecScript } from './ssh.js'
