import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLifeSpaceStatus, LIFESPACE_RELEASE_BASELINE } from './lifespace-release-baseline.mjs';

function payload(service, environment, contractVersion, schemaVersion) {
  return { data: { status: 'ok', service, environment, contractVersion, schemaVersion } };
}

test('release pins unified Identity 0.14 and reviewed Core 0.53', () => {
  assert.equal(LIFESPACE_RELEASE_BASELINE.core.contractVersion, '0.53.0');
  assert.equal(LIFESPACE_RELEASE_BASELINE.identity.contractVersion, '0.14.0');
  assert.equal(assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 72), 'core', 'production').schemaVersion, 72);

  assert.equal(assertLifeSpaceStatus(payload('core', 'staging', '0.53.0', '72'), 'core', 'staging').schemaVersion, '72');
});

test('allows reviewed older Core contract revisions with their schema floors', () => {
  for (const contractVersion of ['0.48.0', '0.49.0']) {
    assert.equal(assertLifeSpaceStatus(payload('core', 'staging', contractVersion, 53), 'core', 'staging').schemaVersion, 53);
    assert.equal(assertLifeSpaceStatus(payload('core', 'staging', contractVersion, 54), 'core', 'staging').schemaVersion, 54);
  }
});

test('rejects partial upgrades, rejected Identity versions and unreviewed contracts', () => {
  for (const [service, version, schema] of [
    ['core', '0.53.0', 71],
    ['identity', '0.14.0', 11],
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
    ['identity', '0.12.0', 11],
  ]) {
    assert.throws(() => assertLifeSpaceStatus(payload(service, 'production', version, schema), service, 'production'), /contract mismatch/);
  }
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'staging', '0.53.0', 72), 'core', 'production'), /environment production/);
  assert.throws(() => assertLifeSpaceStatus(payload('identity', 'staging', '0.14.0', 13), 'identity', 'production'), /environment production/);
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 'not a number'), 'core', 'production'), /must be an integer/);
  assert.throws(() => assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 72).data, 'identity', 'production'), /Expected identity status/);
});

test('mailbox release requires Identity 0.14 schema 13 in each matching environment', () => {
  for (const environment of ['staging', 'production']) {
    assert.equal(assertLifeSpaceStatus(payload('identity', environment, '0.14.0', 13), 'identity', environment).schemaVersion, 13);
    assert.throws(() => assertLifeSpaceStatus(payload('identity', environment, '0.14.0', 12), 'identity', environment), /schema is behind/);
  }
});
