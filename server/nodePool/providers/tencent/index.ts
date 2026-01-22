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

import type { INodePool, ServerInfo, NodeInfo, CreateServerParams, ListTemplateInfo, ApiServerStatus } from '../../interface'
import { ServerStatus, ServerRole } from '../../interface'
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
 *   role: ServerRole.WORKER,
 *   count: 1
 * })
 * ```
 */
export class TencentNodePool implements INodePool<TencentConfig> {
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
  constructor() {}

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
        ImageId: string
        InstanceCount: number
      },
      RunInstancesResponse
    >({
      service: 'cvm',
      version: '2017-03-12',
      action: 'RunInstances',
      payload: {
        ImageId: params.templateId,
        InstanceCount: instanceCount,
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
   * @param role - 可选，按角色过滤（当前未实现）
   * @returns 节点信息列表（包含角色）
   *
   * @remarks
   * TODO: 当前未实现按角色过滤功能
   * TODO: 当前固定返回 100 条记录，需要实现分页
   * TODO: 需要支持多地域查询
   */
  async listServers(_role?: ServerRole): Promise<ServerInfo[]> {
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

  /**
   * 查询 API Server 状态
   *
   * TODO: 实现 API Server 健康检查
   * 可以通过 Kubernetes API 或 HTTP 端点检查
   *
   * @param _apiServerIp - API Server 的 IP 地址
   * @returns API Server 状态
   * @throws {Error} 当前未实现
   */
  async getApiServerStatus(_apiServerIp: string): Promise<ApiServerStatus> {
    // TODO: 实现 API Server 健康检查
    // 可以通过以下方式：
    // 1. 调用 Kubernetes API /healthz 端点
    // 2. 检查 API Server 的 TCP 连接
    // 3. 查询 TKE 集群状态
    throw new Error('getApiServerStatus not implemented yet')
  }
}
