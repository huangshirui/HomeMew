import assert from 'node:assert/strict';
import test from 'node:test';
import { handleIntegrationRequest } from './integration-api.mjs';

const ENV = {
  LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_web_application',
  LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL: 'lsa_integrations_application',
  LIFESPACE_IDENTITY_URL: 'https://auth.example.test',
  LIFESPACE_CORE_URL: 'https://core.example.test',
};

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

const ASSERTION = 'access-assertion';
const REQUEST_ID = 'req_integrations';

function managerResponses(url, init) {
  if (url === 'https://auth.example.test/internal/v1/access/tokens') {
    assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_APPLICATION_CREDENTIAL}`);
    assert.deepEqual(JSON.parse(init.body).requestedScopes, ['profile:read', 'grants:manage']);
    return response(200, { data: { accessToken: 'manager-token', expiresIn: 300 } });
  }
  if (url === 'https://auth.example.test/api/v1/me') {
    assert.equal(init.headers.authorization, 'Bearer manager-token');
    return response(200, { data: { id: 'usr_manager', displayName: 'Manager' } });
  }
  return null;
}

test('integration list proves current Space management and only exposes principals associated by Data Grant', async () => {
  const calls = [];
  const grants = [
    {
      id: 'grt_1', sourceSpaceId: 'spc_family', granteeType: 'service', granteeId: 'svc_family',
      resourceType: 'model', resourceId: 'event', permission: 'write', expiresAt: null, revokedAt: null,
    },
  ];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const manager = managerResponses(url, init);
    if (manager) return manager;
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants?includeRevoked=true') {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      return response(200, { data: grants });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      return response(200, { data: [
        { id: 'svc_family', displayName: 'Family n8n', description: null, status: 'active', maxScopes: ['resources:read', 'resources:write'], createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z' },
        { id: 'svc_other', displayName: 'Other', description: null, status: 'active', maxScopes: ['resources:read'], createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z' },
      ] });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals/svc_family/tokens') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      return response(200, { data: [] });
    }
    assert.fail(`unexpected upstream ${url}`);
  };

  const result = await handleIntegrationRequest(request('/api/integrations?spaceId=spc_family'), ENV, {
    fetcher,
    assertion: ASSERTION,
    id: REQUEST_ID,
  });
  assert.equal(result.status, 200);
  const data = (await payload(result)).data;
  assert.equal(data.length, 1);
  assert.equal(data[0].id, 'svc_family');
  assert.equal(data[0].permissions.event, 'write');
  assert.equal(data[0].effectivePermissions.task, null);
  assert.equal(calls.some((call) => call.url.includes('svc_other/tokens')), false);
});

test('creating an integration separates human Grant authority from the integrations application credential', async () => {
  const grants = [];
  const tokens = [];
  const principal = {
    id: 'svc_new', displayName: 'Home n8n', description: 'Automation', status: 'active',
    maxScopes: ['resources:read', 'resources:write'], createdByUserId: 'usr_manager',
    createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z',
  };
  let principalCreated = false;
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    const manager = managerResponses(url, init);
    if (manager) return manager;
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants?includeRevoked=true') {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      return response(200, { data: grants });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals' && init.method === 'POST') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      const body = JSON.parse(init.body);
      assert.equal(body.createdByUserId, 'usr_manager');
      assert.deepEqual(body.maxScopes, ['resources:read', 'resources:write']);
      principalCreated = true;
      return response(201, { data: principal });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants' && init.method === 'POST') {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      const body = JSON.parse(init.body);
      assert.equal(body.granteeId, 'svc_new');
      assert.equal(body.resourceType, 'model');
      const grant = {
        id: `grt_${body.resourceId}`,
        sourceSpaceId: 'spc_family',
        granteeType: 'service',
        granteeId: 'svc_new',
        resourceType: 'model',
        resourceId: body.resourceId,
        permission: body.permission,
        expiresAt: null,
        revokedAt: null,
      };
      grants.push(grant);
      return response(201, { data: grant });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals/svc_new/tokens' && init.method === 'POST') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      const metadata = {
        id: 'sat_new', principalId: 'svc_new', displayPrefix: 'lsp_pat_abcd', lastFour: '1234',
        label: 'Home n8n API Token', scopes: ['resources:read', 'resources:write'], audience: 'lifespace-core',
        expiresAt: null, createdAt: '2026-08-24T00:01:00Z', createdByUserId: 'usr_manager', lastUsedAt: null, revokedAt: null,
      };
      tokens.push(metadata);
      return response(201, { data: { ...metadata, token: 'lsp_pat_plaintext_once' } });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals' && (init.method ?? 'GET') === 'GET') {
      return response(200, { data: principalCreated ? [principal] : [] });
    }
    if (url === 'https://auth.example.test/api/v1/service-principals/svc_new/tokens' && (init.method ?? 'GET') === 'GET') {
      return response(200, { data: tokens });
    }
    assert.fail(`unexpected upstream ${url}`);
  };

  const result = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST',
    body: {
      spaceId: 'spc_family',
      displayName: 'Home n8n',
      description: 'Automation',
      permissions: { event: 'write', task: 'read', day_record: null },
    },
  }), ENV, { fetcher, assertion: ASSERTION, id: REQUEST_ID });

  assert.equal(result.status, 201);
  const data = (await payload(result)).data;
  assert.equal(data.integration.id, 'svc_new');
  assert.equal(data.integration.permissions.event, 'write');
  assert.equal(data.integration.permissions.task, 'read');
  assert.equal(data.token, 'lsp_pat_plaintext_once');
  assert.equal(grants.length, 2);
});

test('state-changing integration routes reject cross-origin requests before touching LifeSpace', async () => {
  let called = false;
  const result = await handleIntegrationRequest(request('/api/integrations', {
    method: 'POST',
    origin: 'https://evil.example.test',
    body: { spaceId: 'spc_family', displayName: 'Bad', permissions: { event: 'read' } },
  }), ENV, {
    fetcher: async () => { called = true; return response(500, {}); },
    assertion: ASSERTION,
    id: REQUEST_ID,
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
    fetcher: async () => { called = true; return response(500, {}); },
    assertion: ASSERTION,
    id: REQUEST_ID,
  });
  assert.equal(result.status, 503);
  assert.equal((await payload(result)).error.code, 'INTEGRATIONS_NOT_CONFIGURED');
  assert.equal(called, false);
});
