/**
 * 统一 Core API 请求封装
 *
 * 职责：
 * - 添加 Authorization Bearer token
 * - 解析 { data } 成功信封
 * - 解析 { error } 错误响应
 * - 处理 204 无内容响应（直接返回 undefined）
 * - 401 自动重新登录并重试一次（仅限 GET）
 * - 防止并发重复刷新 Token
 * - 网络超时处理
 *
 * 配置（基础地址、Storage key、超时、Token 判断、请求 ID）统一来自 ./config。
 */

import { ErrorResponse } from '../types/index';
import {
  getCoreBaseUrl,
  generateRequestId,
  REQUEST_TIMEOUT,
  isTokenValid,
  STORAGE_KEYS,
} from './config';
import { shouldAutoRetry, extractData } from './request-utils';

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
 * 获取当前有效的 access token 字符串（用于请求头）。
 * 如果不存在或已过期，返回 null。
 */
function getValidToken(): string | null {
  if (!isTokenValid()) return null;
  return (wx.getStorageSync(STORAGE_KEYS.accessToken) as string) || null;
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
      wx.setStorageSync(STORAGE_KEYS.accessToken, result.accessToken);
      wx.setStorageSync(STORAGE_KEYS.tokenExpiresAt, result.expiresAt);
      if (result.coreApiUrl) {
        wx.setStorageSync(STORAGE_KEYS.coreApiUrl, result.coreApiUrl);
      }
      return result.accessToken;
    }
    return null;
  } catch (e) {
    console.error('[API] Token refresh failed:', e);
    return null;
  }
}

interface WxRequestResult {
  statusCode: number;
  data: unknown;
  requestId: string;
}

/** 用给定 token 执行一次请求，返回状态码、原始响应体与本次 request-id */
function doRequest(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  data: Record<string, unknown> | unknown[] | undefined,
  headers: Record<string, string>,
  timeout: number,
): Promise<WxRequestResult> {
  const requestId = generateRequestId();
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
    'x-request-id': requestId,
  };

  return new Promise<WxRequestResult>((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: requestHeaders,
      timeout,
      success(res) {
        resolve({
          statusCode: res.statusCode,
          data: res.data,
          requestId,
        });
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

  return (async (): Promise<T> => {
    const res = await doRequest(url, method, data, requestHeaders, REQUEST_TIMEOUT);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return extractData(res.statusCode, res.data) as T;
    }

    // 401 未授权：仅 GET 允许刷新 token 并重试一次
    if (res.statusCode === 401 && shouldAutoRetry(method, skipRetry)) {
      const newToken = await refreshToken();
      if (!newToken) {
        throw buildError(res.data, res.statusCode, res.requestId);
      }

      const retryHeaders: Record<string, string> = {
        ...requestHeaders,
        Authorization: `Bearer ${newToken}`,
      };
      const retryRes = await doRequest(url, method, data, retryHeaders, REQUEST_TIMEOUT);

      if (retryRes.statusCode >= 200 && retryRes.statusCode < 300) {
        return extractData(retryRes.statusCode, retryRes.data) as T;
      }
      throw buildError(retryRes.data, retryRes.statusCode, retryRes.requestId);
    }

    throw buildError(res.data, res.statusCode, res.requestId);
  })();
}

function buildError(
  responseData: unknown,
  statusCode: number,
  requestId: string,
): AppError {
  const errorResponse = responseData as ErrorResponse;

  if (errorResponse?.error) {
    return new AppError(
      errorResponse.error.code,
      errorResponse.error.message,
      errorResponse.error.requestId || requestId,
    );
  }

  // 无标准错误格式时的默认处理
  const defaultMessages: Record<number, string> = {
    400: '请求参数有误',
    401: '登录状态已过期',
    403: '没有权限执行此操作',
    404: '内容不存在或已被删除',
    409: '操作冲突，请刷新后重试',
    500: '服务器内部错误',
  };

  return new AppError(
    `HTTP_${statusCode}`,
    defaultMessages[statusCode] || `请求失败 (${statusCode})`,
    requestId,
  );
}
