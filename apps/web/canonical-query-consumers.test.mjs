import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Web Task and Wish lists use the LifeSpace structured Canonical Query endpoint', () => {
  const helper = read('src/lib/canonical-query.ts');
  const tasks = read('src/pages/tasks-page.tsx');
  const wishes = read('src/pages/wishes-page.tsx');

  assert.match(helper, /records\/query/);
  assert.match(helper, /method: 'POST'/);
  assert.match(tasks, /queryModelRecords<TaskRecord>\(currentFamily\.id, 'task'/);
  assert.match(tasks, /search: \{ text: query \}/);
  assert.match(tasks, /field: 'status', op: 'eq'/);
  assert.match(wishes, /queryModelRecords<WishRecord>\(currentFamily\.id, 'wish'/);
  assert.match(wishes, /field: 'status', op: 'eq'/);
});


test('Web Calendar uses canonical TemporalRange resources and query', () => {
  const helper = read('src/lib/canonical-query.ts');
  const calendar = read('src/pages/calendar-page.tsx');

  assert.match(helper, /context\?: \{ viewingTimezone: string \}/);
  assert.match(calendar, /when:\s*[\s\S]*kind: 'instant'/);
  assert.match(calendar, /queryModelRecords<EventRecord>\(currentFamily\.id, 'event'/);
  assert.match(calendar, /field: 'when'/);
  assert.match(calendar, /op: 'overlaps'/);
  assert.match(calendar, /kind: 'local_date_window'/);
  assert.match(calendar, /sort: \[\{ field: 'when', direction: 'asc' \}\]/);
  assert.match(calendar, /context: \{ viewingTimezone: currentFamily\.timezone \}/);
  assert.doesNotMatch(calendar, /calendarStart:asc/);
  assert.doesNotMatch(calendar, /rangeStart,/);
});
