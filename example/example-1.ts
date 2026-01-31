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

const TEMPLATE_ID = 'lt-hlk4agum'
const REGION = 'ap-nanjing'
const SSH_PRIVATE_KEY_PATH = join(process.env.HOME || '', '.ssh/id_rsa')
const CLASH_SUBSCRIPTION_URL = process.env.CLASH_SUBSCRIPTION_URL || ''
const LOGS_DIR = join(process.cwd(), 'logs')

const MASTER_COUNT = 3  // master 节点数量（K3s 使用多 master 架构）

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将错误信息写入日志文件
 *
 * @param operation - 操作名称（如 initK3s, joinK3sMaster）
 * @param serverName - 服务器名称
 * @param serverIP - 服务器 IP
 * @param output - 输出内容（包含 stdout 和 stderr）
 */
function logError(operation: string, serverName: string, serverIP: string, output: string) {
  try {
    // 确保 logs 目录存在
    mkdirSync(LOGS_DIR, { recursive: true })

    // 生成日志文件名（包含时间戳）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logFileName = `${operation}_${serverName}_${timestamp}.log`
    const logFilePath = join(LOGS_DIR, logFileName)

    // 写入日志
    const logContent = [
      `Operation: ${operation}`,
      `Server: ${serverName} (${serverIP})`,
      `Time: ${new Date().toISOString()}`,
      '',
      output,
    ].join('\n')

    writeFileSync(logFilePath, logContent, 'utf-8')
    console.error(`  错误日志已保存到: ${logFilePath}`)
  } catch (err) {
    console.warn(`  无法保存错误日志: ${(err as Error).message}`)
  }
}

// 从环境变量读取腾讯云密钥
const tencentSecretId = process.env.tencentSecretId
const tencentSecretKey = process.env.tencentSecretKey

if (!tencentSecretId || !tencentSecretKey || !CLASH_SUBSCRIPTION_URL) {
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
    console.log(`SSH 私钥路径: ${SSH_PRIVATE_KEY_PATH}`)
    const privateKey = readFileSync(SSH_PRIVATE_KEY_PATH, 'utf-8')

    // 1. 初始化腾讯云客户端
    console.log('\n========================================')
    console.log('初始化腾讯云客户端')
    console.log('========================================')
    const tencentCloud = new TencentCloud()
    tencentCloud.setConfig({
      secretId: tencentSecretId!,
      secretKey: tencentSecretKey!,
      region: REGION
    })

    // 2. 创建所有 master 节点
    console.log('\n========================================')
    console.log(`创建 ${MASTER_COUNT} 个 master 节点`)
    console.log('========================================')

    const allIds = await tencentCloud.createServer({
      templateId: TEMPLATE_ID,
      count: MASTER_COUNT
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

    // 生成或获取 K3s token（可以使用预定义的 token 或者生成一个随机 token）
    const k3sToken = process.env.K3S_TOKEN || 'K10' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    console.log(`使用 K3s token: ${k3sToken}`)

    const initResult = await initK3s({
      serverIP: firstMaster.ip,
      k3sToken,
      sshUser: 'ubuntu',
      sshPubKey: privateKey
    })

    if (!initResult.success) {
      // 保存错误日志（包含 stdout 和 stderr）
      const output = [
        initResult.stdout ? `STDOUT:\n${initResult.stdout}` : '',
        initResult.stderr ? `STDERR:\n${initResult.stderr}` : '',
      ].filter(Boolean).join('\n\n')

      if (output) {
        logError('initK3s', firstMaster.name, firstMaster.ip, output)
      } else {
        console.warn('  没有输出内容可保存')
      }

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
      const result = await joinK3sMaster({
        serverIP: server.ip,
        masterIP: firstMaster.privateIp,
        k3sToken,
        sshUser: 'ubuntu',
        sshPubKey: privateKey
      })

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

        // 保存错误日志（包含 stdout 和 stderr）
        const output = [
          result.stdout ? `STDOUT:\n${result.stdout}` : '',
          result.stderr ? `STDERR:\n${result.stderr}` : '',
        ].filter(Boolean).join('\n\n')

        if (output) {
          logError('joinK3sMaster', server.name, server.privateIp, output)
        } else {
          console.warn(`  ${server.name}: 没有输出内容可保存`)
        }
      })
      throw new Error(`${failedJoins.length} 个 master 节点加入集群失败`)
    }

    console.log('✓ 所有 master 节点已加入集群')

    // 6. 查询集群节点状态
    console.log('\n========================================')
    console.log('查询集群节点状态')
    console.log('========================================')

    // 等待一段时间让节点完全就绪
    console.log('等待 30 秒让节点完全就绪...')
    await new Promise(resolve => setTimeout(resolve, 30000))

    const ssh = createSSHClient({
      serverIP: firstMaster.privateIp,
      sshUser: 'ubuntu',
      sshPubKey: privateKey
    })

    const nodesResult = await ssh.exec('sudo k3s kubectl get nodes -o wide')

    if (nodesResult.success && nodesResult.stdout) {
      console.log('\n集群节点状态:')
      console.log(nodesResult.stdout)
    } else {
      console.warn('无法获取集群节点状态')
    }

    console.log('\n========================================')
    console.log('✓ K3s 集群创建完成')
    console.log('========================================')
    console.log(`Master 节点: ${MASTER_COUNT}`)
    console.log(`总计: ${MASTER_COUNT} 个节点`)

    // 输出访问信息
    console.log('\n访问信息:')
    console.log(`  首个 master 节点 IP: ${firstMaster.ip}`)
    console.log(`  Kubeconfig 路径: /etc/rancher/k3s/k3s.yaml`)
    console.log(`  可以使用以下命令获取 kubeconfig:`)
    console.log(`    ssh ubuntu@${firstMaster.ip} "sudo cat /etc/rancher/k3s/k3s.yaml"`)

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
