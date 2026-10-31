import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { AutoRefreshGate, markRefreshDirty } from '../miniprogram/services/refresh-policy.ts';

const source = (path: string) => readFileSync(new URL(`../miniprogram/${path}`, import.meta.url), 'utf8');

function domainList(listDomainRecords: (...args: any[]) => Promise<any>, familyStore: any) {
  let page: any;
  const script = stripTypeScriptTypes(source('pages/domains/list.ts').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm, ''));
  const copy = { activities: { title: '活动', symbol: 'A' }, goals: { title: '目标', symbol: 'G' }, habits: { title: '习惯', symbol: 'H' }, anniversaries: { title: '纪念日', symbol: 'D' } };
  runInNewContext(script, {
    AutoRefreshGate, markRefreshDirty,
    Page: (def: any) => { page = def; }, currentFamilyStore: familyStore,
    userStore: { value: { id: 'usr_me' } },
    ensureRuntimeReady: async () => {}, listDomainRecords,
    listDomainPeople: async () => [], listPersonalHabitPage: async () => ({ items: [], nextCursor: null }),
    DOMAIN_COPY: copy, STATUS_COPY: {},
    formatInstantInTimeZone: () => ({ date: '2026-10-31' }),
    downloadRecordIconImage: async () => '',
  });
  page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch);
  page.onLoad({ kind: 'activities' });
  return page;
}

const row = (id: string) => ({ id, name: id, status: 'active' });

test('automatic foreground refresh retains a successfully loaded domain list until new data arrives', async () => {
  const family = { value: { id: 'spc_a', timezone: 'Asia/Shanghai' } };
  let calls = 0;
  let resolveNext!: (result: any) => void;
  const page = domainList(async () => {
    calls++;
    if (calls === 1) return { items: [row('first')], nextCursor: null };
    return new Promise(resolve => { resolveNext = resolve; });
  }, family);
  await page.onShow();
  assert.equal(page.data.loadedOnce, true);
  assert.equal(page.data.records[0].id, 'first');
  markRefreshDirty('domains'); // a real edit bypasses the 60s onShow throttle
  const refresh = page.onShow();
  assert.equal(page.data.records[0].id, 'first');
  assert.equal(page.data.loading, false);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(page.data.records[0].id, 'first');
  resolveNext({ items: [row('updated')], nextCursor: null });
  await refresh;
  assert.equal(page.data.records[0].id, 'updated');
  assert.equal(page.data.loading, false);
});

test('network failure retains domain records while a real family change clears them', async () => {
  const family = { value: { id: 'spc_a', timezone: 'Asia/Shanghai' } };
  let calls = 0;
  const page = domainList(async () => {
    calls++;
    if (calls === 1) return { items: [row('visible')], nextCursor: null };
    if (calls === 2) throw new Error('offline');
    return { items: [row('other-family')], nextCursor: null };
  }, family);
  await page.onShow();
  markRefreshDirty('domains');
  await page.onShow();
  assert.equal(page.data.records[0].id, 'visible');
  assert.equal(page.data.error, 'offline');
  assert.equal(page.data.loading, false);
  family.value = { id: 'spc_b', timezone: 'Asia/Shanghai' };
  const newFamily = page.onShow();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(page.data.familyId, 'spc_b');
  assert.equal(page.data.records[0].id, 'other-family');
  await newFamily;
});

test('empty successful home and football refreshes do not reopen full-screen loading', () => {
  const home = source('pages/home/home.ts');
  assert.match(home, /_eventsFetched \|\| this\.data\.todayEvents\.length/);
  assert.match(home, /_lifeFetched\[kind\]/);
  const football = source('pages/football/list.ts');
  assert.match(football, /loading:reset\s*&&\s*!this\.data\.loadedOnce/);
  assert.match(football, /rows:reset\?page\.items/);
  assert.match(source('pages/football/detail.ts'), /loading:!d\.match/);
  assert.match(source('pages/domains/detail.ts'), /loading:!this\.data\.record/);
  assert.match(source('pages/settings/settings.ts'), /accountError:false,user:userStore\.value\|\|this\.data\.user/);
  assert.doesNotMatch(source('pages/account-link/account-link.ts'), /this\.setData\(\{ready:false\}\)/);
  assert.match(source('pages/domains/list.wxml'), /error && !loadedOnce/);
  assert.match(source('pages/football/list.wxml'), /error && !loadedOnce/);
});
