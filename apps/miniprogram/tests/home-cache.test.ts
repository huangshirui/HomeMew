import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  cacheHomeAttentionDays,
  cacheHomeEvents,
  cacheHomeTasks,
  readHomeStartupCache,
} from '../miniprogram/services/home-cache.ts';

const storage = new Map<string, unknown>();

(globalThis as any).wx = {
  getStorageSync(key: string) {
    return storage.get(key) ?? '';
  },
  setStorageSync(key: string, value: unknown) {
    storage.set(key, value);
  },
  removeStorageSync(key: string) {
    storage.delete(key);
  },
};

beforeEach(() => storage.clear());

const event = { id: 'evt_1', familyId: 'fam_1', summary: '早餐' } as any;
const task = { id: 'tsk_1', familyId: 'fam_1', name: '倒垃圾', status: 'pending' } as any;
const day = { id: 'day_1', familyId: 'fam_1', name: '滤芯', kind: 'cycle' } as any;

test('home cache is bound to the verified user and family', () => {
  const now = 1_000_000;
  cacheHomeEvents('usr_1', 'fam_1', '2026-09-08', [event], now);
  cacheHomeTasks('usr_1', 'fam_1', [task], now);
  cacheHomeAttentionDays('usr_1', 'fam_1', [day], now);

  assert.deepEqual(
    readHomeStartupCache('usr_1', 'fam_1', '2026-09-08', now + 100),
    { events: [event], tasks: [task], attentionDays: [day] },
  );
  assert.equal(readHomeStartupCache('usr_2', 'fam_1', '2026-09-08', now + 100), null);
  assert.equal(readHomeStartupCache('usr_1', 'fam_2', '2026-09-08', now + 100), null);
});

test('event cache never restores a different viewing date', () => {
  const now = 2_000_000;
  cacheHomeEvents('usr_1', 'fam_1', '2026-09-08', [event], now);
  cacheHomeTasks('usr_1', 'fam_1', [task], now);

  assert.deepEqual(
    readHomeStartupCache('usr_1', 'fam_1', '2026-09-09', now + 100),
    { tasks: [task] },
  );
});

test('home cache expires after 24 hours', () => {
  const now = 3_000_000;
  cacheHomeTasks('usr_1', 'fam_1', [task], now);

  assert.deepEqual(
    readHomeStartupCache('usr_1', 'fam_1', '2026-09-08', now + 24 * 60 * 60 * 1000),
    { tasks: [task] },
  );
  assert.equal(
    readHomeStartupCache('usr_1', 'fam_1', '2026-09-08', now + 24 * 60 * 60 * 1000 + 1),
    null,
  );
});
