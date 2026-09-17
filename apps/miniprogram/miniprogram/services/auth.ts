/** WeChat login through the HomeMew application boundary. */

import { LoginResponse } from '../types/index';
import { getApplicationBaseUrl, isTokenValid, REQUEST_TIMEOUT, STORAGE_KEYS } from './config';

type LoginPayload = LoginResponse & { error?: { code?: string; message?: string } };

export async function callLogin(): Promise<LoginResponse> {
  const code = await new Promise<string>((resolve, reject) => wx.login({
    success: result => result.code ? resolve(result.code) : reject(new Error('微信登录失败：未获取到 code')),
    fail: error => reject(new Error(`微信登录失败: ${error.errMsg}`)),
  }));

  return new Promise((resolve, reject) => wx.request({
    url: `${getApplicationBaseUrl()}/api/v1/login/wechat`,
    method: 'POST',
    data: { code },
    header: { 'Content-Type': 'application/json' },
    timeout: REQUEST_TIMEOUT,
    success(response) {
      const result = response.data as LoginPayload;
      if (response.statusCode < 200 || response.statusCode >= 300 || result?.error) {
        reject(new Error(`登录失败: ${result?.error?.message || `登录服务请求失败 (${response.statusCode})`}`));
      } else if (!result?.accessToken || !result.expiresAt) {
        reject(new Error('登录失败: 未返回有效访问令牌'));
      } else resolve(result);
    },
    fail: error => reject(new Error(`登录服务调用失败: ${error.errMsg}`)),
  }));
}

export async function loginAndSaveToken(): Promise<{ isNewUser: boolean }> {
  const result = await callLogin();
  wx.setStorageSync(STORAGE_KEYS.accessToken, result.accessToken);
  wx.setStorageSync(STORAGE_KEYS.tokenExpiresAt, result.expiresAt);
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
