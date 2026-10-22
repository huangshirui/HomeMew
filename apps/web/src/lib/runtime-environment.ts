/**
 * LifeSpace target is selected only by the explicit URL parameter.
 * Cloudflare Worker Production/Preview determines the *code version* independently.
 * Missing or invalid env always means LifeSpace production, even after visiting staging.
 */
import type { To } from 'react-router-dom';

export type RuntimeEnvironment = 'production' | 'staging';

export function getRuntimeEnvironment(): RuntimeEnvironment {
  if (typeof window === 'undefined') return 'production';
  return new URLSearchParams(window.location.search).get('env') === 'staging' ? 'staging' : 'production';
}

export function withRuntimeEnvironment(to: To): To {
  if (getRuntimeEnvironment() !== 'staging') return to;
  if (typeof to === 'string') {
    const fragmentIndex = to.indexOf('#');
    const beforeHash = fragmentIndex < 0 ? to : to.slice(0, fragmentIndex);
    const fragment = fragmentIndex < 0 ? '' : to.slice(fragmentIndex);
    const queryIndex = beforeHash.indexOf('?');
    const path = queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex);
    const search = new URLSearchParams(queryIndex < 0 ? '' : beforeHash.slice(queryIndex + 1));
    search.set('env', 'staging');
    return `${path}?${search.toString()}${fragment}`;
  }
  const search = new URLSearchParams(to.search?.replace(/^\?/, '') ?? '');
  search.set('env', 'staging');
  return { ...to, search: `?${search.toString()}` };
}

export function environmentApiPath(path: string): string {
  if (!path.startsWith('/api/') && path !== '/health') throw new Error('Invalid HomeMew API path');
  return getRuntimeEnvironment() === 'staging' ? '/_stage' + path : path;
}
