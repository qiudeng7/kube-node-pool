/**
 * 腾讯云节点池实现
 *
 * 实现了腾讯云 CVM（云服务器）的节点池管理功能，包括：
 * - 创建/查询/销毁实例
 * - 查询实例列表
 * - 查询启动模板
 * - 检查 API Server 状态（待实现）
 *
 * @see https://cloud.tencent.com/document/api/213/15692
 */

import { param } from 'drizzle-orm'
import type { ICloudVendor, ServerInfo, CreateServerParams, ListTemplateInfo, } from '../interface'
import { ServerStatus } from '../interface'
import { createRequest } from './signedRequest'

// ============================================================================
// 腾讯云配置类型
// ============================================================================

/**
 * 腾讯云配置
 *
 * 用于初始化腾讯云节点池的认证信息
 */
export interface TencentConfig {
  /** 腾讯云 SecretId，在腾讯云访问管理中获取 */
  secretId: string
  /** 腾讯云 SecretKey，在腾讯云访问管理中获取 */
  secretKey: string
  /** 腾讯云 地区，ap-nanjing, ap-guangzhou 等 */
  region: string

}

// ============================================================================
// 腾讯云 API 类型定义
// ============================================================================

/**
 * 腾讯云实例信息（API 返回格式）
 */
interface Instance {
  /** 实例 ID */
  InstanceId: string
  /** 实例名称 */
  InstanceName: string
  /** 实例状态 */
  InstanceState: string
  /** 公网 IP 地址列表 */
  PublicIpAddresses?: string[]
  /** 私有网络 IP 地址列表 */
  PrivateIpAddresses?: string[]
  /** 创建时间 */
  CreatedTime: string
  /** 可用区 */
  Zone?: string
  /** 镜像 ID */
  ImageId: string
}

/**
 * DescribeInstances API 响应数据
 */
interface DescribeInstancesResponse {
  /** 实例列表 */
  InstanceSet: Instance[]
  /** 实例总数 */
  TotalCount: number
}

/**
 * RunInstances API 响应数据
 */
interface RunInstancesResponse {
  /** 创建成功的实例 ID 列表 */
  InstanceIdSet: string[]
}

/**
 * 启动模板信息
 */
interface LaunchTemplate {
  /** 启动模板 ID */
  LaunchTemplateId: string
  /** 启动模板名称 */
  LaunchTemplateName: string
  /** 最新版本号 */
  LatestVersionNumber: number
  /** 默认版本号 */
  DefaultVersionNumber: number
  /** 版本数量 */
  LaunchTemplateVersionCount: number
  /** 创建时间 */
  CreationTime: string
  /** 创建者 */
  CreatedBy: string
}

/**
 * DescribeLaunchTemplates API 响应数据
 */
interface DescribeLaunchTemplatesResponse {
  /** 启动模板列表 */
  LaunchTemplateSet: LaunchTemplate[]
  /** 符合条件的模板数量 */
  TotalCount: number
}

// ============================================================================
// 状态映射
// ============================================================================

/**
 * 腾讯云实例状态到标准状态的映射表
 *
 * 将腾讯云的实例状态映射到统一的 ServerStatus 枚举：
 * - PENDING: 启动中
 * - RUNNING: 运行中
 * - STOPPING: 关闭中
 * - STOPPED: 已关闭
 * - TERMINATING: 销毁中
 * - TERMINATED: 已销毁
 */
const STATUS_MAP: Record<string, ServerStatus> = {
  'PENDING': ServerStatus.PENDING,           // 启动中
  'LAUNCH_FAILED': ServerStatus.TERMINATED,  // 创建失败
  'RUNNING': ServerStatus.RUNNING,           // 运行中
  'STOPPED': ServerStatus.STOPPED,           // 已关闭
  'STARTING': ServerStatus.PENDING,          // 启动中
  'STOPPING': ServerStatus.STOPPING,         // 关闭中
  'REBOOTING': ServerStatus.RUNNING,         // 重启中（仍视为运行）
  'SHUTDOWN': ServerStatus.STOPPED,          // 已关闭
  'TERMINATING': ServerStatus.TERMINATING,   // 销毁中
}

// ============================================================================
// 腾讯云节点池实现类
// ============================================================================

/**
 * 腾讯云节点池实现类
 *
 * 实现了 INodePool 接口，提供腾讯云 CVM 实例的管理功能。
 *
 * @example
 * ```typescript
 * const pool = new TencentNodePool()
 * pool.setCredentials({
 *   secretId: 'your-secret-id',
 *   secretKey: 'your-secret-key'
 * })
 *
 * // 创建服务器
 * const server = await pool.createServer({
 *   name: 'worker-1',
 *   count: 1
 * })
 * ```
 */
export class TencentCloud implements ICloudVendor<TencentConfig> {
  /** 腾讯云 SecretId */
  private secretId?: string
  /** 腾讯云 SecretKey */
  private secretKey?: string
  /** 服务器地区 */
  private region?: string

  /**
   * 构造函数
   * 初始化腾讯云节点池
   */
  constructor() { }

  /**
   * 设置认证信息
   *
   * @param config - 腾讯云配置对象，包含 secretId 和 secretKey
   */
  setConfig(config: TencentConfig): void {
    this.secretId = config.secretId
    this.secretKey = config.secretKey
    this.region = config.region
  }

  /**
   * 确保已设置配置信息
   *
   * @throws {Error} 如果未设置 secretId 或 secretKey
   * @private
   */
  private ensureConfig(): void {
    if (!this.secretId || !this.secretKey || !this.region) {
      throw new Error('Credentials not set. Call setConfig() first.')
    }
  }

  /**
   * 创建请求函数
   *
   * 使用已设置的认证信息创建腾讯云 API 请求函数
   *
   * @returns 请求函数
   * @private
   */
  private createRequest() {
    this.ensureConfig()
    return createRequest(this.secretId!, this.secretKey!)
  }

  /**
   * 创建服务器
   *
   * 调用腾讯云 RunInstances API 创建一台或多台云服务器实例。
   *
   * @param params - 创建服务器参数
   * @returns 创建的所有服务器ID列表
   */
  async createServer(params: CreateServerParams): Promise<string[]> {
    const request = this.createRequest()

    const instanceCount = params.count || 1

    // 调用腾讯云 RunInstances API
    const result = await request<
      {
        InstanceCount: number
        LaunchTemplate: {
          LaunchTemplateId: string
        }
      },
      RunInstancesResponse
    >({
      service: 'cvm',
      version: '2017-03-12',
      action: 'RunInstances',
      payload: {
        InstanceCount: instanceCount,
        LaunchTemplate: {
          LaunchTemplateId: params.templateId
        }
      },
      endpoint: 'cvm.tencentcloudapi.com',
      region: this.region,
    })

    // 返回所有创建的实例 ID
    return result.Response.InstanceIdSet
  }

  /**
   * 查询服务器状态
   *
   * 调用腾讯云 DescribeInstances API 查询指定实例的详细信息。
   *
   * @param instanceId - 实例 ID
   * @returns 服务器信息
   * @throws {Error} 如果实例不存在
   */
  async getServerStatus(instanceId: string): Promise<ServerInfo> {
    const request = this.createRequest()

    // 调用腾讯云 DescribeInstances API
    const result = await request<
      { InstanceIds: string[] },
      DescribeInstancesResponse
    >({
      service: 'cvm',
      version: '2017-03-12',
      action: 'DescribeInstances',
      payload: {
        InstanceIds: [instanceId],
      },
      endpoint: 'cvm.tencentcloudapi.com',
      region: this.region,
    })

    const instance = result.Response.InstanceSet[0]
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`)
    }

    // 转换为统一的 ServerInfo 格式
    return {
      id: instance.InstanceId,
      name: instance.InstanceName,
      ip: instance.PublicIpAddresses?.[0] || '',
      privateIp: instance.PrivateIpAddresses?.[0] || '',
      status: STATUS_MAP[instance.InstanceState] || ServerStatus.PENDING,
      createdAt: new Date(instance.CreatedTime),
    }
  }

  /**
   * 查询所有服务器
   *
   * 调用腾讯云 DescribeInstances API 查询实例列表。
   *
   * @returns 服务器信息列表
   */
  async listServers(): Promise<ServerInfo[]> {
    const request = this.createRequest()

    // 调用腾讯云 DescribeInstances API
    const result = await request<
      { Limit: number; Offset: number },
      DescribeInstancesResponse
    >({
      service: 'cvm',
      version: '2017-03-12',
      action: 'DescribeInstances',
      payload: {
        Limit: 100,
        Offset: 0,
      },
      endpoint: 'cvm.tencentcloudapi.com',
      region: this.region,
    })

    // 转换为统一的 NodeInfo 格式
    return result.Response.InstanceSet.map((instance) => ({
      id: instance.InstanceId,
      name: instance.InstanceName,
      ip: instance.PublicIpAddresses?.[0] || '',
      privateIp: instance.PrivateIpAddresses?.[0] || '',
      status: STATUS_MAP[instance.InstanceState] || ServerStatus.PENDING,
      createdAt: new Date(instance.CreatedTime),
    }))
  }

  /**
   * 销毁服务器
   *
   * 调用腾讯云 TerminateInstances API 销毁指定实例。
   *
   * @param instanceId - 实例 ID
   * @returns 是否成功
   *
   * @remarks
   * 销毁操作是不可逆的，请谨慎操作
   */
  async terminateServer(instanceId: string): Promise<boolean> {
    const request = this.createRequest()

    // 调用腾讯云 TerminateInstances API
    await request<
      { InstanceIds: string[] },
      { RequestId: string }
    >({
      service: 'cvm',
      version: '2017-03-12',
      action: 'TerminateInstances',
      payload: {
        InstanceIds: [instanceId],
      },
      endpoint: 'cvm.tencentcloudapi.com',
      region: this.region,
    })

    return true
  }

  /**
   * 查询可用的镜像模板
   *
   * 调用腾讯云 DescribeLaunchTemplates API 查询启动模板列表。
   *
   * @returns 镜像模板列表
   */
  async listTemplates(): Promise<ListTemplateInfo[]> {
    const request = this.createRequest()

    // 调用腾讯云 DescribeLaunchTemplates API
    const result = await request<
      { Limit: number; Offset: number },
      DescribeLaunchTemplatesResponse
    >({
      service: 'cvm',
      version: '2017-03-12',
      action: 'DescribeLaunchTemplates',
      payload: {
        Limit: 100,
        Offset: 0,
      },
      endpoint: 'cvm.tencentcloudapi.com',
      region: this.region,
    })

    // 转换为统一的 TemplateInfo 格式
    return result.Response.LaunchTemplateSet.map((template) => ({
      id: template.LaunchTemplateId,
      name: template.LaunchTemplateName
    }))
  }
}
