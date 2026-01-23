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

/**
 * 上传内容参数
 */
export interface UploadContentParams {
  /** SSH 配置 */
  config: SSHConfig
  /** 文件内容 */
  content: string
  /** 远程文件路径 */
  remotePath: string
  /** 文件权限，默认为 0644 */
  mode?: number
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 带重试的异步函数执行器
 *
 * @param fn - 要执行的异步函数
 * @param maxRetries - 最大重试次数，默认 3 次
 * @param delay - 重试延迟时间（毫秒），默认 2000ms
 * @param operationName - 操作名称，用于日志输出
 * @returns 函数执行结果
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000,
  operationName: string = '操作'
): Promise<T> {
  let lastError: any

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error

      if (attempt < maxRetries) {
        console.warn(`  [${operationName}] 第 ${attempt} 次尝试失败: ${error.message}`)
        console.warn(`  [${operationName}] 等待 ${delay / 1000} 秒后重试...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw new Error(`${operationName} 失败，已重试 ${maxRetries} 次: ${lastError.message}`)
}

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
    // 增加连接超时时间（默认是较短的超时）
    readyTimeout: 60000,  // 60 秒
    // 增加各种超时设置
    algorithms: {
      kex: [
        'diffie-hellman-group1-sha1',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'curve25519-sha256@libssh.org'
      ]
    }
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

/**
 * SSH 执行命令的内部实现（不带重试）
 */
function execSSHInternal(config: SSHConfig, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let stdout = ''
    let stderr = ''
    const connectionConfig = createConnectionConfig(config)

    console.log(`  [SSH] 连接到 ${config.host}...`)

    conn
      .on('ready', () => {
        console.log(`  [SSH] ${config.host} 连接成功`)
        conn.exec(command, (err: any, stream: any) => {
          if (err) {
            conn.end()
            return reject(new Error(`执行命令失败: ${err.message}`))
          }

          console.log(`  [SSH] ${config.host} 执行命令: ${command.substring(0, 50)}${command.length > 50 ? '...' : ''}`)

          stream
            .on('close', (code: number) => {
              conn.end()
              if (code === 0) {
                console.log(`  [SSH] ${config.host} 命令执行成功`)
                resolve(stdout)
              } else {
                const errorMsg = `命令执行失败，退出码 ${code}: ${stderr}`
                console.error(`  [SSH] ${config.host} ${errorMsg}`)
                reject(new Error(errorMsg))
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
        console.error(`  [SSH] ${config.host} 连接错误: ${err.message}`)
        reject(err)
      })
      .on('close', () => {
        // 连接关闭时的调试信息
        console.log(`  [SSH] ${config.host} 连接已关闭`)
      })

    try {
      conn.connect(connectionConfig)
    } catch (error: any) {
      reject(new Error(`连接失败: ${error.message}`))
    }
  })
}

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 通过 SSH 在远程服务器上执行命令（带重试机制）
 *
 * @param config - SSH 配置
 * @param command - 要执行的命令
 * @param maxRetries - 最大重试次数，默认 3 次
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
export function execSSH(config: SSHConfig, command: string, maxRetries: number = 3): Promise<string> {
  return withRetry(
    () => execSSHInternal(config, command),
    maxRetries,
    2000,
    `SSH 执行命令 [${config.host}]`
  )
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
 * 通过 SSH 上传字符串内容到远程服务器文件（使用 SFTP）
 *
 * @param params - 上传参数对象
 * @returns Promise
 *
 * @example
 * ```typescript
 * await uploadContent({
 *   config: {
 *     host: '192.168.1.100',
 *     username: 'ubuntu',
 *     password: 'your-password'
 *   },
 *   content: 'echo "hello world"',
 *   remotePath: '/tmp/script.sh',
 *   mode: 0o755
 * })
 * ```
 */
export function uploadContent(params: UploadContentParams): Promise<void> {
  const { config, content, remotePath, mode = 0o644 } = params

  return new Promise((resolve, reject) => {
    const conn = new Client()
    const connectionConfig = createConnectionConfig(config)

    console.log(`  [SFTP] 连接到 ${config.host}...`)

    conn
      .on('ready', () => {
        console.log(`  [SFTP] ${config.host} 连接成功`)
        conn.sftp((err: any, sftp: any) => {
          if (err) {
            conn.end()
            return reject(new Error(`SFTP 会话创建失败: ${err.message}`))
          }

          console.log(`  [SFTP] ${config.host} 上传文件: ${remotePath}`)

          // 将字符串转换为 Buffer
          const contentBuffer = Buffer.from(content, 'utf-8')

          // 使用 WriteStream 上传文件
          const writeStream = sftp.createWriteStream(remotePath, {
            mode: mode,
            encoding: 'utf-8'
          })

          writeStream
            .on('close', () => {
              console.log(`  [SFTP] ${config.host} 文件上传成功`)
              conn.end()
              resolve()
            })
            .on('error', (err: any) => {
              console.error(`  [SFTP] ${config.host} 上传失败: ${err.message}`)
              conn.end()
              reject(err)
            })

          // 写入内容并关闭流
          writeStream.write(contentBuffer)
          writeStream.end()
        })
      })
      .on('error', (err: any) => {
        console.error(`  [SFTP] ${config.host} 连接错误: ${err.message}`)
        reject(err)
      })
      .on('close', () => {
        console.log(`  [SFTP] ${config.host} 连接已关闭`)
      })

    try {
      conn.connect(connectionConfig)
    } catch (error: any) {
      reject(new Error(`连接失败: ${error.message}`))
    }
  })
}

/**
 * 通过 SSH 上传并执行脚本（带重试机制）
 *
 * 通过 SFTP 上传脚本文件到远程服务器，然后执行该脚本
 *
 * @param config - SSH 配置
 * @param scriptContent - 脚本内容
 * @param remotePath - 远程脚本文件路径
 * @param useSudo - 是否使用 sudo 执行，默认为 true
 * @param maxRetries - 最大重试次数，默认 3 次
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
  useSudo: boolean = true,
  maxRetries: number = 3
): Promise<string> {
  return withRetry(
    async () => {
      // 上传脚本文件并设置可执行权限
      await uploadContent({
        config,
        content: scriptContent,
        remotePath,
        mode: 0o755
      })

      // 执行脚本（这里使用 0 重试，因为外层已经有重试了）
      const command = useSudo ? `sudo bash ${remotePath}` : `bash ${remotePath}`
      return await execSSHInternal(config, command)
    },
    maxRetries,
    2000,
    `上传并执行脚本 [${config.host}]`
  )
}
