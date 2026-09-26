import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workerSource = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
const wrangler = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));

test('family catalog is HomeMew-owned application metadata in a dedicated Durable Object', () => {
  assert.match(workerSource, /export class FamilyCatalog extends DurableObject/);
  assert.match(workerSource, /family:\$\{spaceId\}/);
  assert.match(workerSource, /registeredAt/);
  assert.match(workerSource, /operator-import/);
  assert.doesNotMatch(workerSource, /legacyFamilySpaceIds|legacy-kind-backfill/);

  const rootBinding = wrangler.durable_objects.bindings.find((entry) => entry.name === 'FAMILY_CATALOG');
  assert.equal(rootBinding?.class_name, 'FamilyCatalog');
  assert.ok(wrangler.migrations.some((migration) => migration.new_sqlite_classes?.includes('FamilyCatalog')));
  for (const environment of Object.values(wrangler.env)) {
    const binding = environment.durable_objects?.bindings?.find((entry) => entry.name === 'FAMILY_CATALOG');
    assert.equal(binding?.class_name, 'FamilyCatalog');
  }
});

test('family catalog mutation/query routes are service-binding-only and bounded', () => {
  assert.match(workerSource, /hostname !== 'homemew-backend\.internal'/);
  assert.match(workerSource, /MAX_FAMILY_CATALOG_BATCH = 200/);
  assert.match(workerSource, /\/internal\/v1\/family-catalog\/register/);
  assert.match(workerSource, /\/internal\/v1\/family-catalog\/reconcile/);
  assert.match(workerSource, /\/internal\/v1\/family-catalog\/import/);
  assert.match(workerSource, /\/internal\/v1\/family-catalog\/status/);
});
