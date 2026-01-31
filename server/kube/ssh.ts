/**
 * SSH 远程执行模块
 *
 * 提供远程服务器 SSH 连接和命令/脚本执行功能。
 *
 * @module server/kube/ssh
 */

import { Client } from 'ssh2'
import { readFileSync } from 'fs'

// ============================================================================
// 基础 SSH 操作函数
// ============================================================================

/**
 * 在远程服务器执行命令（带重试机制）
 *
 * 通过 SSH 连接到远程服务器并执行指定的 shell 命令，支持自动重试。
 * 适用于执行简单的单行命令，如查询系统状态、操作文件等。
 *
 * @param params - SSH 连接和命令参数
 * @param params.serverIP - 服务器 IP 地址
 * @param params.command - 要执行的 shell 命令
 * @param params.sshPort - SSH 端口，默认 22
 * @param params.sshUser - SSH 用户名，默认 'ubuntu'
 * @param params.sshPubKey - SSH 私钥内容（字符串）
 * @param params.sshPubKeyPath - SSH 私钥文件路径
 * @param params.sshPasswd - SSH 密码
 * @param params.retries - 重试次数，默认 3 次
 * @param params.onStdout - 标准输出回调函数
 * @param params.onStderr - 错误输出回调函数
 *
 * @returns 执行结果
 * @returns {boolean} success - 命令是否成功执行（退出码为 0）
 * @returns {string} message - 执行结果描述
 * @returns {string} [stdout] - 标准输出内容
 * @returns {string} [stderr] - 错误输出内容
 *
 * @example
 * ```typescript
 * // 查询系统版本
 * const result = await execRemoteCommand({
 *   serverIP: '192.168.1.10',
 *   command: 'cat /etc/os-release',
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey,
 *   onStdout: (data) => console.log(data),
 *   onStderr: (data) => console.error(data)
 * })
 *
 * if (result.success) {
 *   console.log(result.stdout)
 * }
 * ```
 */
export async function execRemoteCommand(params: {
    serverIP: string,
    command: string,
    sshPort?: number,
    sshUser?: string,
    sshPubKey?: string,
    sshPubKeyPath?: string,
    sshPasswd?: string,
    retries?: number,
    onStdout?: (data: string) => void,
    onStderr?: (data: string) => void
}): Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }> {
    const {
        serverIP,
        command,
        sshPort = 22,
        sshUser = 'ubuntu',
        sshPubKey,
        sshPubKeyPath,
        sshPasswd,
        retries = 3,
        onStdout,
        onStderr
    } = params

    /**
     * 执行单次远程命令（内部函数）
     *
     * 通过 SSH 执行单次命令，不包含重试逻辑。
     */
    const execCommandOnce = (): Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }> => {
        return new Promise((resolve) => {
            const conn = new Client()

            // SSH 连接成功回调
            conn.on('ready', () => {
                // 执行命令
                conn.exec(command, (err, stream) => {
                    if (err) {
                        conn.end()
                        resolve({
                            success: false,
                            message: `执行命令失败: ${err.message}`
                        })
                        return
                    }

                    let stdout = ''
                    let stderr = ''

                    // 命令执行结束回调
                    stream.on('close', (code: number) => {
                        conn.end()
                        resolve({
                            success: code === 0,
                            message: code === 0 ? '命令执行成功' : `命令执行失败，退出码: ${code}`,
                            stdout,
                            stderr
                        })
                    })

                    // 收集错误输出
                    stream.stderr.on('data', (data: Buffer) => {
                        const text = data.toString()
                        stderr += text
                        onStderr?.(text)
                    })

                    // 收集标准输出
                    stream.stdout.on('data', (data: Buffer) => {
                        const text = data.toString()
                        stdout += text
                        onStdout?.(text)
                    })
                })
            })

            // SSH 连接错误回调
            conn.on('error', (err) => {
                resolve({
                    success: false,
                    message: `SSH连接失败: ${err.message}`
                })
            })

            // 准备连接配置
            const connConfig: any = {
                host: serverIP,
                port: sshPort,
                username: sshUser,
                readyTimeout: 60000,      // SSH 连接超时：60 秒
                keepaliveInterval: 10000,  // 保持连接间隔：10 秒
            }

            // 优先使用密钥认证（按优先级：sshPubKey > sshPubKeyPath > sshPasswd）
            if (sshPubKey) {
                connConfig.privateKey = sshPubKey
            } else if (sshPubKeyPath) {
                try {
                    connConfig.privateKey = readFileSync(sshPubKeyPath, 'utf-8')
                } catch (err) {
                    resolve({
                        success: false,
                        message: `读取SSH密钥文件失败: ${(err as Error).message}`
                    })
                    return
                }
            } else if (sshPasswd) {
                connConfig.password = sshPasswd
            } else {
                resolve({
                    success: false,
                    message: '未提供SSH认证信息（密钥或密码）'
                })
                return
            }

            // 建立 SSH 连接
            conn.connect(connConfig)
        })
    }

    let lastError: string = ''

    // 循环重试
    for (let attempt = 1; attempt <= retries; attempt++) {
        const result = await execCommandOnce()

        // 如果成功，直接返回结果
        if (result.success) {
            return result
        }

        lastError = result.message

        // 如果还有重试次数，等待 2 秒后重试
        if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }

    // 所有重试都失败，返回错误信息
    return {
        success: false,
        message: `命令执行失败（已重试 ${retries} 次）: ${lastError}`
    }
}

// ============================================================================
// 远程脚本执行函数
// ============================================================================

/**
 * SSH连接并执行远程脚本的通用函数（带重试机制）
 *
 * 读取本地脚本文件内容，通过 SSH 在远程服务器上执行。
 * 适用于执行复杂的多行脚本，如安装软件、配置系统等。
 *
 * @param params - SSH 连接和脚本参数
 * @param params.serverIP - 服务器 IP 地址
 * @param params.scriptPath - 本地脚本文件的绝对路径
 * @param params.args - 传递给脚本的参数数组
 * @param params.sshPort - SSH 端口，默认 22
 * @param params.sshUser - SSH 用户名，默认 'ubuntu'
 * @param params.sshPubKey - SSH 私钥内容（字符串）
 * @param params.sshPubKeyPath - SSH 私钥文件路径
 * @param params.sshPasswd - SSH 密码
 * @param params.retries - 重试次数，默认 3 次
 * @param params.onStdout - 标准输出回调函数
 * @param params.onStderr - 错误输出回调函数
 *
 * @returns 执行结果
 * @returns {boolean} success - 脚本是否成功执行（退出码为 0）
 * @returns {string} message - 执行结果描述
 * @returns {string} [stdout] - 标准输出内容
 * @returns {string} [stderr] - 错误输出内容
 *
 * @example
 * ```typescript
 * const result = await runRemoteScript({
 *   serverIP: '192.168.1.10',
 *   scriptPath: '/path/to/script.sh',
 *   args: ['arg1', 'arg2'],
 *   sshUser: 'ubuntu',
 *   sshPubKey: privateKey,
 *   onStdout: (data) => console.log(data),
 *   onStderr: (data) => console.error(data)
 * })
 * ```
 */
export async function runRemoteScript(params: {
    serverIP: string,
    sshPort?: number,
    sshUser?: string,
    sshPubKey?: string,
    sshPubKeyPath?: string,
    sshPasswd?: string,
    scriptPath: string,
    args?: string[],
    retries?: number,
    onStdout?: (data: string) => void,
    onStderr?: (data: string) => void
}): Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }> {
    const {
        serverIP,
        sshPort = 22,
        sshUser = 'ubuntu',
        sshPubKey,
        sshPubKeyPath,
        sshPasswd,
        scriptPath,
        args = [],
        retries = 3,
        onStdout,
        onStderr
    } = params

    /**
     * 执行单次远程脚本（内部函数）
     *
     * 读取脚本文件内容并通过 SSH 执行，不包含重试逻辑。
     */
    const runScriptOnce = (): Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }> => {
        return new Promise((resolve) => {
            const conn = new Client()

            // SSH 连接成功回调
            conn.on('ready', () => {
                // 读取本地脚本文件内容
                const scriptContent = readFileSync(scriptPath, 'utf-8')

                // 构建完整的命令（使用交互式 bash）
                // 设置 -e 遇到错误立即退出
                const argsStr = args.map(arg => `'${arg}'`).join(' ')
                const command = `bash -ec '
set -e
${scriptContent.split('\n').map(line => '  ' + line).join('\n')}
' ${argsStr}`

                // 使用 shell 模式执行（类似交互式终端）
                conn.exec(command, {
                    pty: true  // 使用伪终端，提供完整的交互式环境
                }, (err, stream) => {
                    if (err) {
                        conn.end()
                        resolve({
                            success: false,
                            message: `执行脚本失败: ${err.message}`
                        })
                        return
                    }

                    let stdout = ''
                    let stderr = ''

                    // 收集标准输出
                    stream.stdout.on('data', (data: Buffer) => {
                        const text = data.toString()
                        stdout += text
                        onStdout?.(text)
                    })

                    // 收集错误输出
                    stream.stderr.on('data', (data: Buffer) => {
                        const text = data.toString()
                        stderr += text
                        onStderr?.(text)
                    })

                    // 设置超时（5 分钟），防止长时间运行的命令卡住
                    const timeout = setTimeout(() => {
                        conn.end()
                        resolve({
                            success: false,
                            message: '命令执行超时（5分钟）',
                            stdout,
                            stderr: 'Command timeout'
                        })
                    }, 5 * 60 * 1000)

                    // 命令执行结束回调
                    stream.on('close', (code: number) => {
                        clearTimeout(timeout)
                        conn.end()
                        resolve({
                            success: code === 0,
                            message: code === 0 ? '脚本执行成功' : `脚本执行失败，退出码: ${code}`,
                            stdout,
                            stderr
                        })
                    })
                })
            })

            // SSH 连接错误回调
            conn.on('error', (err) => {
                resolve({
                    success: false,
                    message: `SSH连接失败: ${err.message}`
                })
            })

            // 准备连接配置
            const connConfig: any = {
                host: serverIP,
                port: sshPort,
                username: sshUser,
                readyTimeout: 60000,      // SSH 连接超时：60 秒
                keepaliveInterval: 10000,  // 保持连接间隔：10 秒
            }

            // 优先使用密钥认证（按优先级：sshPubKey > sshPubKeyPath > sshPasswd）
            if (sshPubKey) {
                connConfig.privateKey = sshPubKey
            } else if (sshPubKeyPath) {
                try {
                    connConfig.privateKey = readFileSync(sshPubKeyPath, 'utf-8')
                } catch (err) {
                    resolve({
                        success: false,
                        message: `读取SSH密钥文件失败: ${(err as Error).message}`
                    })
                    return
                }
            } else if (sshPasswd) {
                connConfig.password = sshPasswd
            } else {
                resolve({
                    success: false,
                    message: '未提供SSH认证信息（密钥或密码）'
                })
                return
            }

            // 建立 SSH 连接
            conn.connect(connConfig)
        })
    }

    let lastError: string = ''

    // 循环重试
    for (let attempt = 1; attempt <= retries; attempt++) {
        const result = await runScriptOnce()

        // 如果成功，直接返回结果
        if (result.success) {
            return result
        }

        lastError = result.message

        // 如果还有重试次数，等待 2 秒后重试
        if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }

    // 所有重试都失败，返回错误信息
    return {
        success: false,
        message: `脚本执行失败（已重试 ${retries} 次）: ${lastError}`
    }
}
