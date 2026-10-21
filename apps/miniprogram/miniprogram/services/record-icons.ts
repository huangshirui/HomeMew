/** Record Icon images through the bounded HomeMew Mini BFF, never the R2 origin. */
import { AppError } from './api';
import { ensureAccessToken } from './auth';
import { getApplicationBaseUrl, generateRequestId, UPLOAD_TIMEOUT } from './config';

const MAX_BYTES = 256 * 1024;
export type IconModel = 'day_record' | 'event' | 'task' | 'wish';
const base = (familyId: string, modelKey: IconModel, recordId?: string) =>
  `${getApplicationBaseUrl()}/api/v1/miniprogram/families/${encodeURIComponent(familyId)}/record-icons/${modelKey}/${recordId ? `records/${encodeURIComponent(recordId)}/` : ''}image`;

function readFile(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: res => resolve(res.data as ArrayBuffer),
      fail: () => reject(new AppError('IMAGE_READ_FAILED', '无法读取所选图标')),
    });
  });
}

const MAX_DIMENSION = 512;

function getInfo(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => wx.getImageInfo({
    src: path,
    success: result => resolve({ width: result.width, height: result.height }),
    fail: () => reject(new AppError('IMAGE_INFO_FAILED', '无法读取图片尺寸，请选择 PNG、JPEG 或 WebP')),
  }));
}

function compress(path: string, width: number, height: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => wx.compressImage({
    src: path,
    quality,
    compressedWidth: width,
    compressedHeight: height,
    success: result => resolve(result.tempFilePath || path),
    fail: () => reject(new AppError('IMAGE_COMPRESS_FAILED', '图片压缩失败，请先裁剪或缩小图片')),
  }));
}

/** Use the actual signature rather than a temporary WeChat file extension. */
export function mimeFromBytes(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50
    && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d
    && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && String.fromCharCode(...data.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new AppError('INVALID_ICON_IMAGE', '只支持 PNG、JPEG、WebP 图片');
}

async function prepareImage(path: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const original = await getInfo(path);
  if (original.width <= 0 || original.height <= 0) throw new AppError('INVALID_ICON_IMAGE', '图标尺寸无效');
  const ratio = Math.min(1, MAX_DIMENSION / Math.max(original.width, original.height));
  const width = Math.max(1, Math.floor(original.width * ratio));
  const height = Math.max(1, Math.floor(original.height * ratio));

  // Quality retries help with large camera images; do not alter the
  // dimensions after server validation, and never bypass server-side limits.
  for (const quality of [78, 60, 44]) {
    const compressed = await compress(path, width, height, quality);
    const measured = await getInfo(compressed);
    if (measured.width > MAX_DIMENSION || measured.height > MAX_DIMENSION) continue;
    const bytes = await readFile(compressed);
    if (bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES) {
      return { bytes, contentType: mimeFromBytes(bytes) };
    }
  }
  throw new AppError('FILE_TOO_LARGE', '图标必须不超过 512×512 像素及 256 KiB，请先裁剪或压缩');
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

/** Pre-upload is scoped to the Space and later atomically assigned on Record Create/Update. */
export async function uploadRecordIconImage(familyId: string, modelKey: IconModel, localPath: string): Promise<string> {
  const { bytes, contentType } = await prepareImage(localPath);
  let token = await ensureAccessToken();
  let res = await requestBinary(base(familyId, modelKey), 'POST', token, bytes, contentType);
  if (res.statusCode === 401) {
    token = await ensureAccessToken({ forceRefresh: true });
    res = await requestBinary(base(familyId, modelKey), 'POST', token, bytes, contentType);
  }
  const response = typeof res.data === 'string' ? JSON.parse(res.data) as { data?: { fileId?: string }; error?: { message?: string } } : res.data as { data?: { fileId?: string }; error?: { message?: string } };
  if (res.statusCode !== 200 || !response?.data?.fileId) throw new AppError('ICON_UPLOAD_FAILED', response?.error?.message || '上传图标失败');
  return response.data.fileId;
}

/** WeChat <image> cannot forward Bearer headers; save the authorized bytes to a temporary local path. */
export async function downloadRecordIconImage(familyId: string, modelKey: IconModel, recordId: string, fileId: string): Promise<string> {
  // Always re-authorize; an in-memory image cache would bypass revoked grants.
  let token = await ensureAccessToken();
  let res = await requestBinary(base(familyId, modelKey, recordId), 'GET', token);
  if (res.statusCode === 401) {
    token = await ensureAccessToken({ forceRefresh: true });
    res = await requestBinary(base(familyId, modelKey, recordId), 'GET', token);
  }
  if (res.statusCode !== 200 || !(res.data instanceof ArrayBuffer)) throw new AppError('ICON_DOWNLOAD_FAILED', '无法读取图片图标');
  const bytes = res.data as ArrayBuffer;
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new AppError('ICON_DOWNLOAD_FAILED', '图标图片无效');
  const type = String((res.header as Record<string, string> | undefined)?.['content-type'] || 'image/png').toLowerCase();
  const extension = type.includes('webp') ? 'webp' : type.includes('jpeg') ? 'jpg' : 'png';
  const filePath = `${wx.env.USER_DATA_PATH}/record-icon-${fileId}.${extension}`;
  await new Promise<void>((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath, data: bytes, success: () => resolve(),
      fail: () => reject(new AppError('ICON_CACHE_FAILED', '保存图片图标失败')),
    });
  });
  return filePath;
}
