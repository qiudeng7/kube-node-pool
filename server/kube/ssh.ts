/**
 * SSH 远程执行模块
 *
 * 提供以下功能：
 * 1. 通过 SSH 在远程服务器上执行命令
 * 2. 通过 SSH 上传文件到远程服务器
 * 3. 通过 SSH 上传并执行脚本
 */

import { Client } from 'ssh2'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * SSH 连接配置
 */
export interface SSHConfig {
  /** 服务器 IP 地址 */
  host: string
  /** SSH 端口，默认为 22 */
  port?: number
  /** 用户名 */
  username: string
  /** 密码（与 privateKey 二选一） */
  password?: string
  /** 私钥内容（与 password 二选一） */
  privateKey?: string
  /** 私钥密码（如果有的话） */
  passphrase?: string
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建 SSH 连接配置对象
 *
 * @param config - 用户提供的 SSH 配置
 * @returns ssh2 库所需的连接配置对象
 */
function createConnectionConfig(config: SSHConfig): any {
  const connectionConfig: any = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
  }

  if (config.password) {
    connectionConfig.password = config.password
  } else if (config.privateKey) {
    connectionConfig.privateKey = config.privateKey
    if (config.passphrase) {
      connectionConfig.passphrase = config.passphrase
    }
  }

  return connectionConfig
}

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 通过 SSH 在远程服务器上执行命令
 *
 * @param config - SSH 配置
 * @param command - 要执行的命令
 * @returns 命令输出（stdout）
 *
 * @example
 * ```typescript
 * // 使用密码认证
 * const result = await execSSH({
 *   host: '192.168.1.100',
 *   username: 'ubuntu',
 *   password: 'your-password'
 * }, 'ls -la')
 *
 * // 使用私钥认证
 * const result = await execSSH({
 *   host: '192.168.1.100',
 *   username: 'ubuntu',
 *   privateKey: fs.readFileSync('/path/to/private/key')
 * }, 'kubectl get nodes')
 * ```
 */
export function execSSH(config: SSHConfig, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let stdout = ''
    let stderr = ''

    conn
      .on('ready', () => {
        conn.exec(command, (err: any, stream: any) => {
          if (err) {
            conn.end()
            return reject(err)
          }

          stream
            .on('close', (code: number) => {
              conn.end()
              if (code === 0) {
                resolve(stdout)
              } else {
                reject(new Error(`命令执行失败，退出码 ${code}: ${stderr}`))
              }
            })
            .on('data', (data: Buffer) => {
              stdout += data.toString()
            })
            .stderr.on('data', (data: Buffer) => {
              stderr += data.toString()
            })
        })
      })
      .on('error', (err: any) => {
        reject(err)
      })

    conn.connect(createConnectionConfig(config))
  })
}

/**
 * 通过 SSH 上传文件到远程服务器
 *
 * @param config - SSH 配置
 * @param localPath - 本地文件路径
 * @param remotePath - 远程文件路径
 *
 * @example
 * ```typescript
 * await uploadFile({
 *   host: '192.168.1.100',
 *   username: 'ubuntu',
 *   password: 'your-password'
 * }, '/local/path/file.txt', '/remote/path/file.txt')
 * ```
 */
export function uploadFile(config: SSHConfig, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    conn.on('ready', () => {
      conn.sftp((err: any, sftp: any) => {
        if (err) {
          conn.end()
          return reject(err)
        }

        sftp.fastPut(localPath, remotePath, (err: any) => {
          conn.end()
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }).on('error', (err: any) => {
      reject(err)
    })

    conn.connect(createConnectionConfig(config))
  })
}

/**
 * 通过 SSH 上传字符串内容到远程服务器文件
 *
 * @param config - SSH 配置
 * @param content - 文件内容
 * @param remotePath - 远程文件路径
 * @param mode - 文件权限，默认为 0644
 *
 * @example
 * ```typescript
 * await uploadContent({
 *   host: '192.168.1.100',
 *   username: 'ubuntu',
 *   password: 'your-password'
 * }, 'echo "hello world"', '/tmp/script.sh', 0o755)
 * ```
 */
export async function uploadContent(
  config: SSHConfig,
  content: string,
  remotePath: string,
  mode: number = 0o644
): Promise<void> {
  // 使用 base64 编码避免特殊字符问题
  const base64Content = Buffer.from(content).toString('base64')
  const modeOctal = mode.toString(8)

  // 先写入文件
  await execSSH(config, `echo '${base64Content}' | base64 -d > ${remotePath}`)
  // 设置文件权限
  await execSSH(config, `chmod ${modeOctal} ${remotePath}`)
}

/**
 * 通过 SSH 上传并执行脚本
 *
 * 通过 SFTP 上传脚本文件到远程服务器，然后执行该脚本
 *
 * @param config - SSH 配置
 * @param scriptContent - 脚本内容
 * @param remotePath - 远程脚本文件路径
 * @param useSudo - 是否使用 sudo 执行，默认为 true
 * @returns 脚本执行输出（stdout）
 *
 * @example
 * ```typescript
 * const output = await uploadAndExecScript({
 *   host: '192.168.1.100',
 *   username: 'ubuntu',
 *   password: 'your-password'
 * }, '#!/bin/bash\necho "Hello World"', '/tmp/hello.sh')
 * ```
 */
export async function uploadAndExecScript(
  config: SSHConfig,
  scriptContent: string,
  remotePath: string,
  useSudo: boolean = true
): Promise<string> {
  // 上传脚本文件并设置可执行权限
  await uploadContent(config, scriptContent, remotePath, 0o755)

  // 执行脚本
  const command = useSudo ? `sudo bash ${remotePath}` : `bash ${remotePath}`
  return await execSSH(config, command)
}
