import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLifeSpaceStatus, LIFESPACE_RELEASE_BASELINE } from './lifespace-release-baseline.mjs';

function payload(service, environment, contractVersion, schemaVersion) {
  return { data: { status: 'ok', service, environment, contractVersion, schemaVersion } };
}

test('release baseline accepts the LifeSpace 0.39 staging Identity and Core floors', () => {
  assert.equal(
    assertLifeSpaceStatus(
      payload('identity', 'staging', LIFESPACE_RELEASE_BASELINE.identity.contractVersion, 8),
      'identity',
      'staging',
    ).schemaVersion,
    8,
  );
  assert.equal(
    assertLifeSpaceStatus(
      payload('core', 'staging', LIFESPACE_RELEASE_BASELINE.core.contractVersion, '45'),
      'core',
      'staging',
    ).schemaVersion,
    '45',
  );
});

test('release baseline accepts the LifeSpace 0.39 target and later schema-only cleanup migrations', () => {
  assert.equal(
    assertLifeSpaceStatus(payload('core', 'production', '0.39.0', 45), 'core', 'production').schemaVersion,
    45,
  );
  assert.equal(
    assertLifeSpaceStatus(payload('core', 'production', '0.39.0', 46), 'core', 'production').schemaVersion,
    46,
  );
});

test('release baseline rejects contract, schema and environment drift', () => {
  assert.throws(
    () => assertLifeSpaceStatus(payload('core', 'production', '0.39.0', 44), 'core', 'production'),
    /schema is behind the HomeMew release baseline/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(payload('core', 'production', '0.37.0', 44), 'core', 'production'),
    /contract mismatch/,
  );
  assert.throws(
    () => assertLifeSpaceStatus(
      payload('identity', 'staging', LIFESPACE_RELEASE_BASELINE.identity.contractVersion, 8),
      'identity',
      'production',
    ),
    /environment production/,
  );
});
