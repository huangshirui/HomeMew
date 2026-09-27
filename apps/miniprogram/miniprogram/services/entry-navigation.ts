/**
 * App-level entry coordination for direct-entry Mini Program UX.
 *
 * The first visible page is always the requested business page (or Home by default).
 * New users keep the default profile created by the HomeMew backend and are never
 * forced through profile editing before they can browse the product.
 *
 * This coordinator only redirects for an explicit disabled-account state. Token
 * refresh and runtime bootstrap remain silent infrastructure concerns.
 */

import {
  ensureRuntimeReady,
  resetRuntimeReady,
} from './runtime-bootstrap';
import {
  clearUserState,
} from '../stores/index';

type EntryQuery = Record<string, string | number | boolean | null | undefined>;

export type AppEntryOptions = {
  path?: string;
  query?: EntryQuery;
};

type EntryTarget = {
  path: string;
  query: EntryQuery;
};

const HOME_PATH = 'pages/home/home';
const DISABLED_PATH = 'pages/launch/disabled';

let pendingEntry: EntryTarget | null = null;
let coordinationPromise: Promise<void> | null = null;

function normalizedPath(path?: string): string {
  const value = String(path || HOME_PATH).replace(/^\/+/, '');
  return value.startsWith('pages/') ? value : HOME_PATH;
}

function rememberEntry(options: AppEntryOptions): void {
  const path = normalizedPath(options.path);
  if (path === DISABLED_PATH) return;
  pendingEntry = {
    path,
    query: { ...(options.query || {}) },
  };
}

function targetUrl(target: EntryTarget): string {
  const query = Object.entries(target.query)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `/${target.path}${query ? `?${query}` : ''}`;
}

function reLaunchDisabled(): void {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1] as { route?: string } | undefined;
  if (normalizedPath(current?.route) === DISABLED_PATH) return;
  wx.reLaunch({
    url: '/pages/launch/disabled',
  });
}

function isDisabledError(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  return value?.code === 'USER_DISABLED' || Boolean(value?.message?.includes('禁用'));
}

/**
 * Called from App.onShow. It never inserts a splash/profile gate and never changes
 * a normal user's requested navigation path.
 */
export async function coordinateAppEntry(options: AppEntryOptions = {}): Promise<void> {
  rememberEntry(options);
  if (coordinationPromise) return coordinationPromise;

  coordinationPromise = (async () => {
    try {
      await ensureRuntimeReady();
    } catch (error) {
      if (isDisabledError(error)) {
        resetRuntimeReady();
        clearUserState();
        reLaunchDisabled();
        return;
      }

      // Network/service failures stay on the requested page. That page's normal
      // loading/error UI owns retry instead of an application-level error screen.
      console.warn('[Entry] Runtime preparation failed:', error);
    }
  })();

  try {
    await coordinationPromise;
  } finally {
    coordinationPromise = null;
  }
}

/**
 * Used after a disabled-account retry so a deep link can resume where it started.
 */
export function resumePendingEntry(): void {
  const target = pendingEntry || { path: HOME_PATH, query: {} };
  pendingEntry = null;
  wx.reLaunch({ url: targetUrl(target) });
}

/**
 * Disabled page explicit retry. If the account becomes usable, continue the
 * original entry rather than forcing the user through Home.
 */
export async function retryDisabledEntry(): Promise<void> {
  resetRuntimeReady();
  clearUserState();
  await ensureRuntimeReady({ force: true });
  resumePendingEntry();
}
