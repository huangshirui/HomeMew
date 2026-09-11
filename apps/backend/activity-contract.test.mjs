import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workerSource = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
const wrangler = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));

test('activity state is a dedicated Durable Object with three latest-seen fields', () => {
  assert.match(workerSource, /export class MemberActivity extends DurableObject/);
  assert.match(workerSource, /miniProgramLastSeenAt/);
  assert.match(workerSource, /webLastSeenAt/);
  assert.match(workerSource, /wecomLastSeenAt/);
  assert.match(workerSource, /candidateMs > previousMs/);

  const bindings = wrangler.durable_objects.bindings;
  assert.ok(bindings.some(binding => binding.name === 'MEMBER_ACTIVITIES' && binding.class_name === 'MemberActivity'));
  assert.ok(wrangler.migrations.some(migration => migration.new_sqlite_classes?.includes('MemberActivity')));
});

test('activity API keeps first-party identity and external secret boundaries separate', () => {
  assert.match(workerSource, /POST' && url\.pathname === '\/api\/v1\/activity\/me'/);
  assert.match(workerSource, /POST' && url\.pathname === '\/api\/v1\/activity\/report'/);
  assert.match(workerSource, /GET' && url\.pathname === '\/api\/v1\/activity'/);
  assert.match(workerSource, /LIFESPACE_IDENTITY_URL[\s\S]*\/api\/v1\/me/);
  assert.match(workerSource, /ACTIVITY_API_SECRET/);
  assert.match(workerSource, /MAX_ACTIVITY_QUERY_USERS = 50/);
});
