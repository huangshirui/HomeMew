/** WeChat identity recovery through the HomeMew application boundary. */

import { LoginResponse } from '../types/index';
import { getApplicationBaseUrl, isTokenValid, REQUEST_TIMEOUT, STORAGE_KEYS } from './config';

type LoginPayload = LoginResponse & { error?: { code?: string; message?: string } };

let refreshPromise: Promise<LoginResponse> | null = null;
let authGeneration = 0;

export function invalidatePendingAuth(): void {
  authGeneration += 1;
  refreshPromise = null;
}

export async function callLogin(): Promise<LoginResponse> {
  const targetBaseUrl = getApplicationBaseUrl();
  const code = await new Promise<string>((resolve, reject) => wx.login({
    success: result => result.code ? resolve(result.code) : reject(new Error('微信身份恢复失败：未获取到 code')),
    fail: error => reject(new Error(`微信身份恢复失败: ${error.errMsg}`)),
  }));

  return new Promise((resolve, reject) => wx.request({
    url: `${targetBaseUrl}/api/v1/login/wechat`,
    method: 'POST',
    data: { code },
    header: { 'Content-Type': 'application/json' },
    timeout: REQUEST_TIMEOUT,
    success(response) {
      const result = response.data as LoginPayload;
      if (response.statusCode < 200 || response.statusCode >= 300 || result?.error) {
        reject(new Error(`身份恢复失败: ${result?.error?.message || `身份服务请求失败 (${response.statusCode})`}`));
      } else if (!result?.accessToken || !result.expiresAt) {
        reject(new Error('身份恢复失败: 未返回有效访问令牌'));
      } else resolve(result);
    },
    fail: error => reject(new Error(`身份服务调用失败: ${error.errMsg}`)),
  }));
}

function persistLogin(result: LoginResponse): LoginResponse {
  wx.setStorageSync(STORAGE_KEYS.accessToken, result.accessToken);
  wx.setStorageSync(STORAGE_KEYS.tokenExpiresAt, result.expiresAt);
  return result;
}

/**
 * Refresh the short-lived LifeSpace user token through a fresh wx.login code.
 *
 * All callers share one in-flight promise so App startup, API requests, activity
 * reporting and media uploads cannot trigger duplicate wx.login/token exchanges.
 */
async function refreshLogin(): Promise<LoginResponse> {
  if (refreshPromise) return refreshPromise;
  const generation = authGeneration;
  const promise = callLogin().then(result => {
    if (generation !== authGeneration) throw new Error('环境已切换，请重试身份恢复');
    return persistLogin(result);
  });
  refreshPromise = promise;
  try {
    return await promise;
  } finally {
    if (refreshPromise === promise) refreshPromise = null;
  }
}

/**
 * Return a usable access token, refreshing silently when needed.
 *
 * forceRefresh is only for an explicit 401 recovery. It never changes navigation
 * and never exposes token expiry as a user-facing login state.
 */
export async function ensureAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
  const { forceRefresh = false } = options;
  if (!forceRefresh && isTokenValid()) {
    const stored = getStoredToken();
    if (stored) return stored;
  }

  const result = await refreshLogin();
  if (!result.accessToken) throw new Error('身份恢复失败: 未返回有效访问令牌');
  return result.accessToken;
}

/** Compatibility wrapper for older callers; new code should prefer ensureAccessToken(). */
export async function loginAndSaveToken(): Promise<{ isNewUser: boolean }> {
  const result = await refreshLogin();
  return { isNewUser: result.isNewUser };
}


export function clearAuth(): void {
  for (const key of [
    STORAGE_KEYS.accessToken, STORAGE_KEYS.tokenExpiresAt, STORAGE_KEYS.currentFamilyId, STORAGE_KEYS.homeCache,
    'coreApiUrl', 'identityApiUrl', 'loginBackendUrl',
  ]) wx.removeStorageSync(key);
}

export function hasValidToken(): boolean { return isTokenValid(); }
export function getStoredToken(): string | null { return wx.getStorageSync(STORAGE_KEYS.accessToken) || null; }
