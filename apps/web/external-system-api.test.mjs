import assert from 'node:assert/strict';
import test from 'node:test';
import { handleIntegrationRequest } from './integration-api.mjs';

const ASSERTION = 'access-assertion';
const REQUEST_ID = 'req_external_system';
const SPACE_ID = 'spc_home';

function request(path, { method = 'GET', body } = {}) {
  const headers = new Headers();
  if (!['GET', 'HEAD'].includes(method)) headers.set('origin', 'https://homemew.example.test');
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function response(status, data) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function environment(backendFetch) {
  return {
    LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_home_application',
    LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL: 'lsa_home_application',
    LIFESPACE_IDENTITY_URL: 'https://auth.example.test',
    LIFESPACE_CORE_URL: 'https://core.example.test',
    HOMEMEW_BACKEND: { fetch: backendFetch },
  };
}

function managerFetcher(calls) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/internal/v1/access/tokens')) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.requestedScopes, ['profile:read', 'grants:manage']);
      return response(200, { accessToken: 'manager-token' });
    }
    if (url.endsWith('/api/v1/me')) {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      return response(200, { id: 'usr_manager' });
    }
    if (url.endsWith(`/api/v1/spaces/${SPACE_ID}/grants?includeRevoked=true`)) {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      return response(200, []);
    }
    assert.fail(`External System container creation must not call other LifeSpace endpoints: ${url}`);
  };
}

test('creating ext_* writes only HomeMew metadata and creates no Service Principal or Agent', async () => {
  const upstreamCalls = [];
  const backendCalls = [];
  const env = environment(async (incoming) => {
    const url = new URL(incoming.url);
    backendCalls.push({ method: incoming.method, pathname: url.pathname, body: await incoming.json() });
    assert.equal(url.hostname, 'homemew-backend.internal');
    assert.equal(url.pathname, '/internal/v1/external-systems');
    assert.equal(incoming.method, 'POST');
    return response(201, {
      id: 'ext_0123456789abcdef0123456789abcdef',
      spaceId: SPACE_ID,
      displayName: '家庭 n8n',
      description: '家庭自动化',
      servicePrincipalId: null,
      agentId: null,
      createdByUserId: 'usr_manager',
      createdAt: '2026-10-09T03:00:00.000Z',
      updatedAt: '2026-10-09T03:00:00.000Z',
    });
  });

  const result = await handleIntegrationRequest(
    request('/api/integrations', {
      method: 'POST',
      body: { spaceId: SPACE_ID, displayName: '家庭 n8n', description: '家庭自动化' },
    }),
    env,
    { fetcher: managerFetcher(upstreamCalls), assertion: ASSERTION, id: REQUEST_ID },
  );

  assert.equal(result.status, 201);
  const payload = await result.json();
  assert.equal(payload.data.id, 'ext_0123456789abcdef0123456789abcdef');
  assert.equal(payload.data.servicePrincipalId, null);
  assert.equal(payload.data.agentId, null);
  assert.equal(backendCalls.length, 1);
  assert.deepEqual(backendCalls[0].body, {
    spaceId: SPACE_ID,
    displayName: '家庭 n8n',
    description: '家庭自动化',
    createdByUserId: 'usr_manager',
  });
  assert.equal(upstreamCalls.some(({ url }) => url.includes('/api/v1/service-principals')), false);
  assert.equal(upstreamCalls.some(({ url }) => url.includes('/internal/v1/agents')), false);
});

test('new container API rejects Service/Agent setup fields during External System creation', async () => {
  let backendCalled = false;
  const env = environment(async () => {
    backendCalled = true;
    return response(500, null);
  });
  const result = await handleIntegrationRequest(
    request('/api/integrations', {
      method: 'POST',
      body: {
        spaceId: SPACE_ID,
        displayName: '家庭 n8n',
        credentialMode: 'api_token',
        permissions: { event: 'write' },
      },
    }),
    env,
    { fetcher: managerFetcher([]), assertion: ASSERTION, id: REQUEST_ID },
  );

  assert.equal(result.status, 400);
  assert.equal((await result.json()).error.code, 'INVALID_REQUEST');
  assert.equal(backendCalled, false);
});
