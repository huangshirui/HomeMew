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
    if (url === 'https://core.example.test/api/v1/spaces?kind=family') {
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.get('authorization'), 'Bearer life-token-a');
      assert.equal(init.headers.get('cookie'), null);
      assert.equal(init.headers.get('cf-access-jwt-assertion'), null);
      return jsonResponse(200, { data: [{ id: 'spc_1' }] }, { 'x-request-id': 'req_core' });
    }
    assert.fail(`unexpected upstream ${url}`);
  };
  const handler = createWebHandler({ fetcher, now: () => NOW });
  const response = await handler.fetch(request('/api/lifespace/core/v1/spaces?kind=family'), ENV);
  assert.equal(response.status, 200);
  assert.deepEqual((await payload(response)).data, [{ id: 'spc_1' }]);
  assert.equal(response.headers.get('x-request-id'), 'req_core');
  assert.ok(response.headers.get('set-cookie'));
  assert.equal(calls.length, 2);
});
