import assert from 'node:assert/strict';
import test from 'node:test';
import { handleIntegrationRequest } from './integration-api.mjs';

const ENV = {
  LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_web_application',
  LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL: 'lsa_integrations_application',
  LIFESPACE_IDENTITY_URL: 'https://auth.example.test',
  LIFESPACE_CORE_URL: 'https://core.example.test',
};
const ASSERTION = 'access-assertion';
const REQUEST_ID = 'req_integrations';

function request(path, { method = 'GET', body, origin = 'https://homemew.example.test' } = {}) {
  const headers = new Headers();
  if (!['GET', 'HEAD'].includes(method) && origin) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function response(status, data) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  });
}

async function payload(value) {
  return value.json();
}

function createState({ principals = [], grants = [], tokens = [], oauth = [] } = {}) {
  return { principals, grants, tokens, oauth, counter: 0 };
}

function makeFetcher(state) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url === 'https://auth.example.test/internal/v1/access/tokens') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_APPLICATION_CREDENTIAL}`);
      assert.deepEqual(JSON.parse(init.body).requestedScopes, ['profile:read', 'grants:manage']);
      return response(200, { data: { accessToken: 'manager-token', expiresIn: 300 } });
    }
    if (url === 'https://auth.example.test/api/v1/me') {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      return response(200, { data: { id: 'usr_manager', displayName: 'Manager' } });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants?includeRevoked=true') {
      return response(200, { data: state.grants });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants' && method === 'POST') {
      const body = JSON.parse(init.body);
      const grant = {
        id: `grt_${++state.counter}`,
        sourceSpaceId: 'spc_family',
        ...body,
        revokedAt: null,
      };
      state.grants.push(grant);
      return response(201, { data: grant });
    }
    const grantMatch = url.match(/^https:\/\/core\.example\.test\/api\/v1\/spaces\/spc_family\/grants\/(grt_[A-Za-z0-9_-]+)$/u);
    if (grantMatch && method === 'DELETE') {
      const grant = state.grants.find((item) => item.id === grantMatch[1] && !item.revokedAt);
      if (!grant) return response(404, { error: { code: 'NOT_FOUND', message: 'grant missing' } });
      grant.revokedAt = '2026-08-24T01:00:00Z';
      return response(204);
    }
    if (grantMatch && method === 'PATCH') {
      const grant = state.grants.find((item) => item.id === grantMatch[1] && !item.revokedAt);
      if (!grant) return response(404, { error: { code: 'NOT_FOUND', message: 'grant missing' } });
      Object.assign(grant, JSON.parse(init.body));
      return response(200, { data: grant });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals' && method === 'GET') {
      return response(200, { data: state.principals });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals' && method === 'POST') {
      const body = JSON.parse(init.body);
      const principal = {
        id: `svc_${++state.counter}`,
        displayName: body.displayName,
        description: body.description,
        status: 'active',
        maxScopes: body.maxScopes,
        createdByUserId: body.createdByUserId,
        createdAt: `2026-08-24T00:00:0${state.counter}Z`,
        updatedAt: `2026-08-24T00:00:0${state.counter}Z`,
      };
      state.principals.push(principal);
      return response(201, { data: principal });
    }
    const principalMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)$/u);
    if (principalMatch && method === 'PATCH') {
      const principal = state.principals.find((item) => item.id === principalMatch[1]);
      if (!principal) return response(404, { error: { code: 'SERVICE_PRINCIPAL_NOT_FOUND', message: 'missing' } });
      Object.assign(principal, JSON.parse(init.body), { updatedAt: '2026-08-24T02:00:00Z' });
      return response(200, { data: principal });
    }
    const tokenListMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/tokens$/u);
    if (tokenListMatch && method === 'GET') {
      return response(200, { data: state.tokens.filter((item) => item.principalId === tokenListMatch[1]) });
    }
    if (tokenListMatch && method === 'POST') {
      const body = JSON.parse(init.body);
      const token = {
        id: `sat_${++state.counter}`,
        principalId: tokenListMatch[1],
        displayPrefix: `lsp_pat_${state.counter}`,
        lastFour: `${1000 + state.counter}`,
        label: body.label,
        scopes: body.scopes,
        expiresAt: null,
        createdAt: `2026-08-24T00:10:${String(state.counter).padStart(2, '0')}Z`,
        lastUsedAt: null,
        revokedAt: null,
      };
      state.tokens.push(token);
      return response(201, { data: { ...token, token: `lsp_pat_plain_${state.counter}` } });
    }
    const tokenDeleteMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/tokens\/(sat_[A-Za-z0-9_-]+)$/u);
    if (tokenDeleteMatch && method === 'DELETE') {
      const token = state.tokens.find((item) => item.id === tokenDeleteMatch[2] && !item.revokedAt);
      if (!token) return response(404, { error: { code: 'SERVICE_TOKEN_NOT_FOUND', message: 'missing' } });
      token.revokedAt = '2026-08-24T03:00:00Z';
      return response(204);
    }
    const oauthListMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/oauth-credentials$/u);
    if (oauthListMatch && method === 'GET') {
      return response(200, { data: state.oauth.filter((item) => item.principalId === oauthListMatch[1]) });
    }
    if (oauthListMatch && method === 'POST') {
      const body = JSON.parse(init.body);
      const credential = {
        id: `soc_${++state.counter}`,
        principalId: oauthListMatch[1],
        secretSuffix: `secret${state.counter}`,
        label: body.label,
        status: 'active',
        createdAt: `2026-08-24T00:20:${String(state.counter).padStart(2, '0')}Z`,
        lastUsedAt: null,
        revokedAt: null,
      };
      state.oauth.push(credential);
      return response(201, { data: { ...credential, clientId: oauthListMatch[1], clientSecret: `lsp_client_plain_${state.counter}` } });
    }
    const oauthDeleteMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/oauth-credentials\/(soc_[A-Za-z0-9_-]+)$/u);
    if (oauthDeleteMatch && method === 'DELETE') {
      const credential = state.oauth.find((item) => item.id === oauthDeleteMatch[2] && item.status === 'active');
      if (!credential) return response(404, { error: { code: 'OAUTH_CREDENTIAL_NOT_FOUND', message: 'missing' } });
      credential.status = 'revoked';
      credential.revokedAt = '2026-08-24T03:00:00Z';
      return response(204);
    }
    assert.fail(`unexpected upstream ${method} ${url}`);
  };
}

function boundPrincipal(id = 'svc_family') {
  return {
    id,
    displayName: 'Family automation',
    description: 'homemew:v1:space=spc_family\nAutomation',
    status: 'active',
    maxScopes: ['resources:read', 'resources:write'],
    createdByUserId: 'usr_manager',
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
  };
}

function grant(principalId, id = 'grt_event') {
  return {
    id, sourceSpaceId: 'spc_family', granteeType: 'service', granteeId: principalId,
    resourceType: 'model', resourceId: 'event', permission: 'write', expiresAt: null, revokedAt: null,
  };
}

function apiToken(principalId, id, createdAt) {
  return {
    id, principalId, displayPrefix: 'lsp_pat_demo', lastFour: id.slice(-4), label: 'API Token',
    scopes: ['resources:read', 'resources:write'], expiresAt: null, createdAt, lastUsedAt: null, revokedAt: null,
  };
}

test('integration list exposes credentials only for the explicitly bound family principal', async () => {
  const state = createState({
    principals: [
      boundPrincipal('svc_family'),
      { ...boundPrincipal('svc_other'), description: 'homemew:v1:space=spc_other\nOther' },
      { ...boundPrincipal('svc_legacy'), description: 'Migrated before binding' },
    ],
    grants: [grant('svc_family', 'grt_1'), grant('svc_other', 'grt_2'), grant('svc_legacy', 'grt_3')],
    tokens: [apiToken('svc_family', 'sat_family', '2026-08-24T00:10:00Z'), apiToken('svc_other', 'sat_other', '2026-08-24T00:10:00Z')],
  });
  const result = await handleIntegrationRequest(request('/api/integrations?spaceId=spc_family'), ENV, {
    fetcher: makeFetcher(state), assertion: ASSERTION, id: REQUEST_ID,
  });
  assert.equal(result.status, 200);
  const data = (await payload(result)).data;
  assert.equal(data.length, 2);
  assert.equal(data[0].id, 'svc_family');
  assert.equal(data[0].credentials.length, 1);
  assert.equal(data[0].credentialMode, 'api_token');
  assert.equal(data[1].id, 'svc_legacy');
  assert.deepEqual(data[1].credentials, []);
  assert.equal(data.some((item) => item.id === 'svc_other'), false);
});

test('creating an API-token integration returns one plaintext token and one active credential', async () => {
  const state = createState();
  const result = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST',
    body: {
      spaceId: 'spc_family', displayName: 'Home n8n', description: 'Automation', credentialMode: 'api_token',
      permissions: { event: 'write', task: 'read', day_record: null },
    },
  }), ENV, { fetcher: makeFetcher(state), assertion: ASSERTION, id: REQUEST_ID });
  assert.equal(result.status, 201);
  const data = (await payload(result)).data;
  assert.equal(data.credential.type, 'api_token');
  assert.match(data.credential.token, /^lsp_pat_plain_/u);
  assert.equal(data.integration.credentialMode, 'api_token');
  assert.equal(data.integration.rotationPending, false);
  assert.equal(data.integration.credentials.filter((item) => item.active).length, 1);
  assert.equal(state.oauth.length, 0);
});

test('creating an OAuth integration returns client credentials and keeps API tokens absent', async () => {
  const state = createState();
  const result = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST',
    body: {
      spaceId: 'spc_family', displayName: 'Home agent', credentialMode: 'oauth_client_credentials',
      permissions: { event: 'read', task: null, day_record: null },
    },
  }), ENV, { fetcher: makeFetcher(state), assertion: ASSERTION, id: REQUEST_ID });
  assert.equal(result.status, 201);
  const data = (await payload(result)).data;
  assert.equal(data.credential.type, 'oauth_client_credentials');
  assert.match(data.credential.clientId, /^svc_/u);
  assert.match(data.credential.clientSecret, /^lsp_client_plain_/u);
  assert.equal(data.integration.credentialMode, 'oauth_client_credentials');
  assert.equal(state.tokens.length, 0);
});

test('token rotation temporarily allows two credentials then completes by keeping only the new token', async () => {
  const principal = boundPrincipal();
  const oldToken = apiToken(principal.id, 'sat_old', '2026-08-24T00:01:00Z');
  const state = createState({ principals: [principal], grants: [grant(principal.id)], tokens: [oldToken] });
  const fetcher = makeFetcher(state);
  const started = await handleIntegrationRequest(request(`/api/integrations/${principal.id}/credential-rotation`, {
    method: 'POST', body: { spaceId: 'spc_family', credentialMode: 'api_token' },
  }), ENV, { fetcher, assertion: ASSERTION, id: REQUEST_ID });
  assert.equal(started.status, 201);
  const startedData = (await payload(started)).data;
  assert.equal(startedData.integration.rotationPending, true);
  assert.equal(startedData.integration.credentials.filter((item) => item.active).length, 2);
  const keepId = startedData.credential.credentialId;

  const completed = await handleIntegrationRequest(request(`/api/integrations/${principal.id}/credential-rotation/complete`, {
    method: 'POST', body: { spaceId: 'spc_family', keepCredentialId: keepId },
  }), ENV, { fetcher, assertion: ASSERTION, id: REQUEST_ID });
  assert.equal(completed.status, 200);
  const integration = (await payload(completed)).data;
  assert.equal(integration.rotationPending, false);
  assert.equal(integration.credentials.filter((item) => item.active).length, 1);
  assert.equal(integration.credentials.find((item) => item.id === 'sat_old').active, false);
  assert.equal(integration.credentials.find((item) => item.id === keepId).active, true);
});

test('switching from API token to OAuth can be cancelled by revoking only the newest candidate', async () => {
  const principal = boundPrincipal();
  const state = createState({
    principals: [principal], grants: [grant(principal.id)],
    tokens: [apiToken(principal.id, 'sat_old', '2026-08-24T00:01:00Z')],
  });
  const fetcher = makeFetcher(state);
  const started = await handleIntegrationRequest(request(`/api/integrations/${principal.id}/credential-rotation`, {
    method: 'POST', body: { spaceId: 'spc_family', credentialMode: 'oauth_client_credentials' },
  }), ENV, { fetcher, assertion: ASSERTION, id: REQUEST_ID });
  const startedData = (await payload(started)).data;
  assert.equal(startedData.integration.rotationPending, true);
  assert.equal(startedData.integration.credentialMode, 'oauth_client_credentials');
  const candidateId = startedData.credential.credentialId;

  const cancelled = await handleIntegrationRequest(request(`/api/integrations/${principal.id}/credential-rotation/cancel`, {
    method: 'POST', body: { spaceId: 'spc_family', candidateCredentialId: candidateId },
  }), ENV, { fetcher, assertion: ASSERTION, id: REQUEST_ID });
  assert.equal(cancelled.status, 200);
  const integration = (await payload(cancelled)).data;
  assert.equal(integration.rotationPending, false);
  assert.equal(integration.credentialMode, 'api_token');
  assert.equal(integration.credentials.filter((item) => item.active).length, 1);
  assert.equal(integration.credentials.find((item) => item.id === candidateId).active, false);
});

test('state-changing integration routes reject cross-origin requests before touching LifeSpace', async () => {
  let called = false;
  const result = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST', origin: 'https://evil.example.test',
    body: { spaceId: 'spc_family', displayName: 'Bad', permissions: { event: 'read' } },
  }), ENV, {
    fetcher: async () => { called = true; return response(500, {}); }, assertion: ASSERTION, id: REQUEST_ID,
  });
  assert.equal(result.status, 403);
  assert.equal((await payload(result)).error.code, 'INVALID_ORIGIN');
  assert.equal(called, false);
});

test('integration endpoints fail closed when the dedicated application credential is missing', async () => {
  const env = { ...ENV };
  delete env.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL;
  let called = false;
  const result = await handleIntegrationRequest(request('/api/integrations?spaceId=spc_family'), env, {
    fetcher: async () => { called = true; return response(500, {}); }, assertion: ASSERTION, id: REQUEST_ID,
  });
  assert.equal(result.status, 503);
  assert.equal((await payload(result)).error.code, 'INTEGRATIONS_NOT_CONFIGURED');
  assert.equal(called, false);
});

test('Service Access accepts newly published model keys and preserves omitted model Grants on edit', async () => {
  const state = createState();
  const created = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST',
    body: {
      spaceId: 'spc_family', displayName: 'Model-aware service', credentialMode: 'api_token',
      permissions: { habit: 'write', activity: 'read' },
    },
  }), ENV, { fetcher: makeFetcher(state), assertion: ASSERTION, id: REQUEST_ID });
  assert.equal(created.status, 201);
  const service = (await payload(created)).data.integration;
  assert.equal(service.permissions.habit, 'write');
  assert.equal(service.permissions.activity, 'read');
  assert.ok(state.grants.some((item) => item.resourceId === 'habit' && item.permission === 'write' && !item.revokedAt));

  const changed = await handleIntegrationRequest(request(`/api/integrations/${service.id}`, {
    method: 'PATCH', body: { spaceId: 'spc_family', permissions: { habit: 'read' } },
  }), ENV, { fetcher: makeFetcher(state), assertion: ASSERTION, id: REQUEST_ID });
  assert.equal(changed.status, 200);
  const updated = (await payload(changed)).data;
  assert.equal(updated.permissions.habit, 'read');
  assert.equal(updated.permissions.activity, 'read', 'an omitted model Grant must not be revoked');
  assert.deepEqual(state.principals.find((item) => item.id === service.id).maxScopes, ['resources:read']);
});
