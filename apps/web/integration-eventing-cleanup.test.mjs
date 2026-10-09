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
const REQUEST_ID = 'req_eventing_cleanup';

function response(status, data) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  });
}

function request() {
  return new Request('https://homemew.example.test/api/integrations/svc_family/disable', {
    method: 'POST',
    headers: {
      origin: 'https://homemew.example.test',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ spaceId: 'spc_family' }),
  });
}

function boundPrincipal() {
  return {
    id: 'svc_family',
    displayName: 'Family automation',
    description: 'homemew:v1:space=spc_family\nAutomation',
    status: 'active',
    maxScopes: ['resources:read', 'resources:write'],
    createdByUserId: 'usr_manager',
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
  };
}

function makeFetcher({ failingEndpointId = null } = {}) {
  const state = {
    principal: boundPrincipal(),
    calls: [],
    deletedEndpointIds: [],
  };

  const fetcher = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const authorization = init.headers?.authorization;
    state.calls.push(`${method} ${url}`);

    if (url === 'https://auth.example.test/internal/v1/access/tokens' && method === 'POST') {
      assert.equal(authorization, `Bearer ${ENV.LIFESPACE_APPLICATION_CREDENTIAL}`);
      const scopes = JSON.parse(init.body).requestedScopes;
      if (scopes.includes('grants:manage')) {
        assert.deepEqual(scopes, ['profile:read', 'grants:manage']);
        return response(200, { data: { accessToken: 'manager-token', expiresIn: 300 } });
      }
      assert.deepEqual(scopes, ['spaces:manage']);
      return response(200, { data: { accessToken: 'eventing-token', expiresIn: 300 } });
    }

    if (url === 'https://auth.example.test/api/v1/me') {
      assert.equal(authorization, 'Bearer manager-token');
      return response(200, { data: { id: 'usr_manager', displayName: 'Manager' } });
    }

    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants?includeRevoked=true') {
      assert.equal(authorization, 'Bearer manager-token');
      return response(200, { data: [] });
    }

    if (url === 'https://auth.example.test/api/v1/service-principals' && method === 'GET') {
      assert.equal(authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      return response(200, { data: [state.principal] });
    }

    if (url === 'https://auth.example.test/api/v1/service-principals/svc_family' && method === 'PATCH') {
      assert.equal(authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      Object.assign(state.principal, JSON.parse(init.body));
      return response(200, { data: state.principal });
    }

    if (url === 'https://core.example.test/api/v1/webhook-endpoints?spaceId=spc_family&subscriberServicePrincipalId=svc_family' && method === 'GET') {
      assert.equal(authorization, 'Bearer eventing-token');
      return response(200, { data: { items: [{ id: 'whe_one' }, { id: 'whe_two' }] } });
    }

    const endpointMatch = url.match(/^https:\/\/core\.example\.test\/api\/v1\/webhook-endpoints\/(whe_[A-Za-z0-9_-]+)$/u);
    if (endpointMatch && method === 'DELETE') {
      assert.equal(authorization, 'Bearer eventing-token');
      state.deletedEndpointIds.push(endpointMatch[1]);
      if (endpointMatch[1] === failingEndpointId) {
        return response(500, { error: { code: 'UPSTREAM_FAILED', message: 'failed' } });
      }
      return response(204);
    }

    if (url === 'https://auth.example.test/api/v1/service-principals/svc_family/tokens' && method === 'GET') {
      return response(200, { data: [] });
    }

    if (url === 'https://auth.example.test/api/v1/service-principals/svc_family/oauth-credentials' && method === 'GET') {
      return response(200, { data: [] });
    }

    assert.fail(`unexpected upstream ${method} ${url}`);
  };

  return { state, fetcher };
}

test('disabling an external system disables the principal before deleting all Eventing endpoints', async () => {
  const { state, fetcher } = makeFetcher();
  const result = await handleIntegrationRequest(request(), ENV, {
    fetcher,
    assertion: ASSERTION,
    id: REQUEST_ID,
  });

  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.data.disabled, true);
  assert.deepEqual(payload.data.cleanupWarnings, []);
  assert.equal(state.principal.status, 'disabled');
  assert.deepEqual(state.deletedEndpointIds, ['whe_one', 'whe_two']);

  const disableIndex = state.calls.indexOf('PATCH https://auth.example.test/api/v1/service-principals/svc_family');
  const endpointListIndex = state.calls.indexOf('GET https://core.example.test/api/v1/webhook-endpoints?spaceId=spc_family&subscriberServicePrincipalId=svc_family');
  assert.ok(disableIndex >= 0);
  assert.ok(endpointListIndex > disableIndex);
});

test('Eventing cleanup is best-effort after the principal kill switch and reports endpoint warnings', async () => {
  const { state, fetcher } = makeFetcher({ failingEndpointId: 'whe_one' });
  const result = await handleIntegrationRequest(request(), ENV, {
    fetcher,
    assertion: ASSERTION,
    id: REQUEST_ID,
  });

  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.data.disabled, true);
  assert.equal(state.principal.status, 'disabled');
  assert.deepEqual(state.deletedEndpointIds, ['whe_one', 'whe_two']);
  assert.deepEqual(payload.data.cleanupWarnings, ['eventing:endpoint:whe_one']);
});
