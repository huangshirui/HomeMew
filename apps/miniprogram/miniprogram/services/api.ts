/**
 * 统一 Core API 请求封装
 *
 * 职责：
 * - 添加 Authorization Bearer token
 * - 解析 { data } 成功信封
 * - 解析 { error } 错误响应
 * - 处理 401 自动重新登录并重试一次
 * - 防止并发重复刷新 Token
 * - 网络超时处理
 */

import { ErrorResponse, ApiEnvelope } from '../types/index';

/** Core API 基础地址回退值（当本地未缓存时，通常是在登录前） */
const CORE_BASE_URL_FALLBACK = 'https://homemew.aisr.online';

/**
 * 获取当前 Core API 基础地址。
 * 优先使用登录云函数回传并缓存到本地的地址，
 * 否则回退到默认值（含登录前的首次请求场景）。
 */
function getCoreBaseUrl(): string {
  return (wx.getStorageSync('coreApiUrl') as string) || CORE_BASE_URL_FALLBACK;
}

/** 请求超时时间 (ms) */
const REQUEST_TIMEOUT = 15000;

/** 应用错误类型 */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 并发刷新锁 */
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  data?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  /** 是否跳过自动重试（写操作应设为 true） */
  skipRetry?: boolean;
}

/**
 * 获取当前有效的 access token
 * 如果不存在或已过期，返回 null
 */
function getValidToken(): string | null {
  const token = wx.getStorageSync('accessToken');
  const expiresAt = wx.getStorageSync('tokenExpiresAt');

  if (!token) return null;

  // 检查是否过期（提前 5 分钟认为过期）
  if (expiresAt) {
    const now = new Date().getTime();
    const expireTime = new Date(expiresAt).getTime();
    if (now >= expireTime - 5 * 60 * 1000) {
      return null;
    }
  }

  return token as string;
}

/**
 * 刷新 token：调用登录云函数获取新 token
 */
async function refreshToken(): Promise<string | null> {
  // 如果已经在刷新中，复用同一个 Promise
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = doRefreshToken();

  try {
    return await refreshPromise;
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
}

async function doRefreshToken(): Promise<string | null> {
  try {
    const { callLogin } = require('./auth');
    const result = await callLogin();
    if (result.accessToken) {
      wx.setStorageSync('accessToken', result.accessToken);
      wx.setStorageSync('tokenExpiresAt', result.expiresAt);
      if (result.coreApiUrl) {
        wx.setStorageSync('coreApiUrl', result.coreApiUrl);
      }
      return result.accessToken;
    }
    return null;
  } catch (e) {
    console.error('[API] Token refresh failed:', e);
    return null;
  }
}

/**
 * 核心请求方法
 */
export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    data,
    headers = {},
    skipRetry = false,
  } = options;

  const url = `${getCoreBaseUrl()}${path}`;
  const token = getValidToken();

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  // 生成 x-request-id 用于追踪
  const requestId = generateRequestId();
  requestHeaders['x-request-id'] = requestId;

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: requestHeaders,
      timeout: REQUEST_TIMEOUT,
      success(res) {
        const statusCode = res.statusCode;
        const responseData = res.data as unknown;

        if (statusCode >= 200 && statusCode < 300) {
          // 成功响应，解析 { data } 信封
          const envelope = responseData as ApiEnvelope<unknown>;
          resolve(envelope.data as T);
          return;
        }

        // 401 未授权：尝试刷新 token 并重试
        if (statusCode === 401 && !skipRetry) {
          refreshToken()
            .then(newToken => {
              if (!newToken) {
                // 刷新失败，拒绝请求
                handleError(responseData, statusCode, requestId, reject);
                return;
              }

              // 用新 token 重试一次
              const retryHeaders = { ...headers };
              retryHeaders['Authorization'] = `Bearer ${newToken}`;
              retryHeaders['x-request-id'] = generateRequestId();

              return new Promise<T>((resolveRetry, rejectRetry) => {
                wx.request({
                  url,
                  method,
                  data,
                  header: {
                    'Content-Type': 'application/json',
                    ...retryHeaders,
                  },
                  timeout: REQUEST_TIMEOUT,
                  success(retryRes) {
                    if (retryRes.statusCode >= 200 && retryRes.statusCode < 300) {
                      const retryEnvelope = retryRes.data as ApiEnvelope<unknown>;
                      resolveRetry(retryEnvelope.data as T);
                    } else {
                      handleError(retryRes.data, retryRes.statusCode!, requestId, rejectRetry);
                    }
                  },
                  fail(err) {
                    rejectRetry(new AppError('NETWORK_ERROR', '网络请求失败，请检查网络连接'));
                  },
                });
              });
            })
            .then(resolve)
            .catch(reject);
          return;
        }

        // 其他错误
        handleError(responseData, statusCode, requestId, reject);
      },
      fail(err) {
        if (err.errMsg?.includes('timeout')) {
          reject(new AppError('TIMEOUT', '请求超时，请稍后重试', requestId));
        } else {
          reject(new AppError('NETWORK_ERROR', '网络请求失败，请检查网络连接', requestId));
        }
      },
    });
  });
}

function handleError(
  responseData: unknown,
  statusCode: number,
  requestId: string,
  reject: (reason: Error) => void,
): void {
  const errorResponse = responseData as ErrorResponse;

  if (errorResponse?.error) {
    reject(new AppError(
      errorResponse.error.code,
      errorResponse.error.message,
      errorResponse.error.requestId || requestId,
    ));
  } else {
    // 无标准错误格式时的默认处理
    const defaultMessages: Record<number, string> = {
      400: '请求参数有误',
      401: '登录状态已过期',
      403: '没有权限执行此操作',
      404: '内容不存在或已被删除',
      409: '操作冲突，请刷新后重试',
      500: '服务器内部错误',
    };

    reject(new AppError(
      `HTTP_${statusCode}`,
      defaultMessages[statusCode] || `请求失败 (${statusCode})`,
      requestId,
    ));
  }
}

/** 生成简单的请求 ID */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}
