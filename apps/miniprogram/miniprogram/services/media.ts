/**
 * 用户 / 家庭头像上传服务。
 *
 * 本地临时文件直接上传到 HomeMew Core；Core 负责鉴权、写入 R2、保存
 * avatar_key，并返回可公开访问的 avatarUrl。小程序不接触 R2 密钥，
 * 也不再使用微信云存储保存头像。
 *
 * 注意：OpenAPI 中头像路由均为 `PUT`（multipart/form-data），
 * 例如 `PUT /api/v1/me/avatar` 与 `PUT /api/v1/families/{familyId}/avatar`。
 * 微信 `wx.uploadFile` 只能发起 POST，无法匹配这些路由，因此这里改用
 * `wx.request` 发送 PUT，并手动构造 multipart/form-data 请求体。
 */

import { AppError } from './api';
import { getStoredToken, loginAndSaveToken } from './auth';
import {
  getCoreBaseUrl,
  generateRequestId,
  isTokenValid,
  UPLOAD_TIMEOUT,
} from './config';
import type { ApiEnvelope, ErrorResponse } from '../types/index';

interface AvatarUploadResult {
  avatarUrl: string;
}

async function ensureToken(): Promise<string> {
  if (!isTokenValid()) {
    await loginAndSaveToken();
  }
  const token = getStoredToken();
  if (!token) throw new AppError('AUTH_REQUIRED', '登录状态不可用');
  return token;
}

function parseUploadResponse(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function readFileAsArrayBuffer(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (res) => resolve(res.data as ArrayBuffer),
      fail: () => reject(new AppError('INVALID_AVATAR', '无法读取所选图片')),
    });
  });
}

function randomBoundary(): string {
  return `----HomeMewBoundary${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}

function guessExtension(filePath: string): string {
  const m = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(filePath);
  return m ? m[1].toLowerCase() : 'png';
}

function guessMime(filePath: string): string {
  switch (guessExtension(filePath)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}

function buildMultipartBody(buffer: ArrayBuffer, filename: string, mime: string, boundary: string): ArrayBuffer {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const total = head.byteLength + buffer.byteLength + tail.byteLength;
  const result = new ArrayBuffer(total);
  const view = new Uint8Array(result);
  view.set(new Uint8Array(head), 0);
  view.set(new Uint8Array(buffer), head.byteLength);
  view.set(new Uint8Array(tail), head.byteLength + buffer.byteLength);
  return result;
}

function uploadOnceTo(
  url: string,
  tempFilePath: string,
  token: string,
): Promise<WechatMiniprogram.RequestSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    const boundary = randomBoundary();
    const filename = `avatar.${guessExtension(tempFilePath)}`;
    const mime = guessMime(tempFilePath);

    readFileAsArrayBuffer(tempFilePath)
      .then((buffer) => {
        const body = buildMultipartBody(buffer, filename, mime, boundary);
        wx.request({
          url,
          method: 'PUT',
          data: body,
          header: {
            Authorization: `Bearer ${token}`,
            'x-request-id': generateRequestId(),
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          timeout: UPLOAD_TIMEOUT,
          success: resolve,
          fail(err) {
            const errMsg = String((err as { errMsg?: string })?.errMsg || '');
            const isTimeout = errMsg.includes('timeout');
            reject(
              new AppError(isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR', isTimeout ? '头像上传超时，请重试' : '网络请求失败，请检查网络连接'),
            );
          },
        });
      })
      .catch(reject);
  });
}

function uploadError(result: WechatMiniprogram.RequestSuccessCallbackResult): AppError {
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
 * 将临时图片以 PUT multipart/form-data 上传到指定路由，解析并返回
 * Core 生成的正式 HTTPS avatarUrl。
 */
async function uploadMultipartTo(url: string, tempFilePath: string): Promise<string> {
  if (!tempFilePath) throw new AppError('INVALID_AVATAR', '文件路径为空');

  let token = await ensureToken();
  let result = await uploadOnceTo(url, tempFilePath, token);

  if (result.statusCode === 401) {
    await loginAndSaveToken();
    token = await ensureToken();
    result = await uploadOnceTo(url, tempFilePath, token);
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

/**
 * 上传当前用户的头像，返回 Core 生成的正式 HTTPS 地址。
 */
export function uploadAvatar(tempFilePath: string): Promise<string> {
  return uploadMultipartTo(`${getCoreBaseUrl()}/api/v1/me/avatar`, tempFilePath);
}

/**
 * 上传家庭的头像，返回 Core 生成的正式 HTTPS 地址。
 */
export function uploadFamilyAvatar(familyId: string, tempFilePath: string): Promise<string> {
  return uploadMultipartTo(`${getCoreBaseUrl()}/api/v1/families/${familyId}/avatar`, tempFilePath);
}
