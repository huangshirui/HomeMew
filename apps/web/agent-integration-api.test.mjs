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
const REQUEST_ID = 'req_agent_integrations';

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

function servicePrincipal() {
  return {
    id: 'svc_family',
    displayName: 'Home n8n',
    description: 'homemew:v1:space=spc_family\nAutomation',
    status: 'active',
    maxScopes: ['resources:read', 'resources:write'],
    createdByUserId: 'usr_manager',
    createdAt: '2026-10-08T00:00:00Z',
    updatedAt: '2026-10-08T00:00:00Z',
  };
}

function createState() {
  return {
    principals: [servicePrincipal()],
    grants: [{
      id: 'grt_service_event', sourceSpaceId: 'spc_family', granteeType: 'service', granteeId: 'svc_family',
      resourceType: 'model', resourceId: 'event', permission: 'read', expiresAt: null, revokedAt: null,
    }],
    agents: [],
    agentCredentials: [],
    serviceTokens: [],
    oauth: [],
    counter: 0,
    issuedAgentCredentialBodies: [],
  };
}

function makeFetcher(state) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;

    if (url === 'https://auth.example.test/internal/v1/access/tokens') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_APPLICATION_CREDENTIAL}`);
      assert.deepEqual(body.requestedScopes, ['profile:read', 'grants:manage']);
      return response(200, { data: { accessToken: 'manager-token', expiresIn: 300 } });
    }
    if (url === 'https://auth.example.test/api/v1/me') {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      return response(200, { data: { id: 'usr_manager', displayName: 'Manager' } });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/person-directory/grants?includeRevoked=true') {
      return response(200, { data: state.grants.filter((grant) => grant.resourceType === 'person_directory') });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants?includeRevoked=true') {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
      return response(200, { data: state.grants });
    }
    if (url === 'https://core.example.test/api/v1/spaces/spc_family/grants' && method === 'POST') {
      assert.equal(init.headers.authorization, 'Bearer manager-token');
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
      grant.revokedAt = '2026-10-08T01:00:00Z';
      return response(204);
    }
    if (grantMatch && method === 'PATCH') {
      const grant = state.grants.find((item) => item.id === grantMatch[1] && !item.revokedAt);
      if (!grant) return response(404, { error: { code: 'NOT_FOUND', message: 'grant missing' } });
      Object.assign(grant, body);
      return response(200, { data: grant });
    }

    if (url === 'https://auth.example.test/api/v1/service-principals' && method === 'GET') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      return response(200, { data: state.principals });
    }
    const principalMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)$/u);
    if (principalMatch && method === 'PATCH') {
      const principal = state.principals.find((item) => item.id === principalMatch[1]);
      if (!principal) return response(404, { error: { code: 'SERVICE_PRINCIPAL_NOT_FOUND', message: 'missing' } });
      Object.assign(principal, body, { updatedAt: '2026-10-08T02:00:00Z' });
      return response(200, { data: principal });
    }

    if (url === 'https://auth.example.test/internal/v1/agents' && method === 'GET') {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL}`);
      return response(200, { data: { items: state.agents } });
    }
    if (url === 'https://auth.example.test/internal/v1/agents' && method === 'POST') {
      const agent = {
        id: `agt_${++state.counter}`,
        displayName: body.displayName,
        status: 'active',
        createdAt: `2026-10-08T00:10:${String(state.counter).padStart(2, '0')}Z`,
        updatedAt: `2026-10-08T00:10:${String(state.counter).padStart(2, '0')}Z`,
      };
      state.agents.push(agent);
      return response(201, { data: agent });
    }

    const agentCredentialListMatch = url.match(/^https:\/\/auth\.example\.test\/internal\/v1\/agents\/(agt_[A-Za-z0-9_-]+)\/api-credentials$/u);
    if (agentCredentialListMatch && method === 'GET') {
      return response(200, { data: state.agentCredentials.filter((item) => item.agentId === agentCredentialListMatch[1]) });
    }
    if (agentCredentialListMatch && method === 'POST') {
      state.issuedAgentCredentialBodies.push(body);
      const credential = {
        id: `agc_${++state.counter}`,
        agentId: agentCredentialListMatch[1],
        applicationId: 'app_homemew_integrations',
        displayPrefix: `lsp_agt_demo_${state.counter}`,
        lastFour: `${2000 + state.counter}`,
        label: body.label,
        scopes: body.scopes,
        audience: 'lifespace-core',
        status: 'active',
        expiresAt: body.expiresAt ?? null,
        createdAt: `2026-10-08T00:20:${String(state.counter).padStart(2, '0')}Z`,
        lastUsedAt: null,
        revokedAt: null,
      };
      state.agentCredentials.push(credential);
      return response(201, { data: { ...credential, token: `lsp_agt_plain_${state.counter}` } });
    }
    const agentCredentialDeleteMatch = url.match(/^https:\/\/auth\.example\.test\/internal\/v1\/agents\/(agt_[A-Za-z0-9_-]+)\/api-credentials\/(agc_[A-Za-z0-9_-]+)$/u);
    if (agentCredentialDeleteMatch && method === 'DELETE') {
      const credential = state.agentCredentials.find((item) => item.id === agentCredentialDeleteMatch[2] && item.status === 'active');
      if (!credential) return response(404, { error: { code: 'AGENT_CREDENTIAL_NOT_FOUND', message: 'missing' } });
      credential.status = 'revoked';
      credential.revokedAt = '2026-10-08T03:00:00Z';
      return response(204);
    }

    const tokenListMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/tokens$/u);
    if (tokenListMatch && method === 'GET') return response(200, { data: state.serviceTokens });
    const oauthListMatch = url.match(/^https:\/\/auth\.example\.test\/api\/v1\/service-principals\/(svc_[A-Za-z0-9_-]+)\/oauth-credentials$/u);
    if (oauthListMatch && method === 'GET') return response(200, { data: state.oauth });

    assert.fail(`unexpected upstream ${method} ${url}`);
  };
}

async function call(state, path, options) {
  return handleIntegrationRequest(request(path, options), ENV, {
    fetcher: makeFetcher(state),
    assertion: ASSERTION,
    id: REQUEST_ID,
  });
}

async function createAgentAccess(state, credentialAccess = 'write') {
  const result = await call(state, '/api/integrations/svc_family/agent', {
    method: 'POST',
    body: {
      spaceId: 'spc_family',
      credentialAccess,
      permissions: { event: null, task: 'read', day_record: null },
    },
  });
  assert.equal(result.status, 201);
  return (await payload(result)).data;
}

test('Agent access keeps credential scope independent from current-family direct grants', async () => {
  const state = createState();
  const data = await createAgentAccess(state, 'write');

  assert.match(data.agent.id, /^agt_/u);
  assert.match(data.credential.token, /^lsp_agt_plain_/u);
  assert.deepEqual(state.issuedAgentCredentialBodies[0].scopes, ['resources:read', 'resources:write']);

  const agentGrant = state.grants.find((item) => item.granteeType === 'agent' && item.resourceId === 'task' && !item.revokedAt);
  assert.equal(agentGrant.permission, 'read');
  assert.equal(state.grants.some((item) => item.granteeType === 'agent' && item.permission === 'write' && !item.revokedAt), false);

  assert.match(state.principals[0].description, /^homemew:v2:space=spc_family;agent=agt_/u);
  assert.match(state.principals[0].description, /\nAutomation$/u);

  const listed = await call(state, '/api/integrations?spaceId=spc_family');
  assert.equal(listed.status, 200);
  const integrations = (await payload(listed)).data;
  assert.equal(integrations.length, 1);
  assert.equal(integrations[0].id, 'svc_family');
  assert.equal(integrations[0].description, 'Automation');
});

test('read-only Agent credential ceiling rejects direct write authority', async () => {
  const state = createState();
  await createAgentAccess(state, 'read');

  const result = await call(state, '/api/integrations/svc_family/agent', {
    method: 'PATCH',
    body: {
      spaceId: 'spc_family',
      permissions: { event: 'write', task: 'read', day_record: null },
    },
  });
  assert.equal(result.status, 422);
  assert.equal((await payload(result)).error.code, 'AGENT_SCOPE_TOO_NARROW');
});

test('Agent credential rotation keeps old and new active until completion', async () => {
  const state = createState();
  const created = await createAgentAccess(state, 'write');
  const oldId = created.agent.credentials.find((item) => item.active).id;

  const started = await call(state, '/api/integrations/svc_family/agent/credential-rotation', {
    method: 'POST',
    body: { spaceId: 'spc_family', credentialAccess: 'read' },
  });
  assert.equal(started.status, 201);
  const startedData = (await payload(started)).data;
  assert.equal(startedData.agent.rotationPending, true);
  assert.equal(startedData.agent.credentials.filter((item) => item.active).length, 2);
  assert.equal(startedData.agent.credentialAccess, 'read');

  const keepId = startedData.credential.credentialId;
  const completed = await call(state, '/api/integrations/svc_family/agent/credential-rotation/complete', {
    method: 'POST',
    body: { spaceId: 'spc_family', keepCredentialId: keepId },
  });
  assert.equal(completed.status, 200);
  const agent = (await payload(completed)).data;
  assert.equal(agent.rotationPending, false);
  assert.equal(agent.credentialAccess, 'read');
  assert.equal(agent.credentials.find((item) => item.id === oldId).active, false);
  assert.equal(agent.credentials.find((item) => item.id === keepId).active, true);
});

test('removing Agent access revokes credentials and current-family grants but keeps stable Agent identity', async () => {
  const state = createState();
  const created = await createAgentAccess(state, 'write');
  const agentId = created.agent.id;

  const removed = await call(state, '/api/integrations/svc_family/agent/remove', {
    method: 'POST',
    body: { spaceId: 'spc_family' },
  });
  assert.equal(removed.status, 200);
  assert.equal((await payload(removed)).data.removed, true);

  assert.equal(state.agents.some((item) => item.id === agentId), true);
  assert.equal(state.agentCredentials.filter((item) => item.agentId === agentId && item.status === 'active').length, 0);
  assert.equal(state.grants.filter((item) => item.granteeType === 'agent' && item.granteeId === agentId && !item.revokedAt).length, 0);
  assert.equal(state.principals[0].description, 'homemew:v1:space=spc_family\nAutomation');

  const read = await call(state, '/api/integrations/svc_family/agent?spaceId=spc_family');
  assert.equal(read.status, 200);
  assert.equal((await payload(read)).data, null);
});

test('Agent direct Grants accept additional model keys without dropping existing authority', async () => {
  const state = createState();
  const created = await createAgentAccess(state, 'write');
  const agentId = created.agent.id;

  const updated = await call(state, '/api/integrations/svc_family/agent', {
    method: 'PATCH', body: { spaceId: 'spc_family', permissions: { habit: 'write' } },
  });
  assert.equal(updated.status, 200);
  const access = (await payload(updated)).data;
  assert.equal(access.permissions.habit, 'write');
  assert.equal(access.permissions.task, 'read', 'unmentioned task Grant stays intact');
  assert.ok(state.grants.some((item) => item.granteeId === agentId && item.resourceId === 'habit' && item.permission === 'write' && !item.revokedAt));

  const narrower = await call(state, '/api/integrations/svc_family/agent/credential-rotation', {
    method: 'POST', body: { spaceId: 'spc_family', credentialAccess: 'read' },
  });
  assert.equal(narrower.status, 422);
  assert.equal((await payload(narrower)).error.code, 'AGENT_SCOPE_TOO_NARROW');
});
