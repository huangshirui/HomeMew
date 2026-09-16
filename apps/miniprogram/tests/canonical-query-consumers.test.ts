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

test('Core latency business probe exercises the canonical Task query route', () => {
  const latency = read('miniprogram/services/core-latency.ts');
  assert.match(latency, /models\/task\/records\/query/);
  assert.match(latency, /method: 'POST'/);
  assert.doesNotMatch(latency, /\/tasks\?status=/);
});

test('Space invite bearer tokens stay in request bodies instead of URL paths', () => {
  const families = read('miniprogram/services/families.ts');
  assert.match(families, /'\/api\/v1\/space-invites\/preview'/);
  assert.match(families, /data: \{ token: code \}/);
  assert.match(families, /'\/api\/v1\/space-invites\/join'/);
  assert.match(families, /data: \{ token: code, displayName: me\.displayName \}/);
  assert.doesNotMatch(families, /space-invites\/\$\{encodeURIComponent\(code\)\}/);
});

test('Event traffic is isolated behind the HomeMew Mini Program BFF boundary', () => {
  const api = read('miniprogram/services/api.ts');
  const events = read('miniprogram/services/events.ts');

  assert.match(api, /target\?: 'core' \| 'identity' \| 'backend'/);
  assert.match(api, /target === 'backend'/);
  assert.match(events, /\/api\/v1\/miniprogram\/spaces\/\$\{encodeURIComponent\(spaceId\)\}\/events/);
  assert.match(events, /target: 'backend'/);
  assert.match(events, /timezone: params\.timezone/);
  assert.doesNotMatch(events, /modelCollectionPath\(familyId, 'event'\)/);
  assert.doesNotMatch(events, /modelRecordPath\(familyId, 'event'/);
});
