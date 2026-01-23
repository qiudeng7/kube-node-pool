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
  /** worker 节点加入集群的命令 */
  joinCommand?: string
  /** control-plane 节点加入集群的命令 */
  controlPlaneJoinCommand?: string
  /** 错误信息 */
  error?: string
}

/**
 * 加入集群结果
 */
export interface JoinResult {
  /** 节点 IP */
  host: string
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
}

/**
 * Setup 节点结果
 */
export interface SetupResult {
  /** 节点 IP */
  host: string
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
}

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 并行在多个节点上执行 setup 脚本
 *
 * 在多个服务器上并行执行 Kubernetes 环境准备脚本
 *
 * @param configs - SSH 配置数组
 * @returns 每个节点的 setup 结果
 *
 * @example
 * ```typescript
 * const results = await setupServers([
 *   { host: '192.168.1.100', username: 'ubuntu', password: 'pwd1' },
 *   { host: '192.168.1.101', username: 'ubuntu', password: 'pwd2' },
 *   { host: '192.168.1.102', username: 'ubuntu', password: 'pwd3' }
 * ])
 *
 * results.forEach(result => {
 *   if (result.success) {
 *     console.log(`${result.host} setup 成功`)
 *   } else {
 *     console.error(`${result.host} setup 失败: ${result.error}`)
 *   }
 * })
 * ```
 */
export async function setupNodes(configs: SSHConfig[]): Promise<SetupResult[]> {
  const setupScript = getSetupScript()

  const promises = configs.map(async (config) => {
    try {
      await uploadAndExecScript(config, setupScript, '/tmp/setup-k8s.sh')
      return {
        host: config.host,
        success: true,
      }
    } catch (error: any) {
      return {
        host: config.host,
        success: false,
        error: error.message,
      }
    }
  })

  return await Promise.all(promises)
}

/**
 * 初始化节点为 control-plane
 *
 * 使用配置文件运行 kubeadm init 初始化集群
 *
 * 注意: 此函数不会自动执行 setup 脚本，调用者需要先使用 setupServers 或 uploadAndExecScript 执行 setup
 *
 * @param config - SSH 配置
 * @returns 初始化结果
 *
 * @example
 * ```typescript
 * // 先并行执行 setup
 * await setupServers([
 *   { host: '192.168.1.100', username: 'ubuntu', password: 'your-password' }
 * ])
 *
 * // 再初始化集群
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
    // 1. 上传 kubeadm 配置文件
    const kubeadmConfig = getKubeadmConfig()
    const configRemotePath = '/tmp/kubeadm-config.yaml'

    await uploadContent({
      config,
      content: kubeadmConfig,
      remotePath: configRemotePath
    })

    // 2. 运行 kubeadm init，使用配置文件
    // 配置文件中已指定 cri-socket 和网络配置
    try {
      await execSSH(config, `sudo kubeadm init --config=${configRemotePath}`)
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      }
    }

    // 3. 获取 kubeconfig
    const kubeconfig = await execSSH(config, 'sudo cat /etc/kubernetes/admin.conf')

    // 4. 获取 worker 节点的 join 命令
    let joinCommand: string | undefined
    let controlPlaneJoinCommand: string | undefined

    try {
      joinCommand = await execSSH(config, 'sudo kubeadm token create --print-join-command')
    } catch (error: any) {
      // 即使获取 join 命令失败，初始化可能仍然成功
      return {
        success: true,
        kubeconfig,
        error: `初始化成功但获取 join 命令失败: ${error.message}`,
      }
    }

    // 5. 生成证书密钥并获取 control-plane 节点的 join 命令
    try {
      // 上传证书并获取证书密钥
      const certKeyOutput = await execSSH(
        config,
        'sudo kubeadm init phase upload-certs --upload-certs 2>/dev/null | tail -n 1'
      )
      const certificateKey = certKeyOutput.trim()

      if (certificateKey && joinCommand) {
        // 为 control-plane 节点生成 join 命令
        controlPlaneJoinCommand = `${joinCommand} --control-plane --certificate-key ${certificateKey}`
      }
    } catch (error: any) {
      // 即使获取 control-plane join 命令失败，worker join 命令可能已经获取成功
      console.warn(`获取 control-plane join 命令失败: ${error.message}`)
    }

    return {
      success: true,
      kubeconfig,
      joinCommand,
      controlPlaneJoinCommand,
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
 * 并行执行 kubeadm join 命令让多个节点加入集群
 *
 * 注意: 此函数不会自动执行 setup 脚本，调用者需要先使用 setupNodes 或 uploadAndExecScript 执行 setup
 *
 * @param configs - SSH 配置数组
 * @param joinCommand - 加入集群的命令（从 control-plane 获取）
 * @returns 每个节点的加入结果
 *
 * @example
 * ```typescript
 * // 先并行执行 setup
 * await setupNodes([
 *   { host: '192.168.1.101', username: 'ubuntu', password: 'pwd1' },
 *   { host: '192.168.1.102', username: 'ubuntu', password: 'pwd2' },
 *   { host: '192.168.1.103', username: 'ubuntu', password: 'pwd3' }
 * ])
 *
 * // 再并行加入集群
 * const results = await joinCluster([
 *   { host: '192.168.1.101', username: 'ubuntu', password: 'pwd1' },
 *   { host: '192.168.1.102', username: 'ubuntu', password: 'pwd2' },
 *   { host: '192.168.1.103', username: 'ubuntu', password: 'pwd3' }
 * ], 'kubeadm join 192.168.1.100:6443 --token xxx --discovery-token-ca-cert-hash sha256:xxx')
 *
 * results.forEach(result => {
 *   if (result.success) {
 *     console.log(`${result.host} 加入集群成功`)
 *   } else {
 *     console.error(`${result.host} 加入集群失败: ${result.error}`)
 *   }
 * })
 * ```
 */
export async function joinCluster(configs: SSHConfig[], joinCommand: string): Promise<JoinResult[]> {
  const promises = configs.map(async (config) => {
    try {
      // 执行 join 命令
      // 添加 cri-socket 参数
      const commandWithCriSocket = joinCommand.replace(
        /kubeadm join/,
        'sudo kubeadm join --cri-socket=/run/cri-dockerd.sock'
      )

      await execSSH(config, commandWithCriSocket)

      return {
        host: config.host,
        success: true,
      }
    } catch (error: any) {
      return {
        host: config.host,
        success: false,
        error: error.message,
      }
    }
  })

  return await Promise.all(promises)
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
