/**
 * 测试腾讯云模块和 Kubernetes 集群创建
 *
 * 测试流程：
 * 1. 通过 dotenv 读取腾讯云密钥
 * 2. 创建所有节点（control-plane + worker）
 * 3. 等待所有服务器就绪
 * 4. 并行在所有节点上执行 setup 脚本
 * 5. 在第一个 control-plane 节点上初始化集群
 * 6. 并行在其他节点上加入集群
 * 7. 查询集群节点状态
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { TencentCloud } from '../server/cloudVendor/tencentCloud/index.js'
import type { SSHConfig } from '../server/kube/ssh.js'
import { setupNodes, initControlPlane, joinCluster, getNodes } from '../server/kube/index.js'

// ============================================================================
// 配置
// ============================================================================

const TEMPLATE_ID = 'lt-hlk4agum'
const REGION = 'ap-nanjing'
const SSH_PRIVATE_KEY_PATH = join(process.env.HOME || '', '.ssh/id_rsa')

const CONTROL_PLANE_COUNT = 3  // control-plane 节点数量
const WORKER_COUNT = 3          // worker 节点数量

// 从环境变量读取腾讯云密钥
const tencentSecretId = process.env.tencentSecretId
const tencentSecretKey = process.env.tencentSecretKey

if (!tencentSecretId || !tencentSecretKey) {
  console.error('错误: 请在 .env 文件中设置 tencentSecretId 和 tencentSecretKey')
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
): Promise<any> {
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

    // 2. 创建所有节点
    const totalCount = CONTROL_PLANE_COUNT + WORKER_COUNT
    console.log('\n========================================')
    console.log(`创建 ${totalCount} 个节点 (${CONTROL_PLANE_COUNT} control-plane + ${WORKER_COUNT} worker)`)
    console.log('========================================')

    const allIds = await tencentCloud.createServer({
      templateId: TEMPLATE_ID,
      count: totalCount
    })


    // 3. 等待所有服务器就绪
    console.log('\n========================================')
    console.log('等待所有服务器就绪')
    console.log('========================================')

    const allServers: any[] = []
    for (const id of allIds) {
      const server = await waitForServerReady(tencentCloud, id)
      allServers.push(server)
    }

    // 分配 control-plane 和 worker
    const controlPlaneServers = allServers.slice(0, CONTROL_PLANE_COUNT)
    const workerServers = allServers.slice(CONTROL_PLANE_COUNT)

    // 5. 并行在所有节点上执行 setup
    console.log('\n========================================')
    console.log('并行在所有节点上执行 setup')
    console.log('========================================')

    const sshConfigs: SSHConfig[] = allServers.map(server => ({
      host: server.ip,
      username: 'ubuntu',
      privateKey
    }))

    // 并行执行 setup
    const setupResults = await setupNodes(sshConfigs)

    // 检查 setup 结果
    const failedSetups = setupResults.filter(r => !r.success)
    if (failedSetups.length > 0) {
      console.error('部分节点 setup 失败:')
      failedSetups.forEach(r => {
        console.error(`  ${r.host}: ${r.error}`)
      })
      throw new Error(`${failedSetups.length} 个节点 setup 失败`)
    }

    console.log('✓ 所有节点 setup 完成')

    // 6. 在第一个 control-plane 节点上初始化集群
    console.log('\n========================================')
    console.log('在第一个 control-plane 节点上初始化集群')
    console.log('========================================')
    const firstControlPlane = controlPlaneServers[0]
    const sshConfig: SSHConfig = {
      host: firstControlPlane.ip,
      username: 'ubuntu',
      privateKey
    }

    console.log(`使用节点: ${firstControlPlane.name} (${firstControlPlane.ip})`)
    const initResult = await initControlPlane(sshConfig)

    if (!initResult.success) {
      throw new Error(`集群初始化失败: ${initResult.error}`)
    }

    console.log('✓ 集群初始化成功')
    console.log(`Worker Join 命令: ${initResult.joinCommand}`)
    console.log(`Control-plane Join 命令: ${initResult.controlPlaneJoinCommand}`)

    // 7. 并行在其他节点上加入集群
    console.log('\n========================================')
    console.log('并行在其他节点上加入集群')
    console.log('========================================')

    // 分离其他 control-plane 节点和 worker 节点
    const otherControlPlaneServers = controlPlaneServers.slice(1)

    // 准备其他 control-plane 节点的 SSH 配置
    const controlPlaneConfigs: SSHConfig[] = otherControlPlaneServers.map(server => ({
      host: server.ip,
      username: 'ubuntu',
      privateKey
    }))

    // 准备 worker 节点的 SSH 配置
    const workerConfigs: SSHConfig[] = workerServers.map(server => ({
      host: server.ip,
      username: 'ubuntu',
      privateKey
    }))

    // 并行加入集群
    const allResults: any[] = []

    // 7.1 其他 control-plane 节点加入集群
    if (controlPlaneConfigs.length > 0 && initResult.controlPlaneJoinCommand) {
      console.log(`\n让 ${controlPlaneConfigs.length} 个 control-plane 节点加入集群...`)
      const controlPlaneResults = await joinCluster(
        controlPlaneConfigs,
        initResult.controlPlaneJoinCommand
      )
      allResults.push(...controlPlaneResults)

      // 检查加入结果
      const failedJoins = controlPlaneResults.filter((r: any) => !r.success)
      if (failedJoins.length > 0) {
        console.error('部分 control-plane 节点加入集群失败:')
        failedJoins.forEach((r: any) => {
          console.error(`  ${r.host}: ${r.error}`)
        })
        throw new Error(`${failedJoins.length} 个 control-plane 节点加入集群失败`)
      }

      console.log('✓ 所有 control-plane 节点已加入集群')
    }

    // 7.2 worker 节点加入集群
    if (workerConfigs.length > 0 && initResult.joinCommand) {
      console.log(`\n让 ${workerConfigs.length} 个 worker 节点加入集群...`)
      const workerResults = await joinCluster(workerConfigs, initResult.joinCommand)
      allResults.push(...workerResults)

      // 检查加入结果
      const failedJoins = workerResults.filter((r: any) => !r.success)
      if (failedJoins.length > 0) {
        console.error('部分 worker 节点加入集群失败:')
        failedJoins.forEach((r: any) => {
          console.error(`  ${r.host}: ${r.error}`)
        })
        throw new Error(`${failedJoins.length} 个 worker 节点加入集群失败`)
      }

      console.log('✓ 所有 worker 节点已加入集群')
    }

    console.log('\n✓ 所有节点已加入集群')

    // 8. 查询集群节点状态
    console.log('\n========================================')
    console.log('查询集群节点状态')
    console.log('========================================')

    // 等待一段时间让节点完全就绪
    console.log('等待 30 秒让节点完全就绪...')
    await new Promise(resolve => setTimeout(resolve, 30000))

    const nodes = await getNodes(initResult.kubeconfig!)
    console.log(`\n集群共有 ${nodes.length} 个节点:`)
    nodes.forEach((node, index) => {
      console.log(`\n[${index + 1}] ${node.name}`)
      console.log(`    状态: ${node.status}`)
      console.log(`    角色: ${node.roles.join(', ')}`)
      console.log(`    版本: ${node.version}`)
      console.log(`    内部 IP: ${node.internalIP}`)
    })

    console.log('\n========================================')
    console.log('✓ 集群创建完成')
    console.log('========================================')
    console.log(`Control-plane 节点: ${CONTROL_PLANE_COUNT}`)
    console.log(`Worker 节点: ${WORKER_COUNT}`)
    console.log(`总计: ${CONTROL_PLANE_COUNT + WORKER_COUNT} 个节点`)

  } catch (error: any) {
    console.error('\n========================================')
    console.error('✗ 测试失败')
    console.error('========================================')
    console.error(error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

// ============================================================================
// 执行测试
// ============================================================================

main()
