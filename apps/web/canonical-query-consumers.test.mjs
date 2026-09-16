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

test('Web Space invite bearer tokens stay in request bodies instead of URL paths', () => {
  const family = read('src/pages/family-page.tsx');
  assert.match(family, /'\/api\/lifespace\/core\/v1\/space-invites\/preview'/);
  assert.match(family, /JSON\.stringify\(\{ token \}\)/);
  assert.match(family, /'\/api\/lifespace\/core\/v1\/space-invites\/join'/);
  assert.match(family, /JSON\.stringify\(\{ token, displayName \}\)/);
  assert.doesNotMatch(family, /space-invites\/\$\{pathToken\}/);
});
