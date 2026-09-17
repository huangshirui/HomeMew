/** Avatar uploads through the stable HomeMew Mini BFF. */

import { AppError, request } from './api';
import { getStoredToken, loginAndSaveToken } from './auth';
import {
  getApplicationBaseUrl,
  generateRequestId,
  isTokenValid,
  UPLOAD_TIMEOUT,
} from './config';
import type { ApiEnvelope, ErrorResponse } from '../types/index';

interface AvatarUploadResult { avatarUrl: string; version?: number }

async function ensureToken(): Promise<string> {
  if (!isTokenValid()) await loginAndSaveToken();
  const token = getStoredToken();
  if (!token) throw new AppError('AUTH_REQUIRED', '登录状态不可用');
  return token;
}

function parseUploadResponse(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  return null;
}

function readFileAsArrayBuffer(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: res => resolve(res.data as ArrayBuffer),
      fail: () => reject(new AppError('INVALID_AVATAR', '无法读取所选图片')),
    });
  });
}

const UPLOAD_MAX_WIDTH = 512;
const UPLOAD_COMPRESS_QUALITY = 80;

function compressImageForUpload(tempFilePath: string): Promise<string> {
  return new Promise(resolve => {
    if (typeof wx.compressImage !== 'function') return resolve(tempFilePath);
    wx.compressImage({
      src: tempFilePath,
      quality: UPLOAD_COMPRESS_QUALITY,
      compressedWidth: UPLOAD_MAX_WIDTH,
      success: res => resolve(res.tempFilePath || tempFilePath),
      fail: () => resolve(tempFilePath),
    });
  });
}

function randomBoundary(): string {
  return `----HomeMewBoundary${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}
function guessExtension(filePath: string): string {
  return /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(filePath)?.[1]?.toLowerCase() || 'jpg';
}
function guessMime(filePath: string): string {
  const ext = guessExtension(filePath);
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}
function utf8Encode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code >= 0xd800 && code <= 0xdbff) {
      const hi = code;
      const lo = str.charCodeAt(++i);
      code = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(bytes);
}

function buildMultipartBody(
  buffer: ArrayBuffer,
  filename: string,
  mime: string,
  boundary: string,
  fields: Record<string, string> = {},
): ArrayBuffer {
  const fieldText = Object.entries(fields)
    .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
    .join('');
  const head = utf8Encode(
    fieldText + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = utf8Encode(`\r\n--${boundary}--\r\n`);
  const result = new ArrayBuffer(head.byteLength + buffer.byteLength + tail.byteLength);
  const view = new Uint8Array(result);
  view.set(head, 0);
  view.set(new Uint8Array(buffer), head.byteLength);
  view.set(tail, head.byteLength + buffer.byteLength);
  return result;
}

async function uploadOnceTo(
  url: string,
  tempFilePath: string,
  token: string,
  fields: Record<string, string> = {},
): Promise<WechatMiniprogram.RequestSuccessCallbackResult> {
  const compressedPath = await compressImageForUpload(tempFilePath);
  const boundary = randomBoundary();
  const buffer = await readFileAsArrayBuffer(compressedPath);
  const body = buildMultipartBody(
    buffer,
    `avatar.${guessExtension(compressedPath)}`,
    guessMime(compressedPath),
    boundary,
    fields,
  );
  return new Promise((resolve, reject) => wx.request({
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
    fail: err => reject(new AppError(
      String(err.errMsg || '').includes('timeout') ? 'TIMEOUT' : 'NETWORK_ERROR',
      String(err.errMsg || '').includes('timeout') ? '头像上传超时，请重试' : '网络请求失败，请检查网络连接',
    )),
  }));
}

function uploadError(result: WechatMiniprogram.RequestSuccessCallbackResult): AppError {
  const body = parseUploadResponse(result.data) as ErrorResponse | null;
  if (body?.error) return new AppError(body.error.code, body.error.message, body.error.requestId);
  return new AppError(`HTTP_${result.statusCode}`, `头像上传失败 (${result.statusCode})`);
}

async function uploadMultipartTo(
  url: string,
  tempFilePath: string,
  fields: Record<string, string> = {},
): Promise<string> {
  if (!tempFilePath) throw new AppError('INVALID_AVATAR', '文件路径为空');
  let token = await ensureToken();
  let result = await uploadOnceTo(url, tempFilePath, token, fields);
  if (result.statusCode === 401) {
    await loginAndSaveToken();
    token = await ensureToken();
    result = await uploadOnceTo(url, tempFilePath, token, fields);
  }
  if (result.statusCode < 200 || result.statusCode >= 300) throw uploadError(result);
  const body = parseUploadResponse(result.data) as ApiEnvelope<AvatarUploadResult> | null;
  const avatarUrl = body?.data?.avatarUrl;
  if (!avatarUrl || !avatarUrl.startsWith('https://')) throw new AppError('INVALID_RESPONSE', '头像上传成功但未返回有效地址');
  return avatarUrl;
}

export function uploadAvatar(tempFilePath: string): Promise<string> {
  return uploadMultipartTo(`${getApplicationBaseUrl()}/api/v1/miniprogram/me/avatar`, tempFilePath);
}

export async function uploadFamilyAvatar(familyId: string, tempFilePath: string): Promise<string> {
  const family = await request<{ version: number }>(`/api/v1/miniprogram/families/${encodeURIComponent(familyId)}`);
  return uploadMultipartTo(
    `${getApplicationBaseUrl()}/api/v1/miniprogram/families/${encodeURIComponent(familyId)}/avatar`,
    tempFilePath,
    { version: String(family.version) },
  );
}
