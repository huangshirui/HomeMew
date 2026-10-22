import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('./wrangler.production.jsonc', import.meta.url), 'utf8'));
const expected = {
  HOMEMEW_BACKEND: 'homemew-backend-production',
  LIFESPACE_IDENTITY: 'lifespace-identity',
  LIFESPACE_CORE: 'lifespace-core',
  HOMEMEW_BACKEND_STAGING: 'homemew-backend-staging',
  LIFESPACE_IDENTITY_STAGING: 'lifespace-identity-staging',
  LIFESPACE_CORE_STAGING: 'lifespace-core-staging',
};
const checkBindings = entries => Object.fromEntries((entries || []).map(({binding,service}) => [binding,service]));

test('one Worker project and two code versions have identical fixed LifeSpace targets', () => {
  assert.equal(config.name, 'homemew-web-production');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, true);
  assert.deepEqual(checkBindings(config.services), expected);
  assert.deepEqual(checkBindings(config.previews?.services), expected);
});

test('both code versions default to production and retain explicit staging URLs', () => {
  for (const vars of [config.vars, config.previews?.vars]) {
    assert.equal(vars.ENVIRONMENT, 'production');
    assert.equal(vars.LIFESPACE_IDENTITY_URL, 'https://auth.aisr.online');
    assert.equal(vars.LIFESPACE_CORE_URL, 'https://core.aisr.online');
    assert.equal(vars.STAGING_LIFESPACE_IDENTITY_URL, 'https://auth-staging.aisr.online');
    assert.equal(vars.STAGING_LIFESPACE_CORE_URL, 'https://core-staging.aisr.online');
  }
  assert.equal(config.assets.run_worker_first.includes('/_stage/api/*'), true);
  assert.equal(config.assets.run_worker_first.includes('/api/*'), true);
});
