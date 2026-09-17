import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('all domain callers use bounded HomeMew product routes', () => {
  const routes = read('../miniprogram/services/product-routes.ts');
  assert.match(routes, /\/api\/v1\/miniprogram\/families/);
  for (const [file, resource] of [['events.ts', 'events'], ['tasks.ts', 'tasks'], ['day-records.ts', 'day-records'], ['wishes.ts', 'wishes']]) {
    const text = read(`../miniprogram/services/${file}`);
    assert.match(text, new RegExp(`familyCollection\\(familyId, '${resource}'\\)`));
    assert.doesNotMatch(text, /canonical-query|lifespace|PersonId|\/api\/v1\/spaces|target:/i);
  }
});

test('diagnostic and invitation calls use fixed HomeMew routes', () => {
  const latency = read('../miniprogram/services/core-latency.ts');
  const families = read('../miniprogram/services/families.ts');
  assert.match(latency, /\/api\/v1\/miniprogram\/diagnostics\/lifespace-core/);
  assert.match(families, /\/api\/v1\/miniprogram\/family-invites\/preview/);
  assert.match(families, /\/api\/v1\/miniprogram\/family-invites\/join/);
  assert.match(families, /data: \{ code \}/);
});

test('Event, Task and Day list callers preserve product pagination behavior', () => {
  assert.match(read('../miniprogram/services/events.ts'), /nextCursor/);
  assert.match(read('../miniprogram/services/tasks.ts'), /nextCursor/);
  assert.match(read('../miniprogram/services/day-records.ts'), /seenCursors/);
});
