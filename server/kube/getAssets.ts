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
 * 返回用于在 Ubuntu 服务器上准备 Kubernetes 环境的脚本内容或路径
 *
 * @param pathOrContent - 返回类型，"content" 返回文件内容，"path" 返回文件路径，默认为 "content"
 * @returns setup 脚本内容或路径
 *
 * @example
 * ```typescript
 * // 获取文件内容
 * const script = getSetupScript('content')
 * console.log(script) // 输出 setup.sh 的内容
 *
 * // 获取文件路径
 * const scriptPath = getSetupScript('path')
 * console.log(scriptPath) // 输出 setup.sh 的绝对路径
 * ```
 */
export function getSetupScript(pathOrContent: 'path' | 'content' = 'content'): string {
  const setupPath = join(__dirname, 'assets/setup.sh')

  if (pathOrContent === 'path') {
    return setupPath
  }

  return readFileSync(setupPath, 'utf-8')
}

/**
 * 获取 kubeadm 配置文件
 *
 * 返回用于 kubeadm init 的配置文件内容或路径
 *
 * @param pathOrContent - 返回类型，"content" 返回文件内容，"path" 返回文件路径，默认为 "content"
 * @returns 配置文件内容或路径
 *
 * @example
 * ```typescript
 * // 获取文件内容
 * const config = getKubeadmConfig('content')
 * console.log(config) // 输出 kubeadm-config.yaml 的内容
 *
 * // 获取文件路径
 * const configPath = getKubeadmConfig('path')
 * console.log(configPath) // 输出 kubeadm-config.yaml 的绝对路径
 * ```
 */
export function getKubeadmConfig(pathOrContent: 'path' | 'content' = 'content'): string {
  const configPath = join(__dirname, 'assets/kubeadm-config.yaml')

  if (pathOrContent === 'path') {
    return configPath
  }

  return readFileSync(configPath, 'utf-8')
}
