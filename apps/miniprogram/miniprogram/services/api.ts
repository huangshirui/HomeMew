/**
 * HomeMew / LifeSpace 统一请求封装。
 * 默认请求 LifeSpace Core；Identity 资源使用 target: 'identity'；
 * 需要应用契约隔离的 Mini Program BFF 资源使用 target: 'backend'。
 */

import { ErrorResponse } from '../types/index';
import {
  getCoreBaseUrl,
  getIdentityBaseUrl,
  getLoginBackendUrl,
  generateRequestId,
  REQUEST_TIMEOUT,
  isTokenValid,
  STORAGE_KEYS,
} from './config';
import { shouldAutoRetry, extractData } from './request-utils';

export class AppError extends Error {
  constructor(public code: string, message: string, public requestId?: string) {
    super(message);
    this.name = 'AppError';
  }
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  data?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  skipRetry?: boolean;
  timeout?: number;
  target?: 'core' | 'identity' | 'backend';
}

function getValidToken(): string | null {
  if (!isTokenValid()) return null;
  return (wx.getStorageSync(STORAGE_KEYS.accessToken) as string) || null;
}

async function refreshToken(): Promise<string | null> {
  if (isRefreshing && refreshPromise) return refreshPromise;
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
    if (!result.accessToken) return null;
    wx.setStorageSync(STORAGE_KEYS.accessToken, result.accessToken);
    wx.setStorageSync(STORAGE_KEYS.tokenExpiresAt, result.expiresAt);
    if (result.coreApiUrl) wx.setStorageSync(STORAGE_KEYS.coreApiUrl, result.coreApiUrl);
    return result.accessToken;
  } catch (error) {
    console.error('[API] Token refresh failed:', error);
    return null;
  }
}

interface WxRequestResult {
  statusCode: number;
  data: unknown;
  requestId: string;
}

function doRequest(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  data: Record<string, unknown> | unknown[] | undefined,
  headers: Record<string, string>,
  timeout: number,
): Promise<WxRequestResult> {
  const requestId = generateRequestId();
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: method as WechatMiniprogram.RequestOption['method'],
      data,
      header: { 'Content-Type': 'application/json', ...headers, 'x-request-id': requestId },
      timeout,
      success(res) {
        resolve({ statusCode: res.statusCode, data: res.data, requestId });
      },
      fail(err) {
        reject(new AppError(
          err.errMsg?.includes('timeout') ? 'TIMEOUT' : 'NETWORK_ERROR',
          err.errMsg?.includes('timeout') ? '请求超时，请稍后重试' : '网络请求失败，请检查网络连接',
          requestId,
        ));
      },
    });
  });
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    data,
    headers = {},
    skipRetry = false,
    timeout = REQUEST_TIMEOUT,
    target = 'core',
  } = options;
  const base = target === 'identity'
    ? getIdentityBaseUrl()
    : target === 'backend'
      ? getLoginBackendUrl()
      : getCoreBaseUrl();
  const url = `${base}${path}`;

  return (async (): Promise<T> => {
    let token = getValidToken();
    if (!token) token = await refreshToken();
    if (!token) throw new AppError('UNAUTHORIZED', '登录状态已过期，请重新登录');

    const requestHeaders = { ...headers, Authorization: `Bearer ${token}` };
    const res = await doRequest(url, method, data, requestHeaders, timeout);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return extractData(res.statusCode, res.data) as T;
    }

    if (res.statusCode === 401 && shouldAutoRetry(method, skipRetry)) {
      const newToken = await refreshToken();
      if (!newToken) throw buildError(res.data, res.statusCode, res.requestId);
      const retryRes = await doRequest(
        url,
        method,
        data,
        { ...requestHeaders, Authorization: `Bearer ${newToken}` },
        timeout,
      );
      if (retryRes.statusCode >= 200 && retryRes.statusCode < 300) {
        return extractData(retryRes.statusCode, retryRes.data) as T;
      }
      throw buildError(retryRes.data, retryRes.statusCode, retryRes.requestId);
    }
    throw buildError(res.data, res.statusCode, res.requestId);
  })();
}

function buildError(responseData: unknown, statusCode: number, requestId: string): AppError {
  const errorResponse = responseData as ErrorResponse;
  if (errorResponse?.error) {
    return new AppError(
      errorResponse.error.code,
      errorResponse.error.message,
      errorResponse.error.requestId || requestId,
    );
  }
  const defaultMessages: Record<number, string> = {
    400: '请求参数有误', 401: '登录状态已过期', 403: '没有权限执行此操作',
    404: '内容不存在或已被删除', 409: '操作冲突，请刷新后重试',
    422: '提交的数据不符合要求', 500: '服务器内部错误',
  };
  return new AppError(`HTTP_${statusCode}`, defaultMessages[statusCode] || `请求失败 (${statusCode})`, requestId);
}
