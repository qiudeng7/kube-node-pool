/**
 * 测试腾讯云模块和 K3s 集群创建
 *
 * 测试流程：
 * 1. 通过 dotenv 读取腾讯云密钥
 * 2. 创建所有节点（第一个为 master，其他为 master 节点）
 * 3. 等待所有服务器就绪
 * 4. 在第一个 master 节点上初始化 K3s 集群
 * 5. 并行在其他 master 节点上加入集群
 * 6. 在所有节点上安装 Clash 代理
 * 7. 查询集群节点状态
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { TencentCloud } from '../server/cloudVendor/tencentCloud/index.js'
import type { ServerInfo } from '../server/cloudVendor/interface.js'
import { initK3s, joinK3sMaster } from '../server/kube/index.js'
import { createSSHClient } from '../server/ssh.js'

// ============================================================================
// 配置
// ============================================================================

const CONFIG = {
  // 腾讯云配置
  TEMPLATE_ID: 'lt-hlk4agum',
  REGION: 'ap-nanjing',

  // K3s 集群配置
  K3S_TOKEN: '123456',
  MASTER_COUNT: 3,  // master 节点数量

  // SSH 配置
  SSH_PRIVATE_KEY_PATH: join(process.env.HOME || '', '.ssh/id_rsa'),
  SSH_USER: 'ubuntu',

  // Clash 配置
  CLASH_SUBSCRIPTION_URL: process.env.CLASH_SUBSCRIPTION_URL || '',

  // 日志配置
  LOGS_DIR: join(process.cwd(), 'logs'),
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 移除 ANSI 转义序列（终端颜色代码等）
 *
 * @param text - 包含 ANSI 转义序列的文本
 * @returns 清理后的文本
 */
function stripAnsiCodes(text: string): string {
  // 移除所有 ANSI 转义序列
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * 将执行信息写入日志文件
 *
 * @param operation - 操作名称（如 initK3s, joinK3sMaster）
 * @param serverName - 服务器名称
 * @param serverIP - 服务器 IP
 * @param command - 执行的命令（可选）
 * @param retries - 重试次数（可选）
 * @param stdout - 标准输出
 * @param stderr - 错误输出
 */
function logExecution(
  operation: string,
  serverName: string,
  serverIP: string,
  command?: string,
  retries?: number,
  stdout?: string,
  stderr?: string
) {
  try {
    // 确保 logs 目录存在
    mkdirSync(CONFIG.LOGS_DIR, { recursive: true })

    // 生成日志文件名（包含时间戳）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logFileName = `${operation}_${serverName}_${timestamp}.log`
    const logFilePath = join(CONFIG.LOGS_DIR, logFileName)

    // 清理输出中的 ANSI 转义序列
    const cleanStdout = stdout ? stripAnsiCodes(stdout) : ''
    const cleanStderr = stderr ? stripAnsiCodes(stderr) : ''

    // 写入日志
    const logContent = [
      `Operation: ${operation}`,
      `Server: ${serverName} (${serverIP})`,
      `Time: ${new Date().toISOString()}`,
      command ? `Command: ${command}` : '',
      retries !== undefined ? `Retries: ${retries}` : '',
      '',
      cleanStdout ? `STDOUT:\n${cleanStdout}` : '',
      cleanStderr ? `STDERR:\n${cleanStderr}` : '',
    ].filter(Boolean).join('\n')

    writeFileSync(logFilePath, logContent, 'utf-8')
    console.log(`  日志已保存到: ${logFilePath}`)
  } catch (err) {
    console.warn(`  无法保存日志: ${(err as Error).message}`)
  }
}

/**
 * 创建日志回调函数
 *
 * @param operation - 操作名称
 * @param serverName - 服务器名称
 * @param serverIP - 服务器 IP
 * @returns 包含 onStdout、onStderr、setCommand、setRetries 和 saveLog 的对象
 */
function createLogCallbacks(operation: string, serverName: string, serverIP: string) {
  let stdout = ''
  let stderr = ''
  let command: string | undefined
  let retries: number | undefined

  return {
    onStdout: (data: string) => {
      stdout += data
    },
    onStderr: (data: string) => {
      stderr += data
    },
    setCommand: (cmd: string) => {
      command = cmd
    },
    setRetries: (count: number) => {
      retries = count
    },
    saveLog: () => logExecution(operation, serverName, serverIP, command, retries, stdout, stderr)
  }
}

// 从环境变量读取腾讯云密钥
const tencentSecretId = process.env.tencentSecretId
const tencentSecretKey = process.env.tencentSecretKey

if (!tencentSecretId || !tencentSecretKey || !CONFIG.CLASH_SUBSCRIPTION_URL) {
  console.error('错误: 请在 .env 文件中设置 tencentSecretId, tencentSecretKey, CLASH_SUBSCRIPTION_URL')
  process.exit(1)
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 等待服务器就绪
 *
 * @param tencentCloud - 腾讯云客户端
 * @param instanceId - 实例 ID
 * @param maxAttempts - 最大尝试次数，默认 60 次（2 分钟）
 * @returns 服务器信息
 */
async function waitForServerReady(
  tencentCloud: TencentCloud,
  instanceId: string,
  maxAttempts: number = 60
): Promise<ServerInfo> {
  console.log(`  等待服务器 ${instanceId} 就绪...`)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const server = await tencentCloud.getServerStatus(instanceId)

    if (server.status === 'RUNNING') {
      console.log(`  ✓ 服务器 ${instanceId} 已就绪`)
      return server
    }

    // 每 10 次输出一次状态
    if (attempt % 10 === 0) {
      console.log(`  [${attempt}/${maxAttempts}] 服务器状态: ${server.status}`)
    }

    // 等待 2 秒后重试
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(`服务器在 ${maxAttempts * 2} 秒后仍未就绪`)
}

// ============================================================================
// 主测试函数
// ============================================================================

async function main() {
  try {
    // 读取 SSH 私钥
    console.log('========================================')
    console.log('读取 SSH 私钥')
    console.log('========================================')
    console.log(`SSH 私钥路径: ${CONFIG.SSH_PRIVATE_KEY_PATH}`)
    const privateKey = readFileSync(CONFIG.SSH_PRIVATE_KEY_PATH, 'utf-8')

    // 1. 初始化腾讯云客户端
    console.log('\n========================================')
    console.log('初始化腾讯云客户端')
    console.log('========================================')
    const tencentCloud = new TencentCloud()
    tencentCloud.setConfig({
      secretId: tencentSecretId!,
      secretKey: tencentSecretKey!,
      region: CONFIG.REGION
    })

    // 2. 创建所有 master 节点
    console.log('\n========================================')
    console.log(`创建 ${CONFIG.MASTER_COUNT} 个 master 节点`)
    console.log('========================================')

    const allIds = await tencentCloud.createServer({
      templateId: CONFIG.TEMPLATE_ID,
      count: CONFIG.MASTER_COUNT
    })

    // 3. 等待所有服务器就绪
    console.log('\n========================================')
    console.log('等待所有服务器就绪')
    console.log('========================================')

    const allServers: ServerInfo[] = []
    for (const id of allIds) {
      const server = await waitForServerReady(tencentCloud, id)
      allServers.push(server)
    }

    console.log('✓ 所有服务器已就绪')

    // 4. 在所有节点上安装 Clash 代理
    // console.log('\n========================================')
    // console.log('在所有节点上安装 Clash 代理')
    // console.log('========================================')

    // const clashPromises = allServers.map(async (server) => {
    //   console.log(`  - 正在在 ${server.name} (${server.ip}) 上安装 Clash...`)
    //   const result = await installClash({
    //     serverIP: server.privateIp,
    //     subscriptionURL: CLASH_SUBSCRIPTION_URL,
    //     sshUser: 'ubuntu',
    //     sshPubKey: privateKey
    //   })

    //   return {
    //     server,
    //     result
    //   }
    // })

    // const clashResults = await Promise.all(clashPromises)

    // // 检查安装结果
    // const failedClash = clashResults.filter(({ result }) => !result.success)
    // if (failedClash.length > 0) {
    //   console.warn('部分节点 Clash 安装失败:')
    //   failedClash.forEach(({ server, result }) => {
    //     console.warn(`  ${server.name} (${server.ip}): ${result.message}`)
    //   })
    // } else {
    //   console.log('✓ 所有节点 Clash 安装成功')
    // }

    // 5. 在第一个 master 节点上初始化 K3s 集群
    console.log('\n========================================')
    console.log('在第一个 master 节点上初始化 K3s 集群')
    console.log('========================================')
    const firstMaster = allServers[0]

    console.log(`使用节点: ${firstMaster.name} (${firstMaster.ip})`)

    console.log(`使用 K3s token: ${CONFIG.K3S_TOKEN}`)

    // 创建日志回调
    const initLog = createLogCallbacks('initK3s', firstMaster.name, firstMaster.ip)
    initLog.setCommand(`bash k3s_init.sh ${CONFIG.K3S_TOKEN}`)
    initLog.setRetries(3)

    const initResult = await initK3s({
      serverIP: firstMaster.ip,
      k3sToken: CONFIG.K3S_TOKEN,
      sshUser: CONFIG.SSH_USER,
      sshPubKey: privateKey,
      options: {
        retries: 3,
        onStdout: initLog.onStdout,
        onStderr: initLog.onStderr
      }
    })

    // 保存执行日志
    initLog.saveLog()

    if (!initResult.success) {
      throw new Error(`K3s 集群初始化失败: ${initResult.message}`)
    }

    console.log('✓ K3s 集群初始化成功')

    // 5. 并行在其他 master 节点上加入集群
    console.log('\n========================================')
    console.log('并行在其他 master 节点上加入集群')
    console.log('========================================')

    const otherMasters = allServers.slice(1)
    console.log(`让 ${otherMasters.length} 个 master 节点加入集群...`)

    const joinPromises = otherMasters.map(async (server) => {
      console.log(`  - 正在让 ${server.name} (${server.privateIp}) 加入集群...`)

      // 创建日志回调
      const joinLog = createLogCallbacks('joinK3sMaster', server.name, server.privateIp)
      joinLog.setCommand(`bash k3s_join_master.sh ${CONFIG.K3S_TOKEN} ${firstMaster.privateIp}`)
      joinLog.setRetries(3)

      const result = await joinK3sMaster({
        serverIP: server.ip,
        masterIP: firstMaster.privateIp,
        k3sToken: CONFIG.K3S_TOKEN,
        sshUser: CONFIG.SSH_USER,
        sshPubKey: privateKey,
        options: {
          retries: 3,
          onStdout: joinLog.onStdout,
          onStderr: joinLog.onStderr
        }
      })

      // 保存执行日志
      joinLog.saveLog()

      return {
        server,
        result
      }
    })

    const joinResults = await Promise.all(joinPromises)

    // 检查加入结果
    const failedJoins = joinResults.filter(({ result }) => !result.success)
    if (failedJoins.length > 0) {
      console.error('部分 master 节点加入集群失败:')
      failedJoins.forEach(({ server, result }) => {
        console.error(`  ${server.name} (${server.privateIp}): ${result.message}`)
      })
      throw new Error(`${failedJoins.length} 个 master 节点加入集群失败`)
    }

    console.log('✓ 所有 master 节点已加入集群')

    // 6. 查询集群节点状态
    console.log('\n========================================')
    console.log('查询集群节点状态')
    console.log('========================================')

    const ssh = createSSHClient({
      serverIP: firstMaster.privateIp,
      sshUser: CONFIG.SSH_USER,
      sshPubKey: privateKey
    })

    const nodesResult = await ssh.exec('sudo k3s kubectl get nodes -o wide')

    if (nodesResult.success && nodesResult.stdout) {
      console.log('\n集群节点状态:')
      console.log(nodesResult.stdout)

      // 解析节点数量
      const lines = nodesResult.stdout.trim().split('\n')
      // 第一行是表头，从第二行开始计算节点数
      const nodeCount = lines.length - 1
      console.log(`\n检测到 ${nodeCount} 个节点`)

      if (nodeCount === CONFIG.MASTER_COUNT) {
        console.log('✓ 节点数量符合预期')
      } else {
        console.warn(`⚠ 节点数量不符合预期: 期望 ${CONFIG.MASTER_COUNT}，实际 ${nodeCount}`)
      }
    } else {
      console.warn('无法获取集群节点状态')
      console.warn(`错误: ${nodesResult.message}`)
    }

    console.log('\n========================================')
    console.log('✓ K3s 集群创建完成')
    console.log('========================================')
    console.log(`Master 节点: ${CONFIG.MASTER_COUNT}`)
    console.log(`总计: ${CONFIG.MASTER_COUNT} 个节点`)
    console.log(`首个 master 节点 IP: ${firstMaster.ip}`)

  } catch (error: unknown) {
    console.error('\n========================================')
    console.error('✗ 测试失败')
    console.error('========================================')

    if (error instanceof Error) {
      console.error(error.message)
      console.error(error.stack)
    } else {
      console.error('未知错误:', error)
    }
    process.exit(1)
  }
}

// ============================================================================
// 执行测试
// ============================================================================

main()
