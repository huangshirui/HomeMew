/**
 * 统一配置：HomeMew 应用后端、LifeSpace Identity/Core、Storage key、超时与 Token 判断。
 */

/** HomeMew Cloudflare 应用后端。这里只承载微信身份映射和用户 Token 交换。 */
export const LOGIN_BACKEND_URL_FALLBACK = 'https://homemew.aisr.online';
export const IDENTITY_BASE_URL_FALLBACK = 'https://auth.aisr.online';
export const CORE_BASE_URL_FALLBACK = 'https://core.aisr.online';

export const STORAGE_KEYS = {
  accessToken: 'accessToken',
  tokenExpiresAt: 'tokenExpiresAt',
  currentFamilyId: 'currentFamilyId',
  coreApiUrl: 'coreApiUrl',
  loginBackendUrl: 'loginBackendUrl',
  identityApiUrl: 'identityApiUrl',
  eventsScope: 'eventsScope',
  tasksScope: 'tasksScope',
  timeZoneMode: 'timeZoneMode',
  timeZoneCustom: 'timeZoneCustom',
} as const;

export const REQUEST_TIMEOUT = 15000;
export const UPLOAD_TIMEOUT = 30000;
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

export function getIdentityBaseUrl(): string {
  const cached = (wx.getStorageSync(STORAGE_KEYS.identityApiUrl) as string) || '';
  return normalizeBaseUrl(cached || IDENTITY_BASE_URL_FALLBACK);
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
