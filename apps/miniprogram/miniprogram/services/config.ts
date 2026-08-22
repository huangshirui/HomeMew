/**
 * 统一配置：HomeMew 应用后端、LifeSpace Identity/Core、Storage key、超时与 Token 判断。
 */

const PROD_LOGIN_BACKEND_URL = 'https://homemew.aisr.online';
const PROD_IDENTITY_BASE_URL = 'https://auth.aisr.online';
const PROD_CORE_BASE_URL = 'https://core.aisr.online';

const STAGING_LOGIN_BACKEND_URL = 'https://homemew-staging.aisr.online';
const STAGING_IDENTITY_BASE_URL = 'https://auth-staging.aisr.online';
const STAGING_CORE_BASE_URL = 'https://core-staging.aisr.online';

export type RuntimeEnvironment = 'staging' | 'production';

/**
 * Phase 7 production cutover 已完成。当前 main 明确固定到 production，
 * 因此微信开发者工具、体验版和正式版都访问正式 HomeMew/LifeSpace。
 * staging 地址继续保留，后续如需恢复环境分流必须通过显式代码变更完成。
 */
const ACTIVE_RUNTIME_ENVIRONMENT: RuntimeEnvironment = 'production';

export const STORAGE_KEYS = {
  accessToken: 'accessToken',
  tokenExpiresAt: 'tokenExpiresAt',
  currentFamilyId: 'currentFamilyId',
  coreApiUrl: 'coreApiUrl',
  loginBackendUrl: 'loginBackendUrl',
  identityApiUrl: 'identityApiUrl',
  runtimeEnvironment: 'runtimeEnvironment',
  eventsScope: 'eventsScope',
  tasksScope: 'tasksScope',
  timeZoneMode: 'timeZoneMode',
  timeZoneCustom: 'timeZoneCustom',
} as const;

export const REQUEST_TIMEOUT = 15000;
export const UPLOAD_TIMEOUT = 30000;
export const TOKEN_EXPIRE_BUFFER_MS = 2 * 60 * 1000;

export function resolveRuntimeEnvironment(_envVersion: string | undefined): RuntimeEnvironment {
  return ACTIVE_RUNTIME_ENVIRONMENT;
}

export function getRuntimeEnvironment(): RuntimeEnvironment {
  return ACTIVE_RUNTIME_ENVIRONMENT;
}

function runtimeDefaults(): { loginBackendUrl: string; identityApiUrl: string; coreApiUrl: string } {
  if (getRuntimeEnvironment() === 'production') {
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

/**
 * 防止历史 staging/production Storage 把客户端带到错误环境。
 * 首次运行新隔离逻辑、或运行环境发生切换时，仅清理环境相关状态；
 * 时区等纯 UI 偏好继续保留。
 */
export function ensureRuntimeEnvironmentStorage(): RuntimeEnvironment {
  const current = getRuntimeEnvironment();
  const previous = wx.getStorageSync(STORAGE_KEYS.runtimeEnvironment) as RuntimeEnvironment | '';
  if (previous !== current) {
    for (const key of [
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.tokenExpiresAt,
      STORAGE_KEYS.currentFamilyId,
      STORAGE_KEYS.coreApiUrl,
      STORAGE_KEYS.identityApiUrl,
      STORAGE_KEYS.loginBackendUrl,
    ]) {
      wx.removeStorageSync(key);
    }
    wx.setStorageSync(STORAGE_KEYS.runtimeEnvironment, current);
  }
  return current;
}

export function normalizeBaseUrl(url: string): string {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

/** LifeSpace Identity exposes a stable public avatar URL per global user. */
export function buildUserAvatarUrl(identityBaseUrl: string, userId: string): string {
  return `${normalizeBaseUrl(identityBaseUrl)}/assets/users/${encodeURIComponent(userId)}/avatar`;
}

function environmentSafeUrl(cached: string, expected: string): string {
  const normalized = normalizeBaseUrl(cached);
  // 服务 URL 由受信 HomeMew backend 下发，但缓存必须属于当前运行环境。
  // 当前各环境均使用唯一 canonical origin，因此跨环境旧值直接忽略。
  return normalized === expected ? normalized : expected;
}

export function getRuntimeServiceUrls(): { loginBackendUrl: string; identityApiUrl: string; coreApiUrl: string } {
  const defaults = runtimeDefaults();
  return {
    loginBackendUrl: environmentSafeUrl(
      (wx.getStorageSync(STORAGE_KEYS.loginBackendUrl) as string) || '',
      defaults.loginBackendUrl,
    ),
    identityApiUrl: environmentSafeUrl(
      (wx.getStorageSync(STORAGE_KEYS.identityApiUrl) as string) || '',
      defaults.identityApiUrl,
    ),
    coreApiUrl: environmentSafeUrl(
      (wx.getStorageSync(STORAGE_KEYS.coreApiUrl) as string) || '',
      defaults.coreApiUrl,
    ),
  };
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
  return getRuntimeServiceUrls().coreApiUrl;
}

export function getIdentityBaseUrl(): string {
  return getRuntimeServiceUrls().identityApiUrl;
}

export function getUserAvatarUrl(userId: string): string {
  return buildUserAvatarUrl(getIdentityBaseUrl(), userId);
}

export function getLoginBackendUrl(): string {
  return getRuntimeServiceUrls().loginBackendUrl;
}

export function isTokenValid(): boolean {
  const token = wx.getStorageSync(STORAGE_KEYS.accessToken) as string | undefined;
  const expiresAt = wx.getStorageSync(STORAGE_KEYS.tokenExpiresAt) as string | undefined;
  return evaluateToken(token, expiresAt);
}
