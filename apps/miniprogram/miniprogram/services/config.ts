/**
 * 统一配置：HomeMew 应用后端、LifeSpace Core、Storage key、超时与 Token 判断。
 */

/** HomeMew Cloudflare 应用后端。这里只承载微信身份映射和用户 Token 交换。 */
export const LOGIN_BACKEND_URL_FALLBACK = 'https://homemew.aisr.online';

/** LifeSpace Core 生产地址。家庭业务概念在客户端映射为 Space。 */
export const CORE_BASE_URL_FALLBACK = 'https://core.aisr.online';

/** Storage key 集中管理，避免散落字符串 */
export const STORAGE_KEYS = {
  accessToken: 'accessToken',
  tokenExpiresAt: 'tokenExpiresAt',
  currentFamilyId: 'currentFamilyId',
  coreApiUrl: 'coreApiUrl',
  loginBackendUrl: 'loginBackendUrl',
  identityApiUrl: 'identityApiUrl',
  /** 日程页成员范围选择前缀，完整 key 为 `eventsScope:{familyId}:{userId}` */
  eventsScope: 'eventsScope',
  /** 待办页成员范围选择前缀，完整 key 为 `tasksScope:{familyId}:{userId}` */
  tasksScope: 'tasksScope',
  /** 设备时区偏好模式：'system' | 'custom' */
  timeZoneMode: 'timeZoneMode',
  /** 设备时区偏好：指定的 IANA 时区（仅 mode 为 custom 时使用） */
  timeZoneCustom: 'timeZoneCustom',
} as const;

export const REQUEST_TIMEOUT = 15000;
export const UPLOAD_TIMEOUT = 30000;

/** LifeSpace HomeMew user token TTL 为 15 分钟；提前 2 分钟刷新。 */
export const TOKEN_EXPIRE_BUFFER_MS = 2 * 60 * 1000;

export function normalizeBaseUrl(url: string): string {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function evaluateToken(
  token: string | null | undefined,
  expiresAt: string | null | undefined,
): boolean {
  if (!token || !expiresAt) return false;
  const expireTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expireTime)) return false;
  return Date.now() < expireTime - TOKEN_EXPIRE_BUFFER_MS;
}

export function getCoreBaseUrl(): string {
  const cached = (wx.getStorageSync(STORAGE_KEYS.coreApiUrl) as string) || '';
  return normalizeBaseUrl(cached || CORE_BASE_URL_FALLBACK);
}

export function getLoginBackendUrl(): string {
  const cached = (wx.getStorageSync(STORAGE_KEYS.loginBackendUrl) as string) || '';
  return normalizeBaseUrl(cached || LOGIN_BACKEND_URL_FALLBACK);
}

export function isTokenValid(): boolean {
  const token = wx.getStorageSync(STORAGE_KEYS.accessToken) as string | undefined;
  const expiresAt = wx.getStorageSync(STORAGE_KEYS.tokenExpiresAt) as string | undefined;
  return evaluateToken(token, expiresAt);
}
