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

test('household pages keep their canonical LifeSpace modelKey and Action routes', () => {
  const calendar = source('./src/pages/calendar-page.tsx');
  const tasks = source('./src/pages/tasks-page.tsx');
  const days = source('./src/pages/days-page.tsx');
  const wishes = source('./src/pages/wishes-page.tsx');
  const home = source('./src/pages/home-page.tsx');
  const canonicalQuery = source('./src/lib/canonical-query.ts');

  requireAll(calendar, [
    /queryModelRecords<EventRecord>\(currentFamily\.id, 'event'/u,
    /\/models\/event\/records`/u,
    /\/models\/event\/records\/\$\{encodeURIComponent\(editing\.id\)\}/u,
    /method: 'POST'/u,
    /method: 'PATCH'/u,
    /method: 'DELETE'/u,
  ], 'Calendar');

  requireAll(tasks, [
    /queryModelRecords<TaskRecord>\(currentFamily\.id, 'task'/u,
    /\/models\/task\/records`/u,
    /\/models\/task\/records\/\$\{encodeURIComponent\(editing\.id\)\}/u,
    /action: 'complete' \| 'reopen'/u,
    /\/actions\/\$\{action\}/u,
  ], 'Tasks');

  requireAll(days, [
    /\/models\/day_record\/records\?\$\{params\}/u,
    /\/models\/day_record\/records`/u,
    /actionKey: 'archive' \| 'restore'/u,
    /\/actions\/\$\{actionKey\}/u,
    /\/actions\/record-occurrence/u,
  ], 'Days');

  requireAll(wishes, [
    /queryModelRecords<WishRecord>\(currentFamily\.id, 'wish'/u,
    /\/models\/wish\/records`/u,
    /actionKey: 'fulfill' \| 'reopen'/u,
    /\/actions\/\$\{actionKey\}/u,
  ], 'Wishes');

  requireAll(canonicalQuery, [
    /\/models\/\$\{encodeURIComponent\(modelKey\)\}\/records\/query/u,
    /method: 'POST'/u,
  ], 'Canonical Query transport');

  requireAll(home, [
    /queryModelRecords<EventRecord>\(currentFamily\.id, 'event'/u,
    /\/models\/task\/records\?\$\{taskParams\}/u,
    /\/models\/day_record\/records\?\$\{dayParams\}/u,
    /\/models\/task\/records\/\$\{encodeURIComponent\(task\.id\)\}\/actions\/complete/u,
  ], 'Home');

  for (const [label, text] of [['Calendar', calendar], ['Tasks', tasks], ['Days', days], ['Wishes', wishes], ['Home', home]]) {
    assert.doesNotMatch(text, /\/spaces\/\$\{encodeURIComponent\(currentFamily\.id\)\}\/(?:events|tasks|day-records|wishes)(?:[/?`])/u, `${label} must not retain pre-modelKey ordinary Runtime paths`);
  }
});
