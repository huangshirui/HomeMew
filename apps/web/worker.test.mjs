import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebHandler } from './worker.mjs';

const ENV = {
  ENVIRONMENT: 'test',
  LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_test_application_credential',
  LIFESPACE_IDENTITY_URL: 'https://auth.example.test',
  LIFESPACE_CORE_URL: 'https://core.example.test',
  WEB_SESSION_SECRET: 'test-session-secret-with-more-than-32-characters',
};
const NOW = Date.parse('2026-08-22T12:00:00Z');

function request(path, { method = 'GET', assertion = 'access-jwt-a', cookie, origin = 'https://homemew.example.test', body } = {}) {
  const headers = new Headers({ 'x-request-id': 'req_test' });
  if (assertion) headers.set('cf-access-jwt-assertion', assertion);
  if (cookie) headers.set('cookie', cookie);
  if (!['GET', 'HEAD'].includes(method) && origin) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function payload(response) {
  return response.json();
}

function cookiePair(response) {
  const header = response.headers.get('set-cookie');
  assert.ok(header, 'expected set-cookie');
  return header.split(';', 1)[0];
}

test('health reports Access BFF readiness without exposing secrets', async () => {
  const handler = createWebHandler({ fetcher: async () => assert.fail('health must not call upstream'), now: () => NOW });
  const response = await handler.fetch(request('/health', { assertion: null }), ENV);
  assert.equal(response.status, 200);
  assert.deepEqual((await payload(response)).data, {
    ok: true,
    service: 'homemew-web',
    environment: 'test',
    ready: true,
    integrationsReady: false,
    activityReady: false,
    accessMode: 'cloudflare-access',
  });
});

test('API fails closed when Cloudflare Access assertion is absent', async () => {
  const handler = createWebHandler({ fetcher: async () => assert.fail('missing assertion must fail before upstream'), now: () => NOW });
  const response = await handler.fetch(request('/api/session', { assertion: null }), ENV);
  assert.equal(response.status, 401);
  assert.equal((await payload(response)).error.code, 'ACCESS_ASSERTION_REQUIRED');
});

test('session exchange keeps LifeSpace bearer server-side and creates a signed host-only cookie', async () => {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/internal/v1/access/tokens')) {
      assert.equal(init.headers.authorization, `Bearer ${ENV.LIFESPACE_APPLICATION_CREDENTIAL}`);
      const body = JSON.parse(init.body);
      assert.equal(body.accessAssertion, 'access-jwt-a');
      assert.ok(body.requestedScopes.includes('resources:write'));
      return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    }
    if (url.endsWith('/api/v1/me')) {
      assert.equal(init.headers.authorization, 'Bearer life-token-a');
      return jsonResponse(200, { data: { id: 'usr_1', displayName: 'User One' } });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/session'), ENV);
  assert.equal(response.status, 200);
  const data = (await payload(response)).data;
  assert.equal(data.authenticated, true);
  assert.equal(data.user.id, 'usr_1');
  assert.equal(JSON.stringify(data).includes('life-token-a'), false);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-homemew_session=/u);
  assert.match(setCookie, /Secure/u);
  assert.match(setCookie, /HttpOnly/u);
  assert.match(setCookie, /SameSite=Lax/u);
  assert.equal(calls.length, 2);
});

test('signed session is bound to the current Access assertion', async () => {
  const firstFetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    if (url.endsWith('/api/v1/me')) return jsonResponse(200, { data: { id: 'usr_1' } });
    assert.fail(`unexpected upstream ${url}`);
  };
  const firstHandler = createWebHandler({ fetcher: firstFetcher, now: () => NOW });
  const first = await firstHandler.fetch(request('/api/session'), ENV);
  const cookie = cookiePair(first);

  let exchangeCalls = 0;
  const secondFetcher = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) {
      exchangeCalls += 1;
      assert.equal(JSON.parse(init.body).accessAssertion, 'access-jwt-b');
      return jsonResponse(200, { data: { accessToken: 'life-token-b', expiresIn: 900 } });
    }
    if (url.endsWith('/api/v1/me')) {
      assert.equal(init.headers.authorization, 'Bearer life-token-b');
      return jsonResponse(200, { data: { id: 'usr_2' } });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const secondHandler = createWebHandler({ fetcher: secondFetcher, now: () => NOW + 1000 });
  const second = await secondHandler.fetch(request('/api/session', { assertion: 'access-jwt-b', cookie }), ENV);
  assert.equal(second.status, 200);
  assert.equal(exchangeCalls, 1, 'different Access assertion must not reuse the previous LifeSpace session');
  assert.equal((await payload(second)).data.user.id, 'usr_2');
});

test('state-changing link challenge rejects cross-origin requests before Identity is called', async () => {
  let called = false;
  const handler = createWebHandler({
    fetcher: async () => { called = true; return jsonResponse(500, {}); },
    now: () => NOW,
  });
  const response = await handler.fetch(request('/api/access/link-challenge', {
    method: 'POST',
    origin: 'https://evil.example.test',
  }), ENV);
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).error.code, 'INVALID_ORIGIN');
  assert.equal(called, false);
});

test('HomeMew Web does not expose Access account registration', async () => {
  let called = false;
  const handler = createWebHandler({
    fetcher: async () => { called = true; return jsonResponse(500, {}); },
    now: () => NOW,
  });
  const response = await handler.fetch(request('/api/access/register', {
    method: 'POST',
    body: { displayName: 'New User' },
  }), ENV);
  assert.equal(response.status, 404);
  assert.equal((await payload(response)).error.code, 'NOT_FOUND');
  assert.equal(called, false, 'registration must not be forwarded to LifeSpace Identity');
});

test('link challenge is created from the verified Access assertion only', async () => {
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    assert.ok(url.endsWith('/internal/v1/access/link-challenges'));
    assert.deepEqual(JSON.parse(init.body), { accessAssertion: 'access-jwt-a' });
    return jsonResponse(201, { data: { challengeId: 'alc_123', expiresAt: '2026-08-22T12:10:00.000Z' } });
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/access/link-challenge', { method: 'POST' }), ENV);
  assert.equal(response.status, 201);
  assert.equal((await payload(response)).data.challengeId, 'alc_123');
});

test('Web family list intersects current LifeSpace Spaces with the HomeMew family catalog', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) {
      return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    }
    if (url.endsWith('/api/v1/me/spaces')) {
      return jsonResponse(200, { data: [
        { id: 'spc_home', name: 'Home', timezone: 'Asia/Shanghai', avatarUrl: null, role: 'owner', version: 1 },
        { id: 'spc_other', name: 'Other', timezone: 'UTC', avatarUrl: null, role: 'owner', version: 1 },
      ] });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const env = {
    ...ENV,
    HOMEMEW_BACKEND: {
      async fetch(incoming) {
        assert.equal(new URL(incoming.url).pathname, '/internal/v1/family-catalog/reconcile');
        const body = await incoming.json();
        assert.deepEqual(body.spaceIds, ['spc_home', 'spc_other']);
        return jsonResponse(200, { data: { familySpaceIds: ['spc_home'] } });
      },
    },
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/families'), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await payload(response)).data, [
    { id: 'spc_home', name: 'Home', timezone: 'Asia/Shanghai', avatarUrl: null, role: 'owner', version: 1 },
  ]);
});

test('Web family creation registers the created Space in HomeMew application metadata', async () => {
  let createdBody;
  let registered;
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) {
      return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    }
    if (url.endsWith('/api/v1/me')) {
      return jsonResponse(200, { data: { id: 'usr_1', displayName: 'User One' } });
    }
    if (url.endsWith('/api/v1/spaces')) {
      createdBody = JSON.parse(init.body);
      return jsonResponse(201, { data: {
        id: 'spc_home', name: 'Home', timezone: 'Asia/Shanghai', avatarUrl: null, role: 'owner', version: 1,
      } });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const env = {
    ...ENV,
    HOMEMEW_BACKEND: {
      async fetch(incoming) {
        assert.equal(new URL(incoming.url).pathname, '/internal/v1/family-catalog/register');
        registered = await incoming.json();
        return jsonResponse(200, { data: { spaceId: registered.spaceId, source: registered.source } });
      },
    },
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/families', {
    method: 'POST',
    body: { name: 'Home', timezone: 'Asia/Shanghai' },
  }), env);
  assert.equal(response.status, 201);
  assert.deepEqual(createdBody, {
    name: 'Home',
    timezone: 'Asia/Shanghai',
    ownerDisplayName: 'User One',
  });
  assert.deepEqual(registered, { spaceId: 'spc_home', source: 'created' });
  assert.equal(Object.hasOwn((await payload(response)).data, 'kind'), false);
});

test('Web family invite preview rejects a LifeSpace invite outside the HomeMew catalog', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) {
      return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    }
    if (url.endsWith('/api/v1/space-invites/preview')) {
      return jsonResponse(200, { data: {
        space: { id: 'spc_other', name: 'Other', memberCount: 1 },
        expiresAt: '2026-09-24T00:00:00Z',
        canJoin: true,
      } });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const env = {
    ...ENV,
    HOMEMEW_BACKEND: {
      async fetch() {
        return jsonResponse(200, { data: { familySpaceIds: [] } });
      },
    },
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/family-invites/preview', {
    method: 'POST',
    body: { token: 'LS-OTHER' },
  }), env);
  assert.equal(response.status, 422);
  assert.equal((await payload(response)).error.code, 'NOT_HOMEMEW_FAMILY_INVITE');
});

test('Web family invite preview reports an eight-member family as full', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) {
      return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    }
    if (url.endsWith('/api/v1/space-invites/preview')) {
      return jsonResponse(200, { data: {
        space: { id: 'spc_full', name: 'Full', memberCount: 8 },
        expiresAt: '2026-09-24T00:00:00Z',
        canJoin: true,
      } });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const env = {
    ...ENV,
    HOMEMEW_BACKEND: {
      async fetch(incoming) {
        assert.equal(new URL(incoming.url).pathname, '/internal/v1/family-catalog/reconcile');
        return jsonResponse(200, { data: { familySpaceIds: ['spc_full'] } });
      },
    },
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/family-invites/preview', {
    method: 'POST',
    body: { token: 'LS-FULL' },
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await payload(response)).data.canJoin, false);
});

test('Web family join delegates the capacity-critical commit to the per-family backend coordinator', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) {
      return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    }
    if (url.endsWith('/api/v1/space-invites/preview')) {
      return jsonResponse(200, { data: {
        space: { id: 'spc_home', name: 'Home', memberCount: 7 },
        expiresAt: '2026-09-24T00:00:00Z',
        canJoin: true,
      } });
    }
    if (url.endsWith('/api/v1/me')) {
      return jsonResponse(200, { data: { id: 'usr_1', displayName: 'User One' } });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const backendCalls = [];
  const env = {
    ...ENV,
    HOMEMEW_BACKEND: {
      async fetch(incoming) {
        const path = new URL(incoming.url).pathname;
        backendCalls.push(path);
        const body = await incoming.json();
        if (path === '/internal/v1/family-catalog/reconcile') {
          return jsonResponse(200, { data: { familySpaceIds: ['spc_home'] } });
        }
        if (path === '/internal/v1/family-joins/commit') {
          assert.equal(incoming.headers.get('authorization'), 'Bearer life-token-a');
          assert.deepEqual(body, { familyId: 'spc_home', token: 'LS-JOIN', displayName: 'User One' });
          return jsonResponse(201, { data: { spaceId: 'spc_home', role: 'editor', joinedAt: '2026-09-23T12:00:00Z' } });
        }
        if (path === '/internal/v1/family-catalog/register') {
          assert.deepEqual(body, { spaceId: 'spc_home', source: 'joined' });
          return jsonResponse(200, { data: { spaceId: 'spc_home', source: 'joined' } });
        }
        return assert.fail(`unexpected backend path ${path}`);
      },
    },
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/family-invites/join', {
    method: 'POST',
    body: { token: 'LS-JOIN' },
  }), env);
  assert.equal(response.status, 201);
  assert.deepEqual((await payload(response)).data, {
    spaceId: 'spc_home', role: 'editor', joinedAt: '2026-09-23T12:00:00Z',
  });
  assert.deepEqual(backendCalls, [
    '/internal/v1/family-catalog/reconcile',
    '/internal/v1/family-joins/commit',
    '/internal/v1/family-catalog/register',
  ]);
});

test('Web activity reporting uses the verified LifeSpace session and backend binding', async () => {
  const fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/internal/v1/access/tokens')) return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    assert.fail(`unexpected upstream ${url}`);
  };
  let backendCalls = 0;
  const env = {
    ...ENV,
    HOMEMEW_BACKEND: {
      async fetch(activityRequest) {
        backendCalls += 1;
        assert.equal(new URL(activityRequest.url).pathname, '/api/v1/activity/me');
        assert.equal(activityRequest.headers.get('authorization'), 'Bearer life-token-a');
        assert.deepEqual(await activityRequest.json(), { channel: 'web' });
        return new Response(null, { status: 204 });
      },
    },
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/activity/me', { method: 'POST' }), env);
  assert.equal(response.status, 204);
  assert.equal(backendCalls, 1);
  assert.ok(response.headers.get('set-cookie'), 'new Web session must still be returned to the browser');
});

test('Web activity reporting rejects cross-origin requests before backend write', async () => {
  let backendCalls = 0;
  const env = {
    ...ENV,
    HOMEMEW_BACKEND: { async fetch() { backendCalls += 1; return new Response(null, { status: 204 }); } },
  };
  const handler = createWebHandler({ fetcher: async () => assert.fail('cross-origin activity must fail before session exchange'), now: () => NOW });
  const response = await handler.fetch(request('/api/activity/me', {
    method: 'POST',
    origin: 'https://evil.example.test',
  }), env);
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).error.code, 'INVALID_ORIGIN');
  assert.equal(backendCalls, 0);
});

test('Core proxy obtains a LifeSpace session and forwards only the user bearer', async () => {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/internal/v1/access/tokens')) {
      return jsonResponse(200, { data: { accessToken: 'life-token-a', expiresIn: 900 } });
    }
    if (url === 'https://core.example.test/api/v1/me/spaces') {
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.get('authorization'), 'Bearer life-token-a');
      assert.equal(init.headers.get('cookie'), null);
      assert.equal(init.headers.get('cf-access-jwt-assertion'), null);
      return jsonResponse(200, { data: [{ id: 'spc_1' }] }, { 'x-request-id': 'req_core' });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/lifespace/core/v1/me/spaces'), ENV);
  assert.equal(response.status, 200);
  assert.deepEqual((await payload(response)).data, [{ id: 'spc_1' }]);
  assert.equal(response.headers.get('x-request-id'), 'req_core');
  assert.ok(response.headers.get('set-cookie'));
  assert.equal(calls.length, 2);
});

test('cached Web session revalidates mailbox authorization before reusing user authority', async () => {
  const token=`header.${Buffer.from(JSON.stringify({sub:'usr_1'})).toString('base64url')}.signature`;
  let revoked=false, exchanges=0, checks=0;
  const handler=createWebHandler({now:()=>NOW,fetcher:async(input)=>{
    const url=String(input);
    if(url.endsWith('/internal/v1/access/tokens')){exchanges++;return jsonResponse(200,{data:{accessToken:token,expiresIn:900}});}
    if(url.endsWith('/internal/v1/access/session-check')){checks++;return revoked
      ?jsonResponse(403,{error:{code:'ACCESS_EMAIL_REVOKED',message:'邮箱登录授权已更改'}})
      :jsonResponse(200,{data:{userId:'usr_1'}});}
    if(url.endsWith('/api/v1/me'))return jsonResponse(200,{data:{id:'usr_1'}});
    assert.fail(`unexpected upstream ${url}`);
  }});
  const first=await handler.fetch(request('/api/session'),ENV);
  const cookie=cookiePair(first);
  assert.equal((await handler.fetch(request('/api/session',{cookie}),ENV)).status,200);
  assert.equal(exchanges,1);assert.equal(checks,1);
  revoked=true;
  const denied=await handler.fetch(request('/api/session',{cookie}),ENV);
  assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'ACCESS_EMAIL_REVOKED');
  assert.equal(exchanges,1);
});


