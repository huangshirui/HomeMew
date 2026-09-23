/**
 * App-level entry coordination for direct-entry Mini Program UX.
 *
 * The first visible page is always the requested business page (or Home by default).
 * This coordinator only redirects when a cross-cutting product state requires it:
 * - first-time/incomplete profile -> profile setup, then resume the original entry;
 * - disabled account -> disabled page, then retry/resume after the account is restored.
 *
 * Token refresh and runtime bootstrap remain silent infrastructure concerns.
 */

import {
  isNewUserOnboardingPending,
} from './auth';
import {
  ensureRuntimeReady,
  resetRuntimeReady,
} from './runtime-bootstrap';
import {
  clearUserState,
  userStore,
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
const PROFILE_SETUP_PATH = 'pages/profile-setup/profile-setup';
const DISABLED_PATH = 'pages/launch/disabled';

let pendingEntry: EntryTarget | null = null;
let coordinationPromise: Promise<void> | null = null;

function normalizedPath(path?: string): string {
  const value = String(path || HOME_PATH).replace(/^\/+/, '');
  return value.startsWith('pages/') ? value : HOME_PATH;
}

function currentPath(): string {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1] as { route?: string } | undefined;
  return normalizedPath(current?.route);
}

function rememberEntry(options: AppEntryOptions): void {
  const path = normalizedPath(options.path);
  if (path === PROFILE_SETUP_PATH || path === DISABLED_PATH) return;
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

function needsProfileSetup(): boolean {
  const user = userStore.value;
  if (!user) return false;
  return isNewUserOnboardingPending() || !user.displayName?.trim();
}

function reLaunchProfileSetup(): void {
  if (currentPath() === PROFILE_SETUP_PATH) return;
  wx.reLaunch({
    url: '/pages/profile-setup/profile-setup?onboarding=1',
  });
}

function reLaunchDisabled(): void {
  if (currentPath() === DISABLED_PATH) return;
  wx.reLaunch({
    url: '/pages/launch/disabled',
  });
}

function isDisabledError(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  return value?.code === 'USER_DISABLED' || Boolean(value?.message?.includes('禁用'));
}

/**
 * Called from App.onShow. It never inserts a splash page and never changes a
 * normal authenticated user's requested navigation path.
 */
export async function coordinateAppEntry(options: AppEntryOptions = {}): Promise<void> {
  rememberEntry(options);
  if (coordinationPromise) return coordinationPromise;

  coordinationPromise = (async () => {
    try {
      await ensureRuntimeReady();

      if (needsProfileSetup()) {
        reLaunchProfileSetup();
      }
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
 * Called after first-time profile setup. reLaunch is used so query parameters
 * from a deep link (task detail, invite, date anchor, etc.) are preserved.
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

  try {
    await ensureRuntimeReady({ force: true });
    if (needsProfileSetup()) {
      reLaunchProfileSetup();
      return;
    }
    resumePendingEntry();
  } catch (error) {
    if (isDisabledError(error)) throw error;
    throw error;
  }
}
