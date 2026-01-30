import { Client } from 'ssh2'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 在远程服务器执行命令
 * @param params SSH连接参数和命令
 * @returns Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }>
 */
export async function execRemoteCommand(params: {
    serverIP: string,
    command: string,
    sshPort?: number,
    sshUser?: string,
    sshPubKey?: string,
    sshPubKeyPath?: string,
    sshPasswd?: string
}): Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }> {
    const {
        serverIP,
        command,
        sshPort = 22,
        sshUser = 'root',
        sshPubKey,
        sshPubKeyPath,
        sshPasswd
    } = params

    return new Promise((resolve) => {
        const conn = new Client()

        conn.on('ready', () => {
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

                stream.on('close', (code: number) => {
                    conn.end()
                    resolve({
                        success: code === 0,
                        message: code === 0 ? '命令执行成功' : `命令执行失败，退出码: ${code}`,
                        stdout,
                        stderr
                    })
                })

                stream.stderr.on('data', (data: Buffer) => {
                    stderr += data.toString()
                })

                stream.stdout.on('data', (data: Buffer) => {
                    stdout += data.toString()
                })
            })
        })

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
        }

        // 优先使用密钥认证
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

        conn.connect(connConfig)
    })
}

/**
 * SSH连接并执行远程脚本的通用函数
 * @param params SSH连接参数和脚本信息
 * @returns Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }>
 */
export async function runRemoteScript(params: {
    serverIP: string,
    sshPort?: number,
    sshUser?: string,
    sshPubKey?: string,
    sshPubKeyPath?: string,
    sshPasswd?: string,
    scriptPath: string,
    args?: string[]
}): Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }> {
    const {
        serverIP,
        sshPort = 22,
        sshUser = 'root',
        sshPubKey,
        sshPubKeyPath,
        sshPasswd,
        scriptPath,
        args = []
    } = params

    return new Promise((resolve) => {
        const conn = new Client()

        conn.on('ready', () => {
            // 读取脚本内容
            const scriptContent = readFileSync(scriptPath, 'utf-8')

            // 构建完整的命令（脚本内容 + 参数）
            const argsStr = args.map(arg => `'${arg}'`).join(' ')
            const command = `${scriptContent} ${argsStr}`

            conn.exec(command, (err, stream) => {
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

                stream.on('close', (code: number) => {
                    conn.end()
                    resolve({
                        success: code === 0,
                        message: code === 0 ? '脚本执行成功' : `脚本执行失败，退出码: ${code}`,
                        stdout,
                        stderr
                    })
                })

                stream.stderr.on('data', (data: Buffer) => {
                    stderr += data.toString()
                })

                stream.stdout.on('data', (data: Buffer) => {
                    stdout += data.toString()
                })
            })
        })

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
        }

        // 优先使用密钥认证
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

        conn.connect(connConfig)
    })
}

/**
 * 在远程服务器安装clash
 * @param installClashParams
 * @returns Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }>
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
 * 在远程服务器初始化k3s集群（master节点）
 * @param initK3sParams
 * @returns Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }>
 */
export async function initK3s(initK3sParams: {
    serverIP: string,
    k3sToken?: string,
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
        args: k3sToken ? [k3sToken] : []
    })
}

/**
 * 在远程服务器加入k3s集群（作为master节点）
 * @param joinK3sMasterParams
 * @returns Promise<{ success: boolean; message: string; stdout?: string; stderr?: string }>
 */
export async function joinK3sMaster(joinK3sMasterParams: {
    serverIP: string,
    masterIP: string,
    k3sToken?: string,
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
        args: k3sToken ? [k3sToken, masterIP] : [masterIP]
    })
}