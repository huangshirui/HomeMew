import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../miniprogram/app.ts', import.meta.url), 'utf8');
const activitySource = readFileSync(new URL('../miniprogram/services/activity.ts', import.meta.url), 'utf8');

test('App.onShow reports Mini Program activity from every entry path', () => {
  assert.match(appSource, /onShow\(\)[\s\S]*reportMiniProgramActivityOncePerDay\(\)/);
  assert.doesNotMatch(appSource, /Page\(/);
});

test('Mini Program activity reports once per local day per live process and retries failures', () => {
  assert.match(activitySource, /reportedLocalDay === day/);
  assert.match(activitySource, /await ensureRuntimeReady\(\)/);
  assert.match(activitySource, /reportedLocalDay = day/);
  assert.match(activitySource, /finally[\s\S]*reportPromise = null/);
  assert.match(activitySource, /channel: 'miniprogram'/);
  assert.match(activitySource, /Authorization: `Bearer \$\{token\}`/);
  assert.match(activitySource, /\/api\/v1\/activity\/me/);
});
