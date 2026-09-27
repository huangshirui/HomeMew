import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appJson = JSON.parse(readFileSync(
  new URL('../miniprogram/app.json', import.meta.url),
  'utf8',
));
const authSource = readFileSync(
  new URL('../miniprogram/services/auth.ts', import.meta.url),
  'utf8',
);
const runtimeSource = readFileSync(
  new URL('../miniprogram/services/runtime-bootstrap.ts', import.meta.url),
  'utf8',
);
const entrySource = readFileSync(
  new URL('../miniprogram/services/entry-navigation.ts', import.meta.url),
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
const profileSource = readFileSync(
  new URL('../miniprogram/pages/profile-setup/profile-setup.ts', import.meta.url),
  'utf8',
);
const profileTemplate = readFileSync(
  new URL('../miniprogram/pages/profile-setup/profile-setup.wxml', import.meta.url),
  'utf8',
);
const backendSource = readFileSync(
  new URL('../../backend/worker.mjs', import.meta.url),
  'utf8',
);

test('Home is the default page and the application splash route is retired', () => {
  assert.equal(appJson.pages[0], 'pages/home/home');
  assert.ok(!appJson.pages.includes('pages/launch/launch'));
  assert.ok(appJson.pages.includes('pages/launch/disabled'));
});

test('silent token recovery single-flights all wx.login exchanges', () => {
  assert.match(authSource, /let refreshPromise: Promise<LoginResponse> \| null = null/);
  assert.match(authSource, /if \(refreshPromise\) return refreshPromise/);
  assert.match(authSource, /export async function ensureAccessToken/);
  assert.match(authSource, /forceRefresh/);
});

test('runtime bootstrap loads profile and family authorization in parallel', () => {
  const parallel = runtimeSource.indexOf('const [user, families] = await Promise.all([');
  assert.ok(parallel >= 0, 'runtime bootstrap must parallelize profile and family loads');

  const block = runtimeSource.slice(parallel, runtimeSource.indexOf(']);', parallel) + 3);
  assert.match(block, /loadCurrentUser\(\)/);
  assert.match(block, /loadFamilies\(\{ force: true \}\)/);
  assert.match(runtimeSource, /await ensureAccessToken\(\)/);
});

test('profile and family loading single-flight duplicate startup callers', () => {
  assert.match(storeSource, /let userLoadInFlight: Promise<UserProfile> \| null = null/);
  assert.match(storeSource, /if \(userLoadInFlight\) return userLoadInFlight/);
  assert.match(storeSource, /if \(familiesLoadInFlight\) return familiesLoadInFlight/);
});

test('first-time users keep the default profile and are not forced through profile editing', () => {
  assert.ok(backendSource.includes('displayName: `微信用户${openid.slice(-6)}`'));
  assert.doesNotMatch(authSource, /newUserPending|isNewUserOnboardingPending|markNewUserOnboardingComplete/);
  assert.doesNotMatch(entrySource, /reLaunchProfileSetup|needsProfileSetup|微信用户/);
  assert.match(entrySource, /pendingEntry/);
  assert.match(entrySource, /export function resumePendingEntry/);
  assert.match(entrySource, /options\.query/);
});

test('profile customization is user-initiated and a saved nickname cannot be empty', () => {
  assert.match(profileSource, /if \(!displayName\.trim\(\)\)/);
  assert.match(profileTemplate, /编辑资料/);
  assert.doesNotMatch(profileTemplate, /开始使用|设置资料/);
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
