import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrontDoorHandler } from './front-door.mjs';

function request(path, { method = 'GET', body } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('Mini Program login is forwarded to the bound backend before Web Access handling', async () => {
  let forwarded = false;
  let appCalled = false;
  const handler = createFrontDoorHandler({
    app: {
      async fetch() {
        appCalled = true;
        return new Response('web');
      },
    },
  });
  const env = {
    HOMEMEW_BACKEND: {
      async fetch(incoming) {
        forwarded = true;
        assert.equal(new URL(incoming.url).pathname, '/api/v1/login/wechat');
        assert.equal(incoming.method, 'POST');
        assert.deepEqual(await incoming.json(), { code: 'wx-code' });
        return new Response(JSON.stringify({ accessToken: 'short-lived-user-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  };

  const response = await handler.fetch(request('/api/v1/login/wechat', { method: 'POST', body: { code: 'wx-code' } }), env);
  assert.equal(response.status, 200);
  assert.equal(forwarded, true);
  assert.equal(appCalled, false);
});

test('non-login traffic stays on the HomeMew Web handler and uses one LifeSpace Application credential', async () => {
  let appCalled = false;
  const handler = createFrontDoorHandler({
    app: {
      async fetch(incoming, receivedEnv) {
        appCalled = true;
        assert.equal(new URL(incoming.url).pathname, '/api/session');
        assert.equal(receivedEnv.LIFESPACE_APPLICATION_CREDENTIAL, 'lsa_homemew');
        assert.equal(receivedEnv.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL, 'lsa_homemew');
        return new Response('web', { status: 401 });
      },
    },
  });
  const response = await handler.fetch(request('/api/session'), {
    LIFESPACE_APPLICATION_CREDENTIAL: 'lsa_homemew',
    LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL: 'lsa_old_integrations',
  });
  assert.equal(response.status, 401);
  assert.equal(appCalled, true);
});

test('invalid or missing application credential is not synthesized for integrations', async () => {
  const handler = createFrontDoorHandler({
    app: {
      async fetch(_incoming, receivedEnv) {
        assert.equal(receivedEnv.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL, 'lsa_old_integrations');
        return new Response('web', { status: 500 });
      },
    },
  });
  const response = await handler.fetch(request('/api/session'), {
    LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL: 'lsa_old_integrations',
  });
  assert.equal(response.status, 500);
});

test('only POST on the exact login path bypasses the Web handler', async () => {
  let appCalls = 0;
  const handler = createFrontDoorHandler({
    app: {
      async fetch() {
        appCalls += 1;
        return new Response('web', { status: 405 });
      },
    },
  });
  const getResponse = await handler.fetch(request('/api/v1/login/wechat'), {});
  const childResponse = await handler.fetch(request('/api/v1/login/wechat/extra', { method: 'POST', body: {} }), {});
  assert.equal(getResponse.status, 405);
  assert.equal(childResponse.status, 405);
  assert.equal(appCalls, 2);
});

test('missing backend binding fails closed for Mini Program login', async () => {
  const handler = createFrontDoorHandler({ app: { fetch: async () => assert.fail('web handler must not receive login') } });
  const response = await handler.fetch(request('/api/v1/login/wechat', { method: 'POST', body: {} }), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'BACKEND_NOT_CONFIGURED');
});
