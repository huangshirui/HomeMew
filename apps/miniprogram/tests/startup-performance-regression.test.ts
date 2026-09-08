import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const launchSource = readFileSync(
  new URL('../miniprogram/pages/launch/launch.ts', import.meta.url),
  'utf8',
);
const storeSource = readFileSync(
  new URL('../miniprogram/stores/index.ts', import.meta.url),
  'utf8',
);
const homeSource = readFileSync(
  new URL('../miniprogram/pages/home/home.ts', import.meta.url),
  'utf8',
);

test('launch loads profile and family authorization in parallel', () => {
  const parallel = launchSource.indexOf('const [user, families] = await Promise.all([');
  assert.ok(parallel >= 0, 'launch must parallelize profile and family loads');

  const block = launchSource.slice(parallel, launchSource.indexOf(']);', parallel) + 3);
  assert.match(block, /loadCurrentUser\(\)/);
  assert.match(block, /loadFamilies\(\{ force: true \}\)/);
});

test('family loading reuses the just-verified launch result and single-flights duplicates', () => {
  assert.match(storeSource, /FAMILY_LIST_REUSE_WINDOW_MS = 5 \* 1000/);
  assert.match(storeSource, /if \(familiesLoadInFlight\) return familiesLoadInFlight/);
  assert.match(storeSource, /currentFamilyStore\.value !== family/);
});

test('home restores cache before issuing live domain refreshes', () => {
  const loadData = homeSource.indexOf('async loadData(): Promise<void>');
  const hydrate = homeSource.indexOf('this._hydrateHomeStartupCache(current.id);', loadData);
  const events = homeSource.indexOf('this.loadTodayEvents(current.id);', loadData);
  const tasks = homeSource.indexOf('this.loadTasks(current.id);', loadData);
  const days = homeSource.indexOf('this.loadAttentionDays(current.id);', loadData);

  assert.ok(loadData >= 0 && hydrate > loadData, 'home loadData must hydrate local cache');
  assert.ok(hydrate < events && hydrate < tasks && hydrate < days, 'cache must render before live refresh');
  assert.match(homeSource, /cacheHomeEvents\(/);
  assert.match(homeSource, /cacheHomeTasks\(/);
  assert.match(homeSource, /cacheHomeAttentionDays\(/);
});
