import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workerSource = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
const wrangler = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));

test('family join coordination is a dedicated per-family Durable Object', () => {
  assert.match(workerSource, /export class FamilyJoinCoordinator extends DurableObject/);
  assert.match(workerSource, /this\.joinTail = Promise\.resolve\(\)/);
  assert.match(workerSource, /await previous/);
  assert.match(workerSource, /return await this\.commitSerial\(input\)/);
  assert.match(workerSource, /family-join:/);

  const rootBinding = wrangler.durable_objects.bindings.find((entry) => entry.name === 'FAMILY_JOIN_COORDINATORS');
  assert.equal(rootBinding?.class_name, 'FamilyJoinCoordinator');
  assert.ok(wrangler.migrations.some((migration) => migration.new_sqlite_classes?.includes('FamilyJoinCoordinator')));
  for (const environment of Object.values(wrangler.env)) {
    const binding = environment.durable_objects?.bindings?.find((entry) => entry.name === 'FAMILY_JOIN_COORDINATORS');
    assert.equal(binding?.class_name, 'FamilyJoinCoordinator');
  }
});

test('family join coordinator rechecks current LifeSpace state and enforces the HomeMew eight-member rule', () => {
  assert.match(workerSource, /FAMILY_MEMBER_LIMIT = 8/);
  assert.match(workerSource, /\/api\/v1\/space-invites\/preview/);
  assert.match(workerSource, /\/api\/v1\/me/);
  assert.match(workerSource, /\/members/);
  assert.match(workerSource, /alreadyMember/);
  assert.match(workerSource, /list\.length >= FAMILY_MEMBER_LIMIT/);
  assert.match(workerSource, /FAMILY_MEMBER_LIMIT_REACHED/);
  assert.match(workerSource, /\/api\/v1\/space-invites\/join/);
  assert.match(workerSource, /\/internal\/v1\/family-joins\/commit/);
});
