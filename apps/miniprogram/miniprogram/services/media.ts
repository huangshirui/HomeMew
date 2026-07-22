/**
 * 用户头像上传服务。
 *
 * 本地临时文件直接上传到 HomeMew Core；Core 负责鉴权、写入 R2、保存
 * users.avatar_key，并返回可公开访问的 avatarUrl。小程序不接触 R2 密钥，
 * 也不再使用微信云存储保存头像。
 */

import { AppError } from './api';
import { getStoredToken, hasValidToken, loginAndSaveToken } from './auth';
import type { ApiEnvelope, ErrorResponse } from '../types/index';

const CORE_BASE_URL_FALLBACK = 'https://homemew.aisr.online';
const UPLOAD_TIMEOUT = 30000;

interface AvatarUploadResult {
  avatarUrl: string;
}

function getCoreBaseUrl(): string {
  return ((wx.getStorageSync('coreApiUrl') as string) || CORE_BASE_URL_FALLBACK).replace(/\/$/, '');
}

async function ensureToken(): Promise<string> {
  if (!hasValidToken()) {
    await loginAndSaveToken();
  }
  const token = getStoredToken();
  if (!token) throw new AppError('AUTH_REQUIRED', '登录状态不可用');
  return token;
}

function requestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function parseUploadResponse(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function uploadOnce(tempFilePath: string, token: string): Promise<WechatMiniprogram.UploadFileSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${getCoreBaseUrl()}/api/v1/me/avatar`,
      filePath: tempFilePath,
      name: 'file',
      header: {
        Authorization: `Bearer ${token}`,
        'x-request-id': requestId(),
      },
      timeout: UPLOAD_TIMEOUT,
      success: resolve,
      fail(err) {
        const message = err.errMsg?.includes('timeout') ? '头像上传超时，请重试' : '网络请求失败，请检查网络连接';
        reject(new AppError(err.errMsg?.includes('timeout') ? 'TIMEOUT' : 'NETWORK_ERROR', message));
      },
    });
  });
}

function uploadError(result: WechatMiniprogram.UploadFileSuccessCallbackResult): AppError {
  const body = parseUploadResponse(result.data) as ErrorResponse | null;
  if (body?.error) {
    return new AppError(body.error.code, body.error.message, body.error.requestId);
  }
  const messages: Record<number, string> = {
    400: '头像文件无效',
    401: '登录状态已过期',
    413: '头像文件不能超过 5 MB',
    415: '仅支持 JPEG、PNG 或 WebP 图片',
    500: '头像上传失败，请稍后重试',
  };
  return new AppError(`HTTP_${result.statusCode}`, messages[result.statusCode] || `头像上传失败 (${result.statusCode})`);
}

/**
 * 上传本地头像文件到 Core/R2，并返回 Core 生成的正式 HTTPS 地址。
 */
export async function uploadAvatar(tempFilePath: string): Promise<string> {
  if (!tempFilePath) throw new AppError('INVALID_AVATAR', '文件路径为空');

  let token = await ensureToken();
  let result = await uploadOnce(tempFilePath, token);

  if (result.statusCode === 401) {
    await loginAndSaveToken();
    token = await ensureToken();
    result = await uploadOnce(tempFilePath, token);
  }

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw uploadError(result);
  }

  const body = parseUploadResponse(result.data) as ApiEnvelope<AvatarUploadResult> | null;
  const avatarUrl = body?.data?.avatarUrl;
  if (!avatarUrl || !avatarUrl.startsWith('https://')) {
    throw new AppError('INVALID_RESPONSE', '头像上传成功但未返回有效地址');
  }
  return avatarUrl;
}
