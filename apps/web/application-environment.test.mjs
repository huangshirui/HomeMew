import assert from 'node:assert/strict';
import test from 'node:test';
import { selectApplicationEnvironment } from './application-environment.mjs';

const request = path => new Request('https://homemew.aisr.online' + path, { headers: {
  'cf-access-jwt-assertion': 'access-test',
} });
const service = { fetch: () => Promise.resolve(new Response('{}')) };
const prod = {
  ENVIRONMENT: 'production',
  HOMEMEW_BACKEND: service,
  LIFESPACE_CORE: service,
  LIFESPACE_IDENTITY: service,
  LIFESPACE_CORE_URL: 'https://core.aisr.online',
  LIFESPACE_IDENTITY_URL: 'https://auth.aisr.online',
  LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_prod',
  WEB_SESSION_SECRET: 'production-secret-more-than-32-characters',
};
const ready = {
  ...prod,
  HOMEMEW_BACKEND_STAGING: service,
  LIFESPACE_CORE_STAGING: service,
  LIFESPACE_IDENTITY_STAGING: service,
  STAGING_LIFESPACE_IDENTITY_URL: 'https://auth-staging.aisr.online',
  STAGING_LIFESPACE_CORE_URL: 'https://core-staging.aisr.online',
  STAGING_LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_stage',
  STAGING_WEB_SESSION_SECRET: 'staging-secret-more-than-32-characters',
};

test('ordinary requests remain production', () => {
  const original = request('/api/session');
  const r = selectApplicationEnvironment(original, ready);
  assert.equal(r.error, undefined);
  assert.equal(r.staging, false);
  assert.equal(r.request, original);
  assert.equal(r.env, ready);
});
test('stage routes preserve same origin and use fixed staging bindings', () => {
  const original = request('/_stage/api/lifespace/core/v1/spaces?limit=10');
  const r = selectApplicationEnvironment(original, ready);
  assert.equal(r.error, undefined);
  assert.equal(r.staging, true);
  assert.equal(new URL(r.request.url).pathname, '/api/lifespace/core/v1/spaces');
  assert.equal(new URL(r.request.url).search, '?limit=10');
  assert.equal(r.request.headers.get('cf-access-jwt-assertion'), 'access-test');
  assert.equal(r.env.HOMEMEW_BACKEND, ready.HOMEMEW_BACKEND_STAGING);
  assert.equal(r.env.LIFESPACE_CORE, ready.LIFESPACE_CORE_STAGING);
  assert.equal(r.env.LIFESPACE_APPLICATION_CREDENTIAL, 'lsa_stage');
  assert.equal(r.env.LIFESPACE_IDENTITY_URL, 'https://auth-staging.aisr.online');
  assert.equal(r.env.WEB_SESSION_COOKIE, '__Host-homemew_staging_session');
  assert.notEqual(r.env.WEB_SESSION_SECRET, prod.WEB_SESSION_SECRET);
});
test('stage fails closed without all bindings and secrets, never falls back to prod', async () => {
  for (const missing of ['HOMEMEW_BACKEND_STAGING','LIFESPACE_CORE_STAGING','LIFESPACE_IDENTITY_STAGING',
    'STAGING_LIFESPACE_APPLICATION_CREDENTIAL','STAGING_WEB_SESSION_SECRET','STAGING_LIFESPACE_CORE_URL']) {
    const env = { ...ready };
    delete env[missing];
    const r = selectApplicationEnvironment(request('/_stage/api/session'), env);
    assert.equal(r.error?.status, 503, missing);
    assert.equal((await r.error.json()).error.code, 'STAGING_NOT_CONFIGURED');
  }
});
test('stage does not rewrite public page path or arbitrary query environment selector', () => {
  for (const path of ['/?env=staging', '/calendar?env=staging', '/api/session?env=staging']) {
    const original = request(path);
    const r = selectApplicationEnvironment(original, prod);
    assert.equal(r.error, undefined);
    assert.equal(r.request, original);
    assert.equal(r.env, prod);
  }
});
