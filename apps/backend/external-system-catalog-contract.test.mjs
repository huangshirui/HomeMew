import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalogSource = readFileSync(new URL('./external-system-catalog.mjs', import.meta.url), 'utf8');
const frontDoorSource = readFileSync(new URL('./front-door.mjs', import.meta.url), 'utf8');
const wrangler = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));

test('external systems are HomeMew application metadata, not LifeSpace Service Principals', () => {
  assert.match(catalogSource, /export class ExternalSystemCatalog extends DurableObject/u);
  assert.match(catalogSource, /ext_\$\{crypto\.randomUUID\(\)\.replaceAll\('-', ''\)\}/u);
  assert.match(catalogSource, /servicePrincipalId: null/u);
  assert.match(catalogSource, /agentId: null/u);
  assert.doesNotMatch(catalogSource, /credential|token|secret|grant/i);

  const rootBinding = wrangler.durable_objects.bindings.find((entry) => entry.name === 'EXTERNAL_SYSTEM_CATALOG');
  assert.equal(rootBinding?.class_name, 'ExternalSystemCatalog');
  assert.ok(wrangler.migrations.some((migration) => migration.new_sqlite_classes?.includes('ExternalSystemCatalog')));
  for (const environment of Object.values(wrangler.env)) {
    const binding = environment.durable_objects?.bindings?.find((entry) => entry.name === 'EXTERNAL_SYSTEM_CATALOG');
    assert.equal(binding?.class_name, 'ExternalSystemCatalog');
  }
});

test('external system catalog is reachable only over the HomeMew internal service binding', () => {
  assert.match(catalogSource, /hostname !== 'homemew-backend\.internal'/u);
  assert.match(catalogSource, /\/internal\/v1\/external-systems/u);
  assert.match(frontDoorSource, /handleExternalSystemCatalogRequest/u);
  assert.match(wrangler.main, /front-door\.mjs/u);
});

test('Service and Agent references use compare-and-swap binding updates', () => {
  assert.match(catalogSource, /expectedServicePrincipalId/u);
  assert.match(catalogSource, /SERVICE_BINDING_CHANGED/u);
  assert.match(catalogSource, /expectedAgentId/u);
  assert.match(catalogSource, /AGENT_BINDING_CHANGED/u);
});
