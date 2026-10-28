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
const REQUEST_ID = 'req_integration_recovery';

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
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  });
}

function state(overrides = {}) {
  return {
    principals: [],
    grants: [],
    tokens: [],
    counter: 0,
    tokenCreateAttempts: 0,
    loseTokenResponses: 0,
    failTokenCreates: 0,
    ...overrides,
  };
}

function activeToken(token) {
  return !token.revokedAt;
}

function makeFetcher(store) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';

    if (url === 'https://auth.example.test/internal/v1/access/tokens') {
      return response(200, { data: { accessToken: 'manager-token', expiresIn: 300 } });
    }
    if (url === 'https://auth.example.test/api/v1/me') {
      return response(200, { data: { id: 'usr_manager', displayName: 'Manager' } });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/person-directory/grants?includeRevoked=true') {
      return response(200, { data: store.grants.filter((grant) => grant.resourceType === 'person_directory') });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants?includeRevoked=true') {
      return response(200, { data: store.grants });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants' && method === 'POST') {
      const body = JSON.parse(init.body);
      const grant = {
        id: `grt_${++store.counter}`,
        sourceSpaceId: 'spc_family',
        ...body,
        revokedAt: null,
      };
      store.grants.push(grant);
      return response(201, { data: grant });
    }
    const grantMatch = url.match(/^https:\/\/core\.example\.test\/api\/v1\/spaces\/spc_family\/grants\/(grt_[A-Za-z0-9_-]+)$/u);
    if (grantMatch && method === 'DELETE') {
      const grant = store.grants.find((item) => item.id === grantMatch[1] && !item.revokedAt);
      if (!grant) return response(404, { error: { code: 'NOT_FOUND', message: 'grant missing' } });
      grant.revokedAt = '2026-08-27T02:00:00Z';
      return response(204);
    }

    if (url === 'https://auth.example.test/api/v1/service-principals' && method === 'GET') {
      return response(200, { data: store.principals });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals' && method === 'POST') {
      const body = JSON.parse(init.body);
      const principal = {
        id: `svc_${++store.counter}`,
        displayName: body.displayName,
        description: body.description,
        status: 'active',
        maxScopes: body.maxScopes,
        createdByUserId: body.createdByUserId,
        createdAt: '2026-08-27T01:00:00Z',
        updatedAt: '2026-08-27T01:00:00Z',
      };
      store.principals.push(principal);
      return response(201, { data: principal });
    }
    const principalMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)$/u);
    if (principalMatch && method === 'PATCH') {
      const principal = store.principals.find((item) => item.id === principalMatch[1]);
      if (!principal) return response(404, { error: { code: 'SERVICE_PRINCIPAL_NOT_FOUND', message: 'missing' } });
      Object.assign(principal, JSON.parse(init.body), { updatedAt: '2026-08-27T02:00:00Z' });
      return response(200, { data: principal });
    }

    const tokenListMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/tokens$/u);
    if (tokenListMatch && method === 'GET') {
      return response(200, { data: store.tokens.filter((item) => item.principalId === tokenListMatch[1]) });
    }
    if (tokenListMatch && method === 'POST') {
      store.tokenCreateAttempts += 1;
      if (store.failTokenCreates > 0) {
        store.failTokenCreates -= 1;
        throw new TypeError('simulated upstream connection reset');
      }
      const body = JSON.parse(init.body);
      const token = {
        id: `sat_${++store.counter}`,
        principalId: tokenListMatch[1],
        displayPrefix: `lsp_pat_${store.counter}`,
        lastFour: `${1000 + store.counter}`,
        label: body.label,
        scopes: body.scopes,
        expiresAt: null,
        createdAt: '2026-08-27T01:10:00Z',
        lastUsedAt: null,
        revokedAt: null,
      };
      store.tokens.push(token);
      if (store.loseTokenResponses > 0) {
        store.loseTokenResponses -= 1;
        throw new TypeError('simulated lost response after token commit');
      }
      return response(201, { data: { ...token, token: `lsp_pat_plain_${store.counter}` } });
    }
    const tokenDeleteMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/tokens\/(sat_[A-Za-z0-9_-]+)$/u);
    if (tokenDeleteMatch && method === 'DELETE') {
      const token = store.tokens.find((item) => item.id === tokenDeleteMatch[2] && activeToken(item));
      if (!token) return response(404, { error: { code: 'SERVICE_TOKEN_NOT_FOUND', message: 'missing' } });
      token.revokedAt = '2026-08-27T01:20:00Z';
      return response(204);
    }

    const oauthListMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/oauth-credentials$/u);
    if (oauthListMatch && method === 'GET') return response(200, { data: [] });

    assert.fail(`unexpected upstream ${method} ${url}`);
  };
}

function createBody() {
  return {
    spaceId: 'spc_family',
    displayName: 'n8n测试',
    description: '',
    credentialMode: 'api_token',
    permissions: { event: 'write', task: null, day_record: null },
  };
}

test('lost token response is reconciled before one safe retry', async () => {
  const store = state({ loseTokenResponses: 1 });
  const result = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST',
    body: createBody(),
  }), ENV, { fetcher: makeFetcher(store), assertion: ASSERTION, id: REQUEST_ID });

  assert.equal(result.status, 201);
  const payload = await result.json();
  assert.match(payload.data.credential.token, /^lsp_pat_plain_/u);
  assert.equal(store.tokenCreateAttempts, 2);
  assert.equal(store.tokens.length, 2);
  assert.equal(store.tokens.filter(activeToken).length, 1);
  assert.ok(store.tokens.some((token) => token.revokedAt));
  assert.equal(store.principals[0].status, 'active');
  assert.equal(store.grants.filter((grant) => !grant.revokedAt).length, 1);
});

test('persistent token transport failure fully compensates and tombstones the partial integration', async () => {
  const store = state({ failTokenCreates: 2 });
  const result = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST',
    body: createBody(),
  }), ENV, { fetcher: makeFetcher(store), assertion: ASSERTION, id: REQUEST_ID });

  assert.equal(result.status, 502);
  const error = (await result.json()).error;
  assert.equal(error.code, 'INTEGRATION_TOKEN_CREATE_FAILED');
  assert.equal(store.tokenCreateAttempts, 2);
  assert.equal(store.principals[0].status, 'disabled');
  assert.match(store.principals[0].description, /^homemew:v1:discarded=spc_family/u);
  assert.equal(store.grants.filter((grant) => !grant.revokedAt).length, 0);
  assert.equal(store.tokens.filter(activeToken).length, 0);

  const listed = await handleIntegrationRequest(request('/api/integrations?spaceId=spc_family'), ENV, {
    fetcher: makeFetcher(store), assertion: ASSERTION, id: REQUEST_ID,
  });
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).data, []);
});

test('listing repairs the legacy disabled partial record left by the old creation flow', async () => {
  const principal = {
    id: 'svc_partial',
    displayName: 'n8n测试',
    description: 'homemew:v1:space=spc_family\n',
    status: 'disabled',
    maxScopes: ['resources:read', 'resources:write'],
    createdByUserId: 'usr_manager',
    createdAt: '2026-08-27T01:00:00Z',
    updatedAt: '2026-08-27T01:01:00Z',
  };
  const grant = {
    id: 'grt_partial',
    sourceSpaceId: 'spc_family',
    granteeType: 'service',
    granteeId: principal.id,
    resourceType: 'model',
    resourceId: 'event',
    permission: 'write',
    expiresAt: null,
    revokedAt: null,
  };
  const store = state({ principals: [principal], grants: [grant] });

  const listed = await handleIntegrationRequest(request('/api/integrations?spaceId=spc_family'), ENV, {
    fetcher: makeFetcher(store), assertion: ASSERTION, id: REQUEST_ID,
  });

  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).data, []);
  assert.ok(grant.revokedAt);
  assert.match(principal.description, /^homemew:v1:discarded=spc_family/u);
});
