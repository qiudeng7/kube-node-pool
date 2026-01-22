/**
 * 腾讯云 API 请求封装
 * 文档: https://cloud.tencent.com/document/api/213/15692
 */

import { sign } from './sign'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 腾讯云 API 请求配置
 */
export interface TencentCloudRequestConfig<P = Record<string, any>> {
  /** API 服务名称，如 cvm、cbs、vpc 等 */
  service: string
  /** API 版本号，如 2017-03-12 */
  version: string
  /** 接口名称，如 DescribeInstances、RunInstances 等 */
  action: string
  /** 请求参数对象 */
  payload?: P
  /** API 请求端点，如 cvm.tencentcloudapi.com */
  endpoint?: string
  /** 地域，如 ap-nanjing、ap-guangzhou 等 */
  region?: string
}

/**
 * 腾讯云 API 响应
 */
export interface TencentCloudResponse<T = any> {
  Response: {
    /** 请求 ID */
    RequestId: string
    /** 错误信息（请求失败时存在） */
    Error?: {
      Code: string
      Message: string
    }
    [key: string]: any
  } & T
}

/**
 * 腾讯云请求函数类型
 */
export type TencentCloudRequestFunction = <
  P = Record<string, any>,
  R = any
>(
  config: TencentCloudRequestConfig<P>
) => Promise<TencentCloudResponse<R>>

// ============================================================================
// 请求函数工厂
// ============================================================================

/**
 * 创建腾讯云 API 请求函数
 */
export function createRequest(
  secretId: string,
  secretKey: string
): TencentCloudRequestFunction {
  return async function request<P = Record<string, any>, R = any>(
    config: TencentCloudRequestConfig<P>
  ): Promise<TencentCloudResponse<R>> {
    const {
      service,
      version,
      action,
      payload = {} as P,
      endpoint = 'cvm.tencentcloudapi.com',
      region = 'ap-guangzhou',
    } = config

    const timestamp = Math.floor(Date.now() / 1000)
    const body = JSON.stringify(payload)

    // 计算签名
    const authorization = sign({
      secretID: secretId,
      secretKey: secretKey,
      endpoint,
      service,
      region,
      action,
      version,
      timestamp,
      payload: payload as object,
      method: 'POST'
    })

    // 构造请求头
    const headers: Record<string, string> = {
      'Authorization': authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'Host': endpoint,
      'X-TC-Action': action,
      'X-TC-Timestamp': timestamp.toString(),
      'X-TC-Version': version,
      'X-TC-Region': region,
    }

    // 发起请求
    const url = `https://${endpoint}/`
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })

    const result = await response.json() as TencentCloudResponse<R>

    // 检查错误
    if (result.Response.Error) {
      throw new Error(
        `TencentCloud API Error [${result.Response.Error.Code}]: ${result.Response.Error.Message}`
      )
    }

    return result
  }
}
