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

test('Mini Program Task/Wish BFF is handled before the generic Mini catch-all and Web app', async () => {
  let appCalled = false;
  const calls = [];
  const handler = createFrontDoorHandler({
    app: {
      async fetch() {
        appCalled = true;
        return new Response('web');
      },
    },
  });
  const response = await handler.fetch(
    request('/api/v1/miniprogram/families/spc_home/tasks?status=pending'),
    {
      LIFESPACE_CORE: {
        async fetch(incoming) {
          const path = new URL(incoming.url).pathname;
          calls.push(path);
          if (path.endsWith('/members')) {
            return new Response(JSON.stringify({ data: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          assert.equal(path, '/api/v1/spaces/spc_home/models/task/records/query');
          assert.deepEqual(await incoming.json(), {
            filter: { field: 'status', op: 'eq', value: 'pending' },
            sort: [{ field: 'dueDate', direction: 'asc' }],
            page: { limit: 100, cursor: null },
          });
          return new Response(JSON.stringify({ data: { items: [], nextCursor: null } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    '/api/v1/spaces/spc_home/members',
    '/api/v1/spaces/spc_home/models/task/records/query',
  ]);
  assert.equal(appCalled, false);
});

test('Mini Program Day BFF is handled before the generic catch-all and Meow remains absent', async () => {
  let appCalled = false;
  const handler = createFrontDoorHandler({
    app: {
      async fetch() {
        appCalled = true;
        return new Response('web');
      },
    },
  });
  const dayResponse = await handler.fetch(
    request('/api/v1/miniprogram/families/spc_home/day-records/rec_day'),
    {
      LIFESPACE_CORE: {
        async fetch(incoming) {
          const path = new URL(incoming.url).pathname;
          if (path.endsWith('/members')) {
            return new Response(JSON.stringify({ data: [] }), {
              status: 200, headers: { 'content-type': 'application/json' },
            });
          }
          assert.equal(path, '/api/v1/spaces/spc_home/models/day_record/records/rec_day');
          return new Response(JSON.stringify({ data: {
            id: 'rec_day', spaceId: 'spc_home', kind: 'elapsed', name: 'Since',
            anchorDate: '2026-09-01', status: 'active', version: 1,
            createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
          } }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    },
  );
  assert.equal(dayResponse.status, 200);
  assert.equal(appCalled, false);

  const meowResponse = await handler.fetch(
    request('/api/v1/miniprogram/families/spc_home/creation-drafts', {
      method: 'POST', body: { text: 'tomorrow', viewingTimezone: 'Asia/Shanghai' },
    }),
    {},
  );
  assert.equal(meowResponse.status, 404);
  assert.equal((await meowResponse.json()).error.code, 'BFF_ROUTE_NOT_FOUND');
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
