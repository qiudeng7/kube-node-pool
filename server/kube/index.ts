/**
 * K3s 集群管理模块
 *
 * 提供远程服务器 SSH 连接和脚本执行功能，用于自动化部署和管理 K3s 集群。
 *
 * @module server/kube
 *
 * @example
 * ```typescript
 * import { initK3s, joinK3sMaster } from './server/kube'
 *
 * // 初始化 K3s 集群
 * await initK3s({
 *   serverIP: '192.168.1.10',
 *   k3sToken: 'K10...token',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey
 * })
 *
 * // 加入 K3s 集群
 * await joinK3sMaster({
 *   serverIP: '192.168.1.11',
 *   masterIP: '192.168.1.10',
 *   k3sToken: 'K10...token',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey
 * })
 * ```
 */

import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createSSHClient, type SSHConfig, type ExecutionOptions } from '../ssh.js'

// 获取当前文件所在目录的绝对路径
const __dirname = dirname(fileURLToPath(import.meta.url))

// ============================================================================
// K3s 集群管理函数
// ============================================================================

/**
 * K3s 操作的基础配置
 */
interface K3sBaseConfig extends SSHConfig {
    /** K3s 集群认证令牌 */
    k3sToken: string
}

/**
 * K3s 集群管理选项
 */
interface K3sOptions extends ExecutionOptions {}

/**
 * 在远程服务器安装 Clash 代理
 *
 * 使用提供的订阅 URL 在远程服务器上安装并配置 Clash 代理服务。
 *
 * @param params - 安装参数
 * @param params.subscriptionURL - Clash 订阅链接
 * @param params.serverIP - 服务器 IP 地址
 * @param params.sshPort - SSH 端口，默认 22
 * @param params.sshUser - SSH 用户名，默认 'ubuntu'
 * @param params.sshPubKey - SSH 私钥内容（字符串）
 * @param params.sshPubKeyPath - SSH 私钥文件路径
 * @param params.sshPasswd - SSH 密码
 * @param params.options - 执行选项（重试、超时、日志回调等）
 *
 * @returns 执行结果
 *
 * @example
 * ```typescript
 * const result = await installClash({
 *   serverIP: '192.168.1.10',
 *   subscriptionURL: 'https://example.com/config.yaml',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey,
 *   options: {
 *     onStdout: (data) => console.log(data),
 *     onStderr: (data) => console.error(data)
 *   }
 * })
 * ```
 */
export async function installClash(params: {
    subscriptionURL: string
} & SSHConfig & { options?: K3sOptions }) {
    const { subscriptionURL, options, ...sshConfig } = params
    const scriptPath = join(__dirname, 'assets', 'clash_install.sh')

    const ssh = createSSHClient(sshConfig)
    return ssh.script(scriptPath, [subscriptionURL], options)
}

/**
 * 在远程服务器初始化 K3s 集群（首个 master 节点）
 *
 * 在指定的服务器上初始化 K3s 集群的第一个 master 节点。
 * 使用提供的 token 作为集群认证令牌。
 *
 * @param params - 初始化参数
 * @param params.serverIP - 服务器 IP 地址
 * @param params.k3sToken - K3s 集群认证令牌
 * @param params.sshPort - SSH 端口，默认 22
 * @param params.sshUser - SSH 用户名，默认 'ubuntu'
 * @param params.sshPubKey - SSH 私钥内容（字符串）
 * @param params.sshPubKeyPath - SSH 私钥文件路径
 * @param params.sshPasswd - SSH 密码
 * @param params.options - 执行选项（重试、超时、日志回调等）
 *
 * @returns 执行结果
 *
 * @example
 * ```typescript
 * const result = await initK3s({
 *   serverIP: '192.168.1.10',
 *   k3sToken: 'K10abcdef1234567890',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey,
 *   options: {
 *     onStdout: (data) => console.log(data),
 *     onStderr: (data) => console.error(data)
 *   }
 * })
 * ```
 */
export async function initK3s(params: K3sBaseConfig & { options?: K3sOptions }) {
    const { k3sToken, options, ...sshConfig } = params
    const scriptPath = join(__dirname, 'assets', 'k3s_init.sh')

    const ssh = createSSHClient(sshConfig)
    return ssh.script(scriptPath, [k3sToken], options)
}

/**
 * 在远程服务器加入 K3s 集群（作为额外的 master 节点）
 *
 * 将指定的服务器加入到现有的 K3s 集群中，作为一个新的 master 节点。
 * 需要提供首个 master 节点的 IP 地址和集群的认证令牌。
 *
 * @param params - 加入集群参数
 * @param params.serverIP - 要加入的服务器 IP 地址
 * @param params.masterIP - 首个 master 节点的 IP 地址
 * @param params.k3sToken - K3s 集群认证令牌（必须与首个节点使用的 token 一致）
 * @param params.sshPort - SSH 端口，默认 22
 * @param params.sshUser - SSH 用户名，默认 'ubuntu'
 * @param params.sshPubKey - SSH 私钥内容（字符串）
 * @param params.sshPubKeyPath - SSH 私钥文件路径
 * @param params.sshPasswd - SSH 密码
 * @param params.options - 执行选项（重试、超时、日志回调等）
 *
 * @returns 执行结果
 *
 * @example
 * ```typescript
 * const result = await joinK3sMaster({
 *   serverIP: '192.168.1.11',
 *   masterIP: '192.168.1.10',
 *   k3sToken: 'K10abcdef1234567890',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey,
 *   options: {
 *     onStdout: (data) => console.log(data),
 *     onStderr: (data) => console.error(data)
 *   }
 * })
 * ```
 */
export async function joinK3sMaster(params: {
    masterIP: string
} & K3sBaseConfig & { options?: K3sOptions }) {
    const { masterIP, k3sToken, options, ...sshConfig } = params
    const scriptPath = join(__dirname, 'assets', 'k3s_join_master.sh')

    const ssh = createSSHClient(sshConfig)
    return ssh.script(scriptPath, [k3sToken, masterIP], options)
}

// 导出类型，供外部使用
export type { SSHConfig, ExecutionOptions, SSHClient } from '../ssh.js'
