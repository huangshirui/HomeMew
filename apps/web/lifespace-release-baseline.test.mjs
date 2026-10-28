import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLifeSpaceStatus, LIFESPACE_RELEASE_BASELINE } from './lifespace-release-baseline.mjs';

function payload(service, environment, contractVersion, schemaVersion) {
  return { data: { status: 'ok', service, environment, contractVersion, schemaVersion } };
}

test('release pins reviewed Identity 0.17 and Core 0.53', () => {
  assert.equal(LIFESPACE_RELEASE_BASELINE.core.contractVersion, '0.53.0');
  assert.equal(LIFESPACE_RELEASE_BASELINE.identity.contractVersion, '0.17.0');
  assert.equal(assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 74), 'core', 'production').schemaVersion, 74);

  assert.equal(assertLifeSpaceStatus(payload('core', 'staging', '0.53.0', '74'), 'core', 'staging').schemaVersion, '74');
});

test('allows reviewed older Core contract revisions with their schema floors', () => {
  for (const contractVersion of ['0.48.0', '0.49.0']) {
    assert.equal(assertLifeSpaceStatus(payload('core', 'staging', contractVersion, 53), 'core', 'staging').schemaVersion, 53);
    assert.equal(assertLifeSpaceStatus(payload('core', 'staging', contractVersion, 54), 'core', 'staging').schemaVersion, 54);
  }
});

test('rejects partial upgrades, rejected Identity versions and unreviewed contracts', () => {
  for (const [service, version, schema] of [
    ['core', '0.53.0', 73],
    ['identity', '0.15.0', 13],
    ['identity', '0.16.0', 13],
    ['identity', '0.17.0', 13],
    ['core', '0.48.0', 52],
  ]) {
    assert.throws(() => assertLifeSpaceStatus(payload(service, 'production', version, schema), service, 'production'), /schema is behind/);
  }
  for (const [service, version, schema] of [
    ['core', '0.47.0', 72],
    ['core', '0.50.0', 72],
    ['core', '0.54.0', 72],
    ['identity', '0.10.0', 11],
    ['identity', '0.13.0', 12],
    ['identity', '0.14.0', 13],
    ['identity', '0.18.0', 14],
    ['identity', '0.12.0', 11],
  ]) {
    assert.throws(() => assertLifeSpaceStatus(payload(service, 'production', version, schema), service, 'production'), /contract mismatch/);
  }
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'staging', '0.53.0', 72), 'core', 'production'), /environment production/);
  assert.throws(() => assertLifeSpaceStatus(payload('identity', 'staging', '0.15.0', 14), 'identity', 'production'), /environment production/);
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 'not a number'), 'core', 'production'), /must be an integer/);
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 72).data, 'identity', 'production'), /Expected identity status/);
});

test('reviewed Identity 0.15-0.17 contracts require schema 14 in each matching environment', () => {
  for (const environment of ['staging', 'production']) {
    for (const contractVersion of ['0.15.0', '0.16.0', '0.17.0']) {
      assert.equal(assertLifeSpaceStatus(payload('identity', environment, contractVersion, 14), 'identity', environment).schemaVersion, 14);
      assert.throws(() => assertLifeSpaceStatus(payload('identity', environment, contractVersion, 13), 'identity', environment), /schema is behind/);
    }
  }
});
