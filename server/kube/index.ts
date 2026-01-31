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
import { runRemoteScript } from './ssh.js'

// 获取当前文件所在目录的绝对路径
const __dirname = dirname(fileURLToPath(import.meta.url))

// ============================================================================
// K3s 集群管理函数
// ============================================================================

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
 *
 * @returns 执行结果
 *
 * @example
 * ```typescript
 * const result = await installClash({
 *   serverIP: '192.168.1.10',
 *   subscriptionURL: 'https://example.com/config.yaml',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey
 * })
 * ```
 */
export async function installClash(installClashParams: {
    subscriptionURL: string,
    serverIP: string,
    sshPort?: number,
    sshUser?: string,
    sshPubKey?: string,
    sshPubKeyPath?: string,
    sshPasswd?: string
}) {
    const { subscriptionURL, serverIP, sshPort, sshUser, sshPubKey, sshPubKeyPath, sshPasswd } = installClashParams
    const scriptPath = join(__dirname, 'assets', 'clash_install.sh')

    return runRemoteScript({
        serverIP,
        sshPort,
        sshUser,
        sshPubKey,
        sshPubKeyPath,
        sshPasswd,
        scriptPath,
        args: [subscriptionURL]
    })
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
 *
 * @returns 执行结果
 *
 * @example
 * ```typescript
 * const result = await initK3s({
 *   serverIP: '192.168.1.10',
 *   k3sToken: 'K10abcdef1234567890',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey
 * })
 * ```
 */
export async function initK3s(initK3sParams: {
    serverIP: string,
    k3sToken: string,
    sshPort?: number,
    sshUser?: string,
    sshPubKey?: string,
    sshPubKeyPath?: string,
    sshPasswd?: string
}) {
    const { serverIP, k3sToken, sshPort, sshUser, sshPubKey, sshPubKeyPath, sshPasswd } = initK3sParams
    const scriptPath = join(__dirname, 'assets', 'k3s_init.sh')

    return runRemoteScript({
        serverIP,
        sshPort,
        sshUser,
        sshPubKey,
        sshPubKeyPath,
        sshPasswd,
        scriptPath,
        args: [k3sToken]
    })
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
 *   sshPubKey: privateKey
 * })
 * ```
 */
export async function joinK3sMaster(joinK3sMasterParams: {
    serverIP: string,
    masterIP: string,
    k3sToken: string,
    sshPort?: number,
    sshUser?: string,
    sshPubKey?: string,
    sshPubKeyPath?: string,
    sshPasswd?: string
}) {
    const { serverIP, masterIP, k3sToken, sshPort, sshUser, sshPubKey, sshPubKeyPath, sshPasswd } = joinK3sMasterParams
    const scriptPath = join(__dirname, 'assets', 'k3s_join_master.sh')

    return runRemoteScript({
        serverIP,
        sshPort,
        sshUser,
        sshPubKey,
        sshPubKeyPath,
        sshPasswd,
        scriptPath,
        args: [k3sToken, masterIP]
    })
}
