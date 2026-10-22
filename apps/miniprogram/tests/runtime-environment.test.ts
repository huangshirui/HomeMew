import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUserAvatarUrl,
  resolveRuntimeEnvironment,
  ensureProductionRuntimeStorage,
  getApplicationBaseUrl,
  STORAGE_KEYS,
} from '../miniprogram/services/config.ts';

test('Mini development / trial / release all remain LifeSpace production', () => {
  for (const envVersion of [undefined, 'develop', 'trial', 'release']) {
    assert.equal(resolveRuntimeEnvironment(envVersion), 'production');
  }
  assert.equal(getApplicationBaseUrl(), 'https://homemew.aisr.online');
});

test('Mini URL is never redirected by a staging launch parameter', () => {
  assert.equal(getApplicationBaseUrl(), 'https://homemew.aisr.online');
  assert.equal(getApplicationBaseUrl().includes('/_stage'), false);
});

test('buildUserAvatarUrl uses the same production BFF in all Mini builds', () => {
  assert.equal(
    buildUserAvatarUrl('https://homemew.aisr.online/', 'usr_example'),
    'https://homemew.aisr.online/api/v1/miniprogram/media/users/usr_example/avatar',
  );
});

test('one-time migration discards stale staging login and family state', () => {
  const initial: Record<string, string> = {
    [STORAGE_KEYS.runtimeEnvironment]: 'staging',
    [STORAGE_KEYS.accessToken]: 'old-staging-token',
    [STORAGE_KEYS.currentFamilyId]: 'staging-family',
    [STORAGE_KEYS.homeCache]: 'old-staging-cache',
  };
  const storage = new Map(Object.entries(initial));
  const oldWx = (globalThis as { wx?: unknown }).wx;
  (globalThis as { wx?: unknown }).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: string) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  };
  try {
    ensureProductionRuntimeStorage();
    assert.equal(storage.get(STORAGE_KEYS.runtimeEnvironment), 'production');
    assert.equal(storage.has(STORAGE_KEYS.accessToken), false);
    assert.equal(storage.has(STORAGE_KEYS.currentFamilyId), false);
    assert.equal(storage.has(STORAGE_KEYS.homeCache), false);
  } finally {
    if (oldWx === undefined) delete (globalThis as { wx?: unknown }).wx;
    else (globalThis as { wx?: unknown }).wx = oldWx;
  }
});
