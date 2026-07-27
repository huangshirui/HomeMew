/**
 * 统一配置：API 地址、Storage key、超时、Token 有效性判断、请求 ID。
 *
 * 普通请求（api.ts）与头像上传（media.ts）共用本文件，
 * 避免重复维护多个配置源，保证 Token 判断与地址格式只有一套。
 */

/** Core API 基础地址回退值（当本地未缓存云函数回传的地址时） */
export const CORE_BASE_URL_FALLBACK = 'https://homemew.aisr.online';

/** Storage key 集中管理，避免散落字符串 */
export const STORAGE_KEYS = {
  accessToken: 'accessToken',
  tokenExpiresAt: 'tokenExpiresAt',
  currentFamilyId: 'currentFamilyId',
  coreApiUrl: 'coreApiUrl',
  /** 日程页成员范围选择前缀，完整 key 为 `eventsScope:{familyId}:{userId}` */
  eventsScope: 'eventsScope',
} as const;

/** 普通请求超时 (ms) */
export const REQUEST_TIMEOUT = 15000;

/** 头像上传超时 (ms) */
export const UPLOAD_TIMEOUT = 30000;

/** Token 提前过期缓冲 (ms) */
export const TOKEN_EXPIRE_BUFFER_MS = 5 * 60 * 1000;

/**
 * 去除末尾的斜杠，统一 API 基础地址格式。
 * 纯函数，便于测试。
 */
export function normalizeBaseUrl(url: string): string {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

/**
 * 生成简单请求 ID，用于链路追踪。
 * 纯函数，便于测试。
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 判断 token 是否有效（纯函数，不依赖 wx）。
 * 以下情况均视为无效：
 * - 无 token
 * - 无 expiresAt
 * - expiresAt 无法解析
 * - 距过期不足 5 分钟
 */
export function evaluateToken(
  token: string | null | undefined,
  expiresAt: string | null | undefined,
): boolean {
  if (!token) return false;
  if (!expiresAt) return false;

  const expireTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expireTime)) return false;

  const now = Date.now();
  return now < expireTime - TOKEN_EXPIRE_BUFFER_MS;
}

/** 读取本地缓存的 Core API 基础地址（去掉末尾斜杠） */
export function getCoreBaseUrl(): string {
  const cached = (wx.getStorageSync(STORAGE_KEYS.coreApiUrl) as string) || '';
  const base = cached || CORE_BASE_URL_FALLBACK;
  return normalizeBaseUrl(base);
}

/** 统一判断本地是否有有效 token */
export function isTokenValid(): boolean {
  const token = wx.getStorageSync(STORAGE_KEYS.accessToken) as string | undefined;
  const expiresAt = wx.getStorageSync(STORAGE_KEYS.tokenExpiresAt) as string | undefined;
  return evaluateToken(token, expiresAt);
}
