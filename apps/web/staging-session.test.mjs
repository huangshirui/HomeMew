import assert from 'node:assert/strict';
import test from 'node:test';
import { selectApplicationEnvironment } from './application-environment.mjs';
import { createWebHandler } from './worker.mjs';

const BASE = {
  ENVIRONMENT: 'production',
  WEB_SESSION_SECRET: 'prod-cookie-signing-secret-over-32-bytes',
  LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_prod_test',
  LIFESPACE_CORE_URL: 'https://core.example.test',
  LIFESPACE_IDENTITY_URL: 'https://auth.example.test',
};
const STAGE = {
  ...BASE,
  HOMEMEW_BACKEND_STAGING: { fetch() {} },
  LIFESPACE_CORE_STAGING: { fetch() {} },
  LIFESPACE_IDENTITY_STAGING: { fetch() {} },
  STAGING_LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_stage_test',
  STAGING_WEB_SESSION_SECRET: 'stage-cookie-signing-secret-over-32-bytes',
  STAGING_LIFESPACE_CORE_URL: 'https://core-staging.example.test',
  STAGING_LIFESPACE_IDENTITY_URL: 'https://auth-staging.example.test',
};
function req(path, cookie) {
  return new Request('https://homemew.aisr.online' + path, {
    headers: { 'cf-access-jwt-assertion': 'cloudflare-access-a', ...(cookie ? { cookie } : {}) },
  });
}
function upstream(url) {
  const path = String(url);
  if (path.endsWith('/internal/v1/access/tokens')) {
    return new Response(JSON.stringify({ data: { accessToken: 'test-token', expiresIn: 900 } }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  if (path.endsWith('/api/v1/me')) {
    return new Response(JSON.stringify({ data: { id: 'usr_test', displayName: 'Test Person' } }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error('Unexpected upstream ' + path);
}
const handler = createWebHandler({fetcher: async url => upstream(url), now: () => Date.parse('2026-10-22T06:00:00Z')});

test('separate prod and staging Web Identity cookies from the same deployed handler', async () => {
  const production = selectApplicationEnvironment(req('/api/session'), BASE);
  const prod = await handler.fetch(production.request, production.env);
  assert.equal(prod.status, 200);
  const productionCookie = prod.headers.get('set-cookie');
  assert.match(productionCookie, /^__Host-homemew_session=/);
  const staging = selectApplicationEnvironment(req('/_stage/api/session', productionCookie.split(';')[0]), STAGE);
  assert.equal(staging.error, undefined);
  const stage = await handler.fetch(staging.request, staging.env);
  assert.equal(stage.status, 200);
  const stageCookie = stage.headers.get('set-cookie');
  assert.match(stageCookie, /^__Host-homemew_staging_session=/);
  assert.notEqual(stageCookie.split(';')[0], productionCookie.split(';')[0]);
});
