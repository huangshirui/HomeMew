import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLifeSpaceStatus, LIFESPACE_RELEASE_BASELINE } from './lifespace-release-baseline.mjs';

function payload(service, environment, contractVersion, schemaVersion) {
  return { data: { status: 'ok', service, environment, contractVersion, schemaVersion } };
}

test('release pins reviewed Identity 0.19 and Core 0.54', () => {
  assert.equal(LIFESPACE_RELEASE_BASELINE.core.contractVersion, '0.54.0');
  assert.equal(LIFESPACE_RELEASE_BASELINE.identity.contractVersion, '0.19.0');
  assert.equal(assertLifeSpaceStatus(payload('core', 'production', '0.53.0', 74), 'core', 'production').schemaVersion, 74);

  assert.equal(assertLifeSpaceStatus(payload('core', 'staging', '0.53.0', '74'), 'core', 'staging').schemaVersion, '74');
  assert.equal(assertLifeSpaceStatus(payload('core', 'staging', '0.54.0', 76), 'core', 'staging').schemaVersion, 76);
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
    ['core', '0.54.0', 75],
    ['identity', '0.15.0', 13],
    ['identity', '0.16.0', 13],
    ['identity', '0.17.0', 13],
    ['identity', '0.18.0', 14],
    ['identity', '0.19.0', 17],
    ['core', '0.48.0', 52],
  ]) {
    assert.throws(() => assertLifeSpaceStatus(payload(service, 'production', version, schema), service, 'production'), /schema is behind/);
  }
  for (const [service, version, schema] of [
    ['core', '0.47.0', 72],
    ['core', '0.50.0', 72],
    ['core', '0.55.0', 76],
    ['identity', '0.10.0', 11],
    ['identity', '0.13.0', 12],
    ['identity', '0.14.0', 13],
    ['identity', '0.20.0', 18],
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

test('reviewed additive Identity 0.18 contract requires schema 15 in both environments', () => {
  for (const environment of ['staging', 'production']) {
    const current = assertLifeSpaceStatus(payload('identity', environment, '0.18.0', 15), 'identity', environment);
    assert.equal(current.schemaVersion, 15);
    assert.throws(() => assertLifeSpaceStatus(payload('identity', environment, '0.18.0', 14), 'identity', environment), /schema is behind/);
  }
});

test('reviewed Identity 0.19 requires schema 18 in both environments', () => {
  for (const environment of ['staging', 'production']) {
    for (const schema of [18, 19, '18']) {
      const current = assertLifeSpaceStatus(payload('identity', environment, '0.19.0', schema), 'identity', environment);
      assert.equal(current.schemaVersion, schema);
    }
    for (const schema of [14, 15, 16, 17]) {
      assert.throws(() => assertLifeSpaceStatus(payload('identity', environment, '0.19.0', schema), 'identity', environment), /schema is behind/);
    }
    assert.throws(() => assertLifeSpaceStatus(payload('identity', environment, '0.20.0', 18), 'identity', environment), /contract mismatch/);
    assert.throws(() => assertLifeSpaceStatus(payload('identity', environment, '0.19.0', undefined), 'identity', environment), /must be an integer/);
    const other = environment === 'staging' ? 'production' : 'staging';
    assert.throws(() => assertLifeSpaceStatus(payload('identity', other, '0.19.0', 18), 'identity', environment), /environment/);
  }
});
