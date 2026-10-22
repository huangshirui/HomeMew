/** HomeMew Mini Program runtime boundary and local storage configuration. */

const PROD_APPLICATION_BASE_URL = 'https://homemew.aisr.online';

export type RuntimeEnvironment = 'production' | 'staging';
let activeRuntimeEnvironment: RuntimeEnvironment = 'production';

/** Explicit Mini launch query only; not a UI toggle and never arbitrary URLs. */
export function selectLaunchEnvironment(value: unknown): boolean {
  if (value !== 'staging' && value !== 'production') return false;
  if (activeRuntimeEnvironment === value) return false;
  activeRuntimeEnvironment = value;
  return true;
}

export const STORAGE_KEYS = {
  accessToken: 'accessToken',
  tokenExpiresAt: 'tokenExpiresAt',
  currentFamilyId: 'currentFamilyId',
  runtimeEnvironment: 'runtimeEnvironment',
  eventsScope: 'eventsScope',
  tasksScope: 'tasksScope',
  timeZoneMode: 'timeZoneMode',
  timeZoneCustom: 'timeZoneCustom',
  homeCache: 'homeCacheV1',
} as const;

export const REQUEST_TIMEOUT = 15000;
export const UPLOAD_TIMEOUT = 30000;
export const TOKEN_EXPIRE_BUFFER_MS = 2 * 60 * 1000;

export function resolveRuntimeEnvironment(_envVersion: string | undefined): RuntimeEnvironment {
  return activeRuntimeEnvironment;
}

export function getRuntimeEnvironment(): RuntimeEnvironment {
  return activeRuntimeEnvironment;
}

/** Remove pre-BFF cached service addresses while retaining UI preferences. */
export function ensureRuntimeEnvironmentStorage(): RuntimeEnvironment {
  const current = getRuntimeEnvironment();
  const previous = wx.getStorageSync(STORAGE_KEYS.runtimeEnvironment) as string;
  if (previous !== current) {
    for (const key of [
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.tokenExpiresAt,
      STORAGE_KEYS.currentFamilyId,
      STORAGE_KEYS.homeCache,
      'coreApiUrl',
      'identityApiUrl',
      'loginBackendUrl',
    ]) wx.removeStorageSync(key);
    wx.setStorageSync(STORAGE_KEYS.runtimeEnvironment, current);
  }
  return current;
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getApplicationBaseUrl(): string {
  return getRuntimeEnvironment() === 'staging' ? PROD_APPLICATION_BASE_URL + '/_stage' : PROD_APPLICATION_BASE_URL;
}

export function buildUserAvatarUrl(applicationBaseUrl: string, userId: string): string {
  return `${normalizeBaseUrl(applicationBaseUrl)}/api/v1/miniprogram/media/users/${encodeURIComponent(userId)}/avatar`;
}

export function getUserAvatarUrl(userId: string): string {
  return buildUserAvatarUrl(getApplicationBaseUrl(), userId);
}

export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function evaluateToken(token: string | null | undefined, expiresAt: string | null | undefined): boolean {
  if (!token || !expiresAt) return false;
  const expireTime = new Date(expiresAt).getTime();
  return !Number.isNaN(expireTime) && Date.now() < expireTime - TOKEN_EXPIRE_BUFFER_MS;
}

export function isTokenValid(): boolean {
  return evaluateToken(
    wx.getStorageSync(STORAGE_KEYS.accessToken) as string | undefined,
    wx.getStorageSync(STORAGE_KEYS.tokenExpiresAt) as string | undefined,
  );
}
