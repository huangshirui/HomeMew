import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLifeSpaceStatus, LIFESPACE_RELEASE_BASELINE } from './lifespace-release-baseline.mjs';

function payload(service, environment, contractVersion, schemaVersion) {
  return { data: { status: 'ok', service, environment, contractVersion, schemaVersion } };
}

test('release baseline accepts the single-Application Identity 0.11 floor and LifeSpace 0.49 Core baseline', () => {
  assert.equal(
    assertLifeSpaceStatus(
      payload('identity', 'staging', LIFESPACE_RELEASE_BASELINE.identity.contractVersion, 10),
      'identity',
      'staging',
    ).schemaVersion,
    10,
  );
  assert.equal(
    assertLifeSpaceStatus(
      payload('core', 'staging', LIFESPACE_RELEASE_BASELINE.core.contractVersion, '53'),
      'core',
      'staging',
    ).schemaVersion,
    '53',
  );
});

test('release baseline explicitly accepts compatible Core 0.48 and deployed 0.49, with later schema-only cleanup migrations', () => {
  assert.equal(
    assertLifeSpaceStatus(payload('core', 'production', '0.48.0', 53), 'core', 'production').schemaVersion,
    53,
  );
  assert.equal(
    assertLifeSpaceStatus(payload('core', 'production', '0.48.0', 54), 'core', 'production').schemaVersion,
    54,
  );
  assert.equal(
    assertLifeSpaceStatus(payload('core', 'production', '0.49.0', 53), 'core', 'production').schemaVersion,
    53,
  );
  assert.equal(
    assertLifeSpaceStatus(payload('core', 'staging', '0.49.0', '54'), 'core', 'staging').schemaVersion,
    '54',
  );
});

test('release baseline rejects contract, schema and environment drift', () => {
  assert.throws(
    () => assertLifeSpaceStatus(payload('identity', 'production', '0.10.0', 9), 'identity', 'production'),
    /contract mismatch/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(payload('identity', 'production', '0.11.0', 9), 'identity', 'production'),
    /schema is behind the HomeMew release baseline/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(payload('core', 'production', '0.48.0', 52), 'core', 'production'),
    /schema is behind the HomeMew release baseline/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(payload('core', 'production', '0.47.0', 53), 'core', 'production'),
    /contract mismatch/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(payload('core', 'production', '0.50.0', 53), 'core', 'production'),
    /contract mismatch/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(payload('core', 'production', '0.49.0', 52), 'core', 'production'),
    /schema is behind the HomeMew release baseline/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(
      payload('identity', 'staging', LIFESPACE_RELEASE_BASELINE.identity.contractVersion, 10),
      'identity',
      'production',
    ),
    /environment production/,
  );
});
