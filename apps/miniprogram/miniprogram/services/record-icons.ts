/** Record Icon images through the bounded HomeMew Mini BFF, never the R2 origin. */
import { AppError } from './api';
import { ensureAccessToken } from './auth';
import { getApplicationBaseUrl, generateRequestId, UPLOAD_TIMEOUT } from './config';

const MAX_BYTES = 256 * 1024;
const cache = new Map<string, string>();
const base = (familyId: string, recordId: string) =>
  `${getApplicationBaseUrl()}/api/v1/miniprogram/families/${encodeURIComponent(familyId)}/day-records/${encodeURIComponent(recordId)}/icon-image`;

function readFile(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: res => resolve(res.data as ArrayBuffer),
      fail: () => reject(new AppError('IMAGE_READ_FAILED', '无法读取所选图标')),
    });
  });
}

function compress(path: string): Promise<string> {
  return new Promise(resolve => {
    wx.compressImage({
      src: path, quality: 75, compressedWidth: 512,
      success: res => resolve(res.tempFilePath || path),
      fail: () => resolve(path),
    });
  });
}

function mimeFromPath(path: string): string {
  if (/\.png(?:$|\?)/i.test(path)) return 'image/png';
  if (/\.webp(?:$|\?)/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}

function requestBinary(url: string, method: 'GET' | 'POST', token: string, body?: ArrayBuffer, contentType?: string): Promise<WechatMiniprogram.RequestSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    wx.request({
      url, method, responseType: method === 'GET' ? 'arraybuffer' : 'text',
      ...(body ? { data: body } : {}),
      header: {
        Authorization: `Bearer ${token}`,
        'x-request-id': generateRequestId(),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      timeout: UPLOAD_TIMEOUT,
      success: resolve,
      fail: () => reject(new AppError('NETWORK_ERROR', '图标传输失败')),
    });
  });
}

/** A pending image is uploaded only after the enclosing Record exists. */
export async function uploadRecordIconImage(familyId: string, recordId: string, localPath: string): Promise<string> {
  const compressed = await compress(localPath);
  const bytes = await readFile(compressed);
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new AppError('FILE_TOO_LARGE', '图标图片必须小于 256 KiB，请裁剪或压缩后重试');
  let token = await ensureAccessToken();
  let res = await requestBinary(base(familyId, recordId), 'POST', token, bytes, mimeFromPath(compressed));
  if (res.statusCode === 401) {
    token = await ensureAccessToken({ forceRefresh: true });
    res = await requestBinary(base(familyId, recordId), 'POST', token, bytes, mimeFromPath(compressed));
  }
  const response = typeof res.data === 'string' ? JSON.parse(res.data) as { data?: { fileId?: string }; error?: { message?: string } } : res.data as { data?: { fileId?: string }; error?: { message?: string } };
  if (res.statusCode !== 200 || !response?.data?.fileId) throw new AppError('ICON_UPLOAD_FAILED', response?.error?.message || '上传图标失败');
  return response.data.fileId;
}

/** WeChat <image> cannot forward Bearer headers; save the authorized bytes to a temporary local path. */
export async function downloadRecordIconImage(familyId: string, recordId: string, fileId: string): Promise<string> {
  const key = `${familyId}:${recordId}:${fileId}`;
  const saved = cache.get(key);
  if (saved) return saved;
  let token = await ensureAccessToken();
  let res = await requestBinary(base(familyId, recordId), 'GET', token);
  if (res.statusCode === 401) {
    token = await ensureAccessToken({ forceRefresh: true });
    res = await requestBinary(base(familyId, recordId), 'GET', token);
  }
  if (res.statusCode !== 200 || !(res.data instanceof ArrayBuffer)) throw new AppError('ICON_DOWNLOAD_FAILED', '无法读取图片图标');
  const bytes = res.data as ArrayBuffer;
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new AppError('ICON_DOWNLOAD_FAILED', '图标图片无效');
  const filePath = `${wx.env.USER_DATA_PATH}/record-icon-${fileId}.png`;
  await new Promise<void>((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath, data: bytes, success: () => resolve(),
      fail: () => reject(new AppError('ICON_CACHE_FAILED', '保存图片图标失败')),
    });
  });
  cache.set(key, filePath);
  return filePath;
}
