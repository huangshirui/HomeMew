import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLifeSpaceStatus, LIFESPACE_RELEASE_BASELINE } from './lifespace-release-baseline.mjs';

function payload(service, environment, contractVersion, schemaVersion) {
  return { data: { status: 'ok', service, environment, contractVersion, schemaVersion } };
}

test('release baseline accepts exact production #42 Core 0.53 / schema 72 and Identity 0.12 / schema 11', () => {
  assert.equal(LIFESPACE_RELEASE_BASELINE.core.contractVersion, '0.53.0');
  assert.equal(LIFESPACE_RELEASE_BASELINE.identity.contractVersion, '0.12.0');
  assert.equal(assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 72), 'core', 'production').schemaVersion, 72);
  assert.equal(assertLifeSpaceStatus(payload('identity', 'production', '0.12.0', 11), 'identity', 'production').schemaVersion, 11);
  assert.equal(assertLifeSpaceStatus(payload('core', 'staging', '0.53.0', '72'), 'core', 'staging').schemaVersion, '72');
});

test('explicitly allows the reviewed older Core and Identity contract revisions with their own schema floors', () => {
  for (const contractVersion of ['0.48.0', '0.49.0']) {
    assert.equal(assertLifeSpaceStatus(payload('core', 'staging', contractVersion, 53), 'core', 'staging').schemaVersion, 53);
    assert.equal(assertLifeSpaceStatus(payload('core', 'staging', contractVersion, 54), 'core', 'staging').schemaVersion, 54);
  }
  assert.equal(assertLifeSpaceStatus(payload('identity', 'staging', '0.11.0', 10), 'identity', 'staging').schemaVersion, 10);
});

test('rejects drift or partial 0.53 / 0.12 upgrades instead of accepting any numerically newer version', () => {
  for (const [service, version, schema] of [
    ['core', '0.53.0', 71],
    ['identity', '0.12.0', 10],
    ['core', '0.48.0', 52],
    ['identity', '0.11.0', 9],
  ]) {
    assert.throws(() => assertLifeSpaceStatus(payload(service, 'production', version, schema), service, 'production'), /schema is behind/);
  }
  for (const [service, version, schema] of [
    ['core', '0.47.0', 72],
    ['core', '0.50.0', 72],
    ['core', '0.54.0', 72],
    ['identity', '0.10.0', 11],
    ['identity', '0.13.0', 11],
  ]) {
    assert.throws(() => assertLifeSpaceStatus(payload(service, 'production', version, schema), service, 'production'), /contract mismatch/);
  }
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'staging', '0.53.0', 72), 'core', 'production'), /environment production/);
  assert.throws(() => assertLifeSpaceStatus(payload('identity', 'staging', '0.12.0', 11), 'identity', 'production'), /environment production/);
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 'not a number'), 'core', 'production'), /must be an integer/);
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 72).data, 'identity', 'production'), /Expected identity status/);
});
