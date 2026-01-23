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
 * 服务器信息
 */
export interface ServerInfo {
    id: string                    // 实例ID
    name: string                  // 实例名称
    ip: string                    // 公网IP
    privateIp: string             // 私网IP
    status: ServerStatus          // 实例状态
    createdAt: Date               // 创建时间
}

/**
 * 创建服务器参数
 */
export interface CreateServerParams {
    templateId: string            // 镜像模板ID
    count?: number                // 创建数量，默认为1
}

/**
 * 列出的模板信息
 */
export interface ListTemplateInfo {
    id: string                    // 模板ID
    name: string                  // 模板名称
}

/**
 * 云服务商接口
 * 定义了所有云服务商必须实现的功能
 * @template TConfig 云服务商配置类型
 */
export interface ICloudVendor<TConfig = Record<string, any>> {
    /**
     * 设置认证信息
     * @param config 云服务商配置
     */
    setConfig(config: TConfig): void

    /**
     * 创建服务器
     * @param params 创建服务器参数
     * @returns 创建的服务器ID列表
     */
    createServer(params: CreateServerParams): Promise<string[]>

    /**
     * 查询服务器状态
     * @param instanceId 实例ID
     * @returns 服务器信息
     */
    getServerStatus(instanceId: string): Promise<ServerInfo>

    /**
     * 查询所有服务器
     * @returns 节点信息列表（包含角色）
     */
    listServers(): Promise<ServerInfo[]>

    /**
     * 销毁服务器
     * @param instanceId 实例ID
     * @returns 是否成功
     */
    terminateServer(instanceId: string): Promise<boolean>

    /**
     * 查询可用的服务器模板
     * @returns 服务器模板列表
     */
    listTemplates(): Promise<ListTemplateInfo[]>
}
