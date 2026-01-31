/**
 * SSH 远程执行模块
 *
 * 提供远程服务器 SSH 连接和命令/脚本执行功能。
 *
 * @module server/kube/ssh
 */

import { Client } from 'ssh2'
import { readFileSync } from 'fs'
import { basename } from 'path'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * SSH 连接配置
 */
export interface SSHConfig {
    /** 服务器 IP 地址 */
    serverIP: string
    /** SSH 端口，默认 22 */
    sshPort?: number
    /** SSH 用户名，默认 'ubuntu' */
    sshUser?: string
    /** SSH 私钥内容（字符串） */
    sshPubKey?: string
    /** SSH 私钥文件路径 */
    sshPubKeyPath?: string
    /** SSH 密码 */
    sshPasswd?: string
}

/**
 * 执行选项
 */
export interface ExecutionOptions {
    /** 重试次数，默认 3 */
    retries?: number
    /** 超时时间（毫秒），默认 5 分钟 */
    timeout?: number
    /** 标准输出回调 */
    onStdout?: (data: string) => void
    /** 错误输出回调 */
    onStderr?: (data: string) => void
}

/**
 * 执行结果
 */
export interface ExecutionResult {
    /** 是否成功 */
    success: boolean
    /** 执行消息 */
    message: string
    /** 标准输出内容 */
    stdout: string
    /** 错误输出内容 */
    stderr: string
    /** 退出码 */
    exitCode: number
}

// ============================================================================
// SSH Client 类
// ============================================================================

/**
 * SSH 客户端类
 *
 * 提供远程命令和脚本执行功能。
 *
 * @example
 * ```typescript
 * const ssh = createSSHClient({
 *   serverIP: '192.168.1.10',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey
 * })
 *
 * // 执行命令
 * const result1 = await ssh.exec('ls -la')
 *
 * // 执行脚本
 * const result2 = await ssh.script('/path/to/script.sh', ['arg1', 'arg2'])
 * ```
 */
export class SSHClient {
    private serverIP: string
    private sshPort: number
    private sshUser: string
    private authConfig: { sshPubKey?: string; sshPubKeyPath?: string; sshPasswd?: string }

    constructor(config: SSHConfig) {
        this.serverIP = config.serverIP
        this.sshPort = config.sshPort ?? 22
        this.sshUser = config.sshUser ?? 'ubuntu'
        this.authConfig = {
            sshPubKey: config.sshPubKey,
            sshPubKeyPath: config.sshPubKeyPath,
            sshPasswd: config.sshPasswd
        }
    }

    /**
     * 执行命令
     *
     * @param command - 要执行的 shell 命令
     * @param options - 执行选项
     * @returns 执行结果
     */
    async exec(command: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
        return this.executeWithRetry(command, undefined, options)
    }

    /**
     * 执行脚本
     *
     * @param scriptPath - 本地脚本文件的绝对路径
     * @param args - 传递给脚本的参数数组
     * @param options - 执行选项
     * @returns 执行结果
     */
    async script(scriptPath: string, args: string[] = [], options: ExecutionOptions = {}): Promise<ExecutionResult> {
        return this.executeWithRetry(undefined, { scriptPath, args }, options)
    }

    /**
     * 核心执行逻辑（带重试）
     */
    private async executeWithRetry(
        command?: string,
        script?: { scriptPath: string; args?: string[] },
        options: ExecutionOptions = {}
    ): Promise<ExecutionResult> {
        const { retries = 3, timeout = 5 * 60 * 1000, onStdout, onStderr } = options
        let lastError: string = ''

        for (let attempt = 1; attempt <= retries; attempt++) {
            const result = await this.executeOnce(command, script, { timeout, onStdout, onStderr })

            if (result.success) {
                return result
            }

            lastError = result.message

            if (attempt < retries) {
                await this.delay(2000)
            }
        }

        return {
            success: false,
            message: `执行失败（已重试 ${retries} 次）: ${lastError}`,
            stdout: '',
            stderr: '',
            exitCode: -1
        }
    }

    /**
     * 单次执行
     */
    private async executeOnce(
        command?: string,
        script?: { scriptPath: string; args?: string[] },
        callbacks?: { timeout?: number; onStdout?: (data: string) => void; onStderr?: (data: string) => void }
    ): Promise<ExecutionResult> {
        // 如果是脚本执行，先上传再执行
        if (script) {
            return this.executeScriptViaSFTP(script.scriptPath, script.args || [], callbacks)
        }

        // 普通命令执行
        return this.executeCommand(command!, callbacks)
    }

    /**
     * 通过 SFTP 上传并执行脚本
     */
    private async executeScriptViaSFTP(
        scriptPath: string,
        args: string[],
        callbacks?: { timeout?: number; onStdout?: (data: string) => void; onStderr?: (data: string) => void }
    ): Promise<ExecutionResult> {
        const remotePath = `/tmp/${basename(scriptPath)}.${Date.now()}.sh`

        return new Promise((resolve) => {
            const conn = new Client()

            conn.on('ready', () => {
                // 先通过 SFTP 上传脚本
                conn.sftp((err, sftp) => {
                    if (err) {
                        conn.end()
                        resolve({
                            success: false,
                            message: `SFTP会话创建失败: ${err.message}`,
                            stdout: '',
                            stderr: '',
                            exitCode: -1
                        })
                        return
                    }

                    // 读取本地脚本内容
                    const scriptContent = readFileSync(scriptPath, 'utf-8')

                    // 上传文件到远程服务器
                    sftp.writeFile(remotePath, scriptContent, { mode: 0o755 }, (writeErr) => {
                        if (writeErr) {
                            sftp.end()
                            conn.end()
                            resolve({
                                success: false,
                                message: `脚本上传失败: ${writeErr.message}`,
                                stdout: '',
                                stderr: '',
                                exitCode: -1
                            })
                            return
                        }

                        // 构建执行命令
                        const argsStr = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ')
                        const fullCommand = `bash ${remotePath} ${argsStr}`

                        // 执行脚本
                        conn.exec(fullCommand, { pty: true }, (execErr, stream) => {
                            // 确保关闭 SFTP 会话
                            sftp.end()

                            if (execErr) {
                                conn.end()
                                resolve({
                                    success: false,
                                    message: `执行失败: ${execErr.message}`,
                                    stdout: '',
                                    stderr: '',
                                    exitCode: -1
                                })
                                return
                            }

                            let stdout = ''
                            let stderr = ''

                            // 收集标准输出
                            stream.stdout.on('data', (data: Buffer) => {
                                const text = data.toString()
                                stdout += text
                                callbacks?.onStdout?.(text)
                            })

                            // 收集错误输出
                            stream.stderr.on('data', (data: Buffer) => {
                                const text = data.toString()
                                stderr += text
                                callbacks?.onStderr?.(text)
                            })

                            // 设置超时
                            const timeout = callbacks?.timeout ? setTimeout(() => {
                                // 清理远程文件
                                conn.exec(`rm -f ${remotePath}`, () => {})
                                conn.end()
                                resolve({
                                    success: false,
                                    message: '命令执行超时',
                                    stdout,
                                    stderr: 'Command timeout',
                                    exitCode: -1
                                })
                            }, callbacks.timeout) : undefined

                            // 命令执行结束回调
                            stream.on('close', (code: number) => {
                                if (timeout) clearTimeout(timeout)

                                // 清理远程临时文件
                                conn.exec(`rm -f ${remotePath}`, () => {
                                    conn.end()
                                    resolve({
                                        success: code === 0,
                                        message: code === 0 ? '执行成功' : `执行失败，退出码: ${code}`,
                                        stdout,
                                        stderr,
                                        exitCode: code
                                    })
                                })
                            })
                        })
                    })
                })
            })

            conn.on('error', (err) => {
                resolve({
                    success: false,
                    message: `SSH连接失败: ${err.message}`,
                    stdout: '',
                    stderr: '',
                    exitCode: -1
                })
            })

            // 建立连接
            try {
                const connConfig = this.buildConnectionConfig()
                conn.connect(connConfig)
            } catch (err) {
                resolve({
                    success: false,
                    message: (err as Error).message,
                    stdout: '',
                    stderr: '',
                    exitCode: -1
                })
            }
        })
    }

    /**
     * 执行普通命令
     */
    private async executeCommand(
        command: string,
        callbacks?: { timeout?: number; onStdout?: (data: string) => void; onStderr?: (data: string) => void }
    ): Promise<ExecutionResult> {
        return new Promise((resolve) => {
            const conn = new Client()

            conn.on('ready', () => {
                conn.exec(command, { pty: true }, (err, stream) => {
                    if (err) {
                        conn.end()
                        resolve({
                            success: false,
                            message: `执行失败: ${err.message}`,
                            stdout: '',
                            stderr: '',
                            exitCode: -1
                        })
                        return
                    }

                    let stdout = ''
                    let stderr = ''

                    // 收集标准输出
                    stream.stdout.on('data', (data: Buffer) => {
                        const text = data.toString()
                        stdout += text
                        callbacks?.onStdout?.(text)
                    })

                    // 收集错误输出
                    stream.stderr.on('data', (data: Buffer) => {
                        const text = data.toString()
                        stderr += text
                        callbacks?.onStderr?.(text)
                    })

                    // 设置超时
                    const timeout = callbacks?.timeout ? setTimeout(() => {
                        conn.end()
                        resolve({
                            success: false,
                            message: '命令执行超时',
                            stdout,
                            stderr: 'Command timeout',
                            exitCode: -1
                        })
                    }, callbacks.timeout) : undefined

                    // 命令执行结束回调
                    stream.on('close', (code: number) => {
                        if (timeout) clearTimeout(timeout)
                        conn.end()
                        resolve({
                            success: code === 0,
                            message: code === 0 ? '执行成功' : `执行失败，退出码: ${code}`,
                            stdout,
                            stderr,
                            exitCode: code
                        })
                    })
                })
            })

            conn.on('error', (err) => {
                resolve({
                    success: false,
                    message: `SSH连接失败: ${err.message}`,
                    stdout: '',
                    stderr: '',
                    exitCode: -1
                })
            })

            // 建立连接
            try {
                const connConfig = this.buildConnectionConfig()
                conn.connect(connConfig)
            } catch (err) {
                resolve({
                    success: false,
                    message: (err as Error).message,
                    stdout: '',
                    stderr: '',
                    exitCode: -1
                })
            }
        })
    }

    /**
     * 构建 SSH 连接配置
     */
    private buildConnectionConfig(): any {
        const connConfig: any = {
            host: this.serverIP,
            port: this.sshPort,
            username: this.sshUser,
            readyTimeout: 60000,
            keepaliveInterval: 10000
        }

        // 优先使用密钥认证（按优先级：sshPubKey > sshPubKeyPath > sshPasswd）
        if (this.authConfig.sshPubKey) {
            connConfig.privateKey = this.authConfig.sshPubKey
        } else if (this.authConfig.sshPubKeyPath) {
            connConfig.privateKey = readFileSync(this.authConfig.sshPubKeyPath, 'utf-8')
        } else if (this.authConfig.sshPasswd) {
            connConfig.password = this.authConfig.sshPasswd
        } else {
            throw new Error('未提供SSH认证信息（密钥或密码）')
        }

        return connConfig
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 SSH 客户端实例
 *
 * @param config - SSH 连接配置
 * @returns SSHClient 实例
 *
 * @example
 * ```typescript
 * const ssh = createSSHClient({
 *   serverIP: '192.168.1.10',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey
 * })
 *
 * await ssh.exec('ls -la')
 * ```
 */
export function createSSHClient(config: SSHConfig): SSHClient {
    return new SSHClient(config)
}
