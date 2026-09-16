import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLifeSpaceStatus, LIFESPACE_RELEASE_BASELINE } from './lifespace-release-baseline.mjs';

function payload(service, environment, contractVersion, schemaVersion) {
  return { data: { status: 'ok', service, environment, contractVersion, schemaVersion } };
}

test('release baseline accepts the current staging Identity and Core contract floors', () => {
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
      payload('core', 'staging', LIFESPACE_RELEASE_BASELINE.core.contractVersion, '40'),
      'core',
      'staging',
    ).schemaVersion,
    '40',
  );
});

test('release baseline rejects a Core deployment that predates the HomeMew Canonical Query rollout', () => {
  assert.throws(
    () => assertLifeSpaceStatus(
      payload('core', 'production', LIFESPACE_RELEASE_BASELINE.core.contractVersion, 39),
      'core',
      'production',
    ),
    /schema is behind the HomeMew release baseline/,
  );
});

test('release baseline rejects contract and environment drift', () => {
  assert.throws(
    () => assertLifeSpaceStatus(payload('core', 'production', '0.34.0', 40), 'core', 'production'),
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
