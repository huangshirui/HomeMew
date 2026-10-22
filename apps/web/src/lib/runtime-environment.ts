/**
 * An explicit URL entry selects the LifeSpace environment for the current browser tab.
 * The URL is not a UI feature toggle. Every HTTP resource (including images) uses the
 * same fixed, server-routed environment prefix. No arbitrary origin is accepted.
 */
export type RuntimeEnvironment = 'production' | 'staging';
const STORAGE_KEY = 'homemew.web.runtimeEnvironment';

export function getRuntimeEnvironment(): RuntimeEnvironment {
  if (typeof window === 'undefined') return 'production';
  const query = new URL(window.location.href).searchParams.get('env');
  if (query === 'staging' || query === 'production') {
    try { window.sessionStorage.setItem(STORAGE_KEY, query); } catch { /* preference only */ }
    return query;
  }
  try { return window.sessionStorage.getItem(STORAGE_KEY) === 'staging' ? 'staging' : 'production'; }
  catch { return 'production'; }
}

export function environmentApiPath(path: string): string {
  if (!path.startsWith('/api/') && path !== '/health') throw new Error('Invalid HomeMew API path');
  return getRuntimeEnvironment() === 'staging' ? '/_stage' + path : path;
}
