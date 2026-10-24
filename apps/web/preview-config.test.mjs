import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('./wrangler.production.jsonc', import.meta.url), 'utf8'));

function bindings(entries) {
  return Object.fromEntries((entries || []).map(({ binding, service }) => [binding, service]));
}

test('one Worker codebase has production-only production bindings', () => {
  assert.equal(config.name, 'homemew-web');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, true);
  assert.deepEqual(bindings(config.services), {
    HOMEMEW_BACKEND: 'homemew-backend-production',
    LIFESPACE_CORE: 'lifespace-core',
    LIFESPACE_IDENTITY: 'lifespace-identity',
  });
  assert.deepEqual(config.vars, {
    ENVIRONMENT: 'production',
    LIFESPACE_IDENTITY_URL: 'https://auth.aisr.online',
    LIFESPACE_CORE_URL: 'https://core.aisr.online',
    LIFESPACE_EVENT_LOCATION_FORMAT: 'string',
  });
});

test('same Worker Preview is bound only to staging services and hosts', () => {
  assert.deepEqual(bindings(config.previews?.services), {
    HOMEMEW_BACKEND: 'homemew-backend-staging',
    LIFESPACE_CORE: 'lifespace-core-staging',
    LIFESPACE_IDENTITY: 'lifespace-identity-staging',
  });
  assert.deepEqual(config.previews.vars, {
    ENVIRONMENT: 'staging',
    LIFESPACE_IDENTITY_URL: 'https://auth-staging.aisr.online',
    LIFESPACE_CORE_URL: 'https://core-staging.aisr.online',
    LIFESPACE_EVENT_LOCATION_FORMAT: 'location',
  });
  assert.deepEqual(config.assets.run_worker_first, ['/api/*', '/_stage/*', '/health']);
  assert.equal(JSON.stringify(config).includes('STAGING_LIFESPACE_APPLICATION_CREDENTIAL'), false);
  assert.equal(JSON.stringify(config).includes('HOMEMEW_BACKEND_STAGING'), false);
});
