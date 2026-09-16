import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrontDoorHandler } from './front-door.mjs';

function request(path, { method = 'GET', body } = {}) {
  const headers = new Headers({
    authorization: 'Bearer user-token-1234567890',
    'x-request-id': 'req_front_door',
  });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('Mini Program Event BFF is handled through the Core binding before the Access-protected Web app', async () => {
  let appCalled = false;
  let upstreamCalled = false;
  const handler = createFrontDoorHandler({
    app: {
      async fetch() {
        appCalled = true;
        return new Response('web');
      },
    },
  });
  const response = await handler.fetch(
    request('/api/v1/miniprogram/spaces/spc_family/events/rec_abc123'),
    {
      LIFESPACE_CORE: {
        async fetch(incoming) {
          upstreamCalled = true;
          assert.equal(new URL(incoming.url).pathname, '/api/v1/spaces/spc_family/models/event/records/rec_abc123');
          assert.equal(incoming.headers.get('authorization'), 'Bearer user-token-1234567890');
          return new Response(JSON.stringify({ data: { id: 'rec_abc123' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamCalled, true);
  assert.equal(appCalled, false);
});

test('Mini Program Family BFF is handled before the generic Mini catch-all and Web app', async () => {
  let appCalled = false;
  let upstreamCalled = false;
  const handler = createFrontDoorHandler({
    app: {
      async fetch() {
        appCalled = true;
        return new Response('web');
      },
    },
  });
  const response = await handler.fetch(
    request('/api/v1/miniprogram/family-invites/preview', { method: 'POST', body: { code: 'LS-CODE' } }),
    {
      LIFESPACE_CORE: {
        async fetch(incoming) {
          upstreamCalled = true;
          assert.equal(new URL(incoming.url).pathname, '/api/v1/space-invites/preview');
          assert.deepEqual(await incoming.json(), { token: 'LS-CODE' });
          return new Response(JSON.stringify({
            data: {
              space: { id: 'spc_home', name: 'Home', memberCount: 2 },
              expiresAt: '2026-09-17T00:00:00Z',
              canJoin: true,
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.family.id, 'spc_home');
  assert.equal(upstreamCalled, true);
  assert.equal(appCalled, false);
});

test('unknown Mini BFF routes fail closed before the Access-protected Web app', async () => {
  let appCalled = false;
  const handler = createFrontDoorHandler({
    app: {
      async fetch() {
        appCalled = true;
        return new Response('web');
      },
    },
  });
  const response = await handler.fetch(request('/api/v1/miniprogram/proxy/upstream'), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'BFF_ROUTE_NOT_FOUND');
  assert.equal(appCalled, false);
});
