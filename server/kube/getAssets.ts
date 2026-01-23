/**
 * 获取 Kubernetes 相关资源文件
 *
 * 提供以下功能：
 * 1. 获取服务器 setup 脚本
 * 2. 获取 kubeadm 配置文件
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ============================================================================
// 导出函数
// ============================================================================

/**
 * 获取服务器 setup 脚本
 *
 * 返回用于在 Ubuntu 服务器上准备 Kubernetes 环境的脚本内容
 *
 * @returns setup 脚本内容
 *
 * @example
 * ```typescript
 * const script = getSetupScript()
 * console.log(script) // 输出 setup.sh 的内容
 * ```
 */
export function getSetupScript(): string {
  const setupPath = join(__dirname, 'assets/setup.sh')
  return readFileSync(setupPath, 'utf-8')
}

/**
 * 获取 kubeadm 配置文件
 *
 * 返回用于 kubeadm init 的配置文件内容
 *
 * @returns 配置文件内容
 *
 * @example
 * ```typescript
 * const config = getKubeadmConfig()
 * console.log(config) // 输出 kubeadm-config.yaml 的内容
 * ```
 */
export function getKubeadmConfig(): string {
  const configPath = join(__dirname, 'assets/kubeadm-config.yaml')
  return readFileSync(configPath, 'utf-8')
}
