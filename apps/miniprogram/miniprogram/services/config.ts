/**
 * 统一配置：HomeMew 应用后端、LifeSpace Identity/Core、Storage key、超时与 Token 判断。
 */

const PROD_LOGIN_BACKEND_URL = 'https://homemew.aisr.online';
const PROD_IDENTITY_BASE_URL = 'https://auth.aisr.online';
const PROD_CORE_BASE_URL = 'https://core.aisr.online';

const STAGING_LOGIN_BACKEND_URL = 'https://homemew-staging.aisr.online';
const STAGING_IDENTITY_BASE_URL = 'https://auth-staging.aisr.online';
const STAGING_CORE_BASE_URL = 'https://core-staging.aisr.online';

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

function isReleaseMiniProgram(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'release';
  } catch (_) {
    // API 在当前基础库可用；若异常，优先保持 production 默认，避免发布版误连 staging。
    return true;
  }
}

function runtimeDefaults(): { loginBackendUrl: string; identityApiUrl: string; coreApiUrl: string } {
  if (isReleaseMiniProgram()) {
    return {
      loginBackendUrl: PROD_LOGIN_BACKEND_URL,
      identityApiUrl: PROD_IDENTITY_BASE_URL,
      coreApiUrl: PROD_CORE_BASE_URL,
    };
  }
  return {
    loginBackendUrl: STAGING_LOGIN_BACKEND_URL,
    identityApiUrl: STAGING_IDENTITY_BASE_URL,
    coreApiUrl: STAGING_CORE_BASE_URL,
  };
}

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
  return normalizeBaseUrl(cached || runtimeDefaults().coreApiUrl);
}

export function getIdentityBaseUrl(): string {
  const cached = (wx.getStorageSync(STORAGE_KEYS.identityApiUrl) as string) || '';
  return normalizeBaseUrl(cached || runtimeDefaults().identityApiUrl);
}

export function getLoginBackendUrl(): string {
  const cached = (wx.getStorageSync(STORAGE_KEYS.loginBackendUrl) as string) || '';
  return normalizeBaseUrl(cached || runtimeDefaults().loginBackendUrl);
}

export function isTokenValid(): boolean {
  const token = wx.getStorageSync(STORAGE_KEYS.accessToken) as string | undefined;
  const expiresAt = wx.getStorageSync(STORAGE_KEYS.tokenExpiresAt) as string | undefined;
  return evaluateToken(token, expiresAt);
}
