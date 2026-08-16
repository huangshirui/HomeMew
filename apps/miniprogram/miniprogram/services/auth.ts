/**
 * 认证相关服务。
 *
 * wx.login() 仍由微信客户端生成一次性 code，但 code 直接发送到 HomeMew Cloudflare
 * 应用后端。后端使用微信 appsecret 换取可信 openid，维护 openid -> LifeSpace usr_*
 * 映射，并使用服务器端 LifeSpace 应用凭证签发短期用户 Token。
 */

import { LoginResponse } from '../types/index';
import { getLoginBackendUrl, isTokenValid, REQUEST_TIMEOUT, STORAGE_KEYS } from './config';

type CloudflareLoginResponse = LoginResponse & {
  identityApiUrl?: string;
  error?: { code?: string; message?: string };
};

export async function callLogin(): Promise<LoginResponse> {
  const code = await new Promise<string>((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) resolve(result.code);
        else reject(new Error('微信登录失败：未获取到 code'));
      },
      fail(error) {
        reject(new Error(`微信登录失败: ${error.errMsg}`));
      },
    });
  });

  return new Promise<LoginResponse>((resolve, reject) => {
    wx.request({
      url: `${getLoginBackendUrl()}/api/v1/login/wechat`,
      method: 'POST',
      data: { code },
      header: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT,
      success(response) {
        const result = response.data as CloudflareLoginResponse;
        if (response.statusCode < 200 || response.statusCode >= 300 || result?.error) {
          const message = result?.error?.message || `登录服务请求失败 (${response.statusCode})`;
          reject(new Error(`登录失败: ${message}`));
          return;
        }
        if (!result?.accessToken || !result.expiresAt) {
          reject(new Error('登录失败: 未返回有效访问令牌'));
          return;
        }
        if (result.identityApiUrl) wx.setStorageSync(STORAGE_KEYS.identityApiUrl, result.identityApiUrl);
        resolve(result);
      },
      fail(error) {
        reject(new Error(`登录服务调用失败: ${error.errMsg}`));
      },
    });
  });
}

export async function loginAndSaveToken(): Promise<{ isNewUser: boolean }> {
  const result = await callLogin();
  wx.setStorageSync(STORAGE_KEYS.accessToken, result.accessToken);
  wx.setStorageSync(STORAGE_KEYS.tokenExpiresAt, result.expiresAt);
  if (result.coreApiUrl) wx.setStorageSync(STORAGE_KEYS.coreApiUrl, result.coreApiUrl);
  return { isNewUser: result.isNewUser };
}

export function clearAuth(): void {
  wx.removeStorageSync(STORAGE_KEYS.accessToken);
  wx.removeStorageSync(STORAGE_KEYS.tokenExpiresAt);
  wx.removeStorageSync(STORAGE_KEYS.currentFamilyId);
  wx.removeStorageSync(STORAGE_KEYS.coreApiUrl);
  wx.removeStorageSync(STORAGE_KEYS.identityApiUrl);
  wx.removeStorageSync(STORAGE_KEYS.loginBackendUrl);
}

export function hasValidToken(): boolean {
  return isTokenValid();
}

export function getStoredToken(): string | null {
  return wx.getStorageSync(STORAGE_KEYS.accessToken) || null;
}
