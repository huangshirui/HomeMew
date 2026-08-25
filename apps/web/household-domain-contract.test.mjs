import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function requireAll(text, patterns, label) {
  for (const pattern of patterns) assert.match(text, pattern, `${label} must retain ${pattern}`);
}

test('household pages keep their LifeSpace model and Action routes', () => {
  const calendar = source('./src/pages/calendar-page.tsx');
  const tasks = source('./src/pages/tasks-page.tsx');
  const days = source('./src/pages/days-page.tsx');
  const wishes = source('./src/pages/wishes-page.tsx');
  const home = source('./src/pages/home-page.tsx');

  requireAll(calendar, [
    /\/events\?\$\{params\}/u,
    /\/events`/u,
    /\/events\/\$\{encodeURIComponent\(editing\.id\)\}/u,
    /method: 'POST'/u,
    /method: 'PATCH'/u,
    /method: 'DELETE'/u,
  ], 'Calendar');

  requireAll(tasks, [
    /\/tasks\?\$\{params\}/u,
    /\/tasks`/u,
    /\/tasks\/\$\{encodeURIComponent\(editing\.id\)\}/u,
    /action: 'complete' \| 'reopen'/u,
    /\/actions\/\$\{action\}/u,
  ], 'Tasks');

  requireAll(days, [
    /\/day-records\?\$\{params\}/u,
    /\/day-records`/u,
    /actionKey: 'archive' \| 'restore'/u,
    /\/actions\/\$\{actionKey\}/u,
    /\/actions\/record-occurrence/u,
  ], 'Days');

  requireAll(wishes, [
    /\/wishes`/u,
    /actionKey: 'claim' \| 'unclaim' \| 'fulfill' \| 'reopen' \| 'archive' \| 'restore'/u,
    /\/actions\/\$\{actionKey\}/u,
  ], 'Wishes');

  requireAll(home, [
    /\/events\?\$\{eventParams\}/u,
    /\/tasks\?\$\{taskParams\}/u,
    /\/day-records\?\$\{dayParams\}/u,
    /\/actions\/complete/u,
  ], 'Home');
});
