import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${root}/`), 'utf8');

test('Task and Wish lists use the LifeSpace structured Canonical Query endpoint', () => {
  const helper = read('miniprogram/services/canonical-query.ts');
  const tasks = read('miniprogram/services/tasks.ts');
  const wishes = read('miniprogram/services/wishes.ts');

  assert.match(helper, /records\/query|modelCollectionPath\(spaceId, modelKey\)\}\/query/);
  assert.match(helper, /method: 'POST'/);

  assert.match(tasks, /queryModelRecords<TaskResource>\(familyId, 'task'/);
  assert.match(tasks, /field: 'assigneePersonIds', op: 'contains'/);
  assert.match(tasks, /field: 'dueDate', op: 'gte'/);
  assert.match(tasks, /field: 'dueDate', op: 'lte'/);
  assert.match(tasks, /field: 'dueDate', op: 'isNull'/);
  assert.doesNotMatch(tasks, /items\.filter\(item => inDueRange/);

  assert.match(wishes, /queryModelRecords<WishResource>\(familyId, 'wish'/);
  assert.match(wishes, /field: 'ownerPersonId', op: 'contains'/);
  assert.match(wishes, /field: 'desiredDate', op: 'gte'/);
  assert.match(wishes, /field: 'desiredDate', op: 'lte'/);
});


test('Event lists use canonical TemporalRange query and service-boundary mapping', () => {
  const helper = read('miniprogram/services/canonical-query.ts');
  const events = read('miniprogram/services/events.ts');

  assert.match(helper, /context\?: \{ viewingTimezone: string \}/);
  assert.match(events, /queryModelRecords<EventResource>\(familyId, 'event'/);
  assert.match(events, /field: 'when'/);
  assert.match(events, /op: 'overlaps'/);
  assert.match(events, /kind: 'local_date_window'/);
  assert.match(events, /sort: \[\{ field: 'when', direction: 'asc' \}\]/);
  assert.match(events, /context: \{ viewingTimezone: params\.timezone \}/);
  assert.match(events, /when: TemporalRange/);
  assert.match(events, /kind: 'instant'/);
  assert.match(events, /kind: 'date'/);
  assert.doesNotMatch(events, /rangeStart:/);
  assert.doesNotMatch(events, /calendarStart:asc/);
});
