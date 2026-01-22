/**
 * 服务器状态枚举
 */
export enum ServerStatus {
    PENDING = 'PENDING',           // 启动中
    RUNNING = 'RUNNING',           // 运行中
    STOPPING = 'STOPPING',         // 关闭中
    STOPPED = 'STOPPED',           // 已关闭
    TERMINATING = 'TERMINATING',   // 销毁中
    TERMINATED = 'TERMINATED',     // 已销毁
}

/**
 * 服务器角色
 */
export enum ServerRole {
    CONTROL_PLANE = 'control-plane',
    WORKER = 'worker',
}

/**
 * 服务器信息
 */
export interface ServerInfo {
    id: string                    // 实例ID
    name: string                  // 实例名称
    ip: string                    // 公网IP
    privateIp: string             // 私网IP
    status: ServerStatus          // 实例状态
    role: ServerRole              // 角色（控制面/工作节点）
    createdAt: Date               // 创建时间
}

/**
 * 创建服务器参数
 */
export interface CreateServerParams {
    name: string                  // 实例名称
    role: ServerRole              // 角色
    templateId: string            // 镜像模板ID
    count?: number                // 创建数量，默认为1
}

/**
 * 镜像模板信息
 */
export interface TemplateInfo {
    id: string                    // 模板ID
    description: string           // 模板描述
    name: string                  // 模板名称
    region?: string               // 地域
    zone?: string                 // 可用区
    instanceType?: string         // 实例机型
}

/**
 * API Server 状态
 */
export interface ApiServerStatus {
    healthy: boolean              // 是否健康
    version: string               // Kubernetes 版本
    endpoint: string              // API Server 地址
    ready: boolean                // 是否就绪
}

/**
 * 节点池接口
 * 定义了所有云服务商必须实现的功能
 * @template TConfig 云服务商配置类型
 */
export interface INodePool<TConfig = Record<string, any>> {
    /**
     * 设置认证信息
     * @param config 云服务商配置
     */
    setConfig(config: TConfig): void

    /**
     * 创建服务器
     * @param params 创建服务器参数
     * @returns 创建的服务器信息
     */
    createServer(params: CreateServerParams): Promise<ServerInfo>

    /**
     * 查询服务器状态
     * @param instanceId 实例ID
     * @returns 服务器信息
     */
    getServerStatus(instanceId: string): Promise<ServerInfo>

    /**
     * 查询所有服务器
     * @param role 可选，按角色过滤
     * @returns 服务器列表
     */
    listServers(role?: ServerRole): Promise<ServerInfo[]>

    /**
     * 销毁服务器
     * @param instanceId 实例ID
     * @returns 是否成功
     */
    terminateServer(instanceId: string): Promise<boolean>

    /**
     * 查询可用的镜像模板
     * @returns 镜像模板列表
     */
    listTemplates(): Promise<TemplateInfo[]>

    /**
     * 查询 API Server 状态
     * @param apiServerIp API Server 的IP地址
     * @returns API Server 状态
     */
    getApiServerStatus(apiServerIp: string): Promise<ApiServerStatus>
}
