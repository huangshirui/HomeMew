/**
 * 认证相关服务
 *
 * 职责：
 * - 调用登录云函数获取 HomeMew JWT
 * - 管理本地 token 存储
 * - 处理用户被禁用状态
 */

import { LoginResponse } from '../types/index';
import { isTokenValid, STORAGE_KEYS } from './config';

/**
 * 调用登录云函数
 *
 * 流程：
 * 1. wx.login() 获取临时凭证 code
 * 2. 调用云函数 login，传入 code
 * 3. 云函数返回 accessToken, expiresAt, isNewUser
 */
export async function callLogin(): Promise<LoginResponse> {
  return new Promise((resolve, reject) => {
    wx.login({
      success(loginRes) {
        if (!loginRes.code) {
          reject(new Error('微信登录失败：未获取到 code'));
          return;
        }

        wx.cloud.callFunction({
          name: 'login',
          data: {
            code: loginRes.code,
          },
          success(cloudRes) {
            const result = cloudRes.result as LoginResponse & {
              error?: { code?: string; message?: string };
            };

            // 云函数业务层返回了错误对象（如缺少 JWT_SECRET、微信登录失败等）
            if (!result || result.error) {
              const msg = result?.error?.message || '登录云函数返回异常';
              console.error('[Auth] Login cloud function returned error:', result?.error);
              reject(new Error(`登录失败: ${msg}`));
              return;
            }

            // 成功路径但未返回令牌（防御性校验）
            if (!result.accessToken) {
              console.error('[Auth] Login succeeded but accessToken missing:', result);
              reject(new Error('登录失败: 未返回访问令牌'));
              return;
            }

            resolve(result);
          },
          fail(err) {
            console.error('[Auth] Login cloud function failed:', err);
            reject(new Error(`登录云函数调用失败: ${err.errMsg}`));
          },
        });
      },
      fail(err) {
        console.error('[Auth] wx.login failed:', err);
        reject(new Error(`微信登录失败: ${err.errMsg}`));
      },
    });
  });
}

/**
 * 执行完整登录流程并保存 token
 */
export async function loginAndSaveToken(): Promise<{ isNewUser: boolean }> {
  const result = await callLogin();

  wx.setStorageSync('accessToken', result.accessToken);
  wx.setStorageSync('tokenExpiresAt', result.expiresAt);
  if (result.coreApiUrl) {
    wx.setStorageSync('coreApiUrl', result.coreApiUrl);
  }

  console.log('[Auth] Login successful, isNewUser:', result.isNewUser);

  return {
    isNewUser: result.isNewUser,
  };
}

/**
 * 清除本地认证信息
 */
export function clearAuth(): void {
  wx.removeStorageSync(STORAGE_KEYS.accessToken);
  wx.removeStorageSync(STORAGE_KEYS.tokenExpiresAt);
  wx.removeStorageSync(STORAGE_KEYS.currentFamilyId);
  wx.removeStorageSync(STORAGE_KEYS.coreApiUrl);

  console.log('[Auth] Auth cleared');
}

/**
 * 检查是否有有效 token（统一委托给 config，避免多套判断逻辑）
 */
export function hasValidToken(): boolean {
  return isTokenValid();
}

/**
 * 获取存储的 token（不检查过期）
 */
export function getStoredToken(): string | null {
  return wx.getStorageSync('accessToken') || null;
}
