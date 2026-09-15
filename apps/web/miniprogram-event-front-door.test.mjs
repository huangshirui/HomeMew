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

test('Mini Program Event BFF is handled before the Access-protected Web app', async () => {
  const originalFetch = globalThis.fetch;
  let appCalled = false;
  let upstreamCalled = false;
  globalThis.fetch = async (url, init) => {
    upstreamCalled = true;
    assert.equal(String(url), 'https://core.example.test/api/v1/spaces/spc_family/models/event/records/rec_abc123');
    assert.equal(init.headers.get('authorization'), 'Bearer user-token-1234567890');
    return new Response(JSON.stringify({ data: { id: 'rec_abc123' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
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
      { LIFESPACE_CORE_URL: 'https://core.example.test' },
    );
    assert.equal(response.status, 200);
    assert.equal(upstreamCalled, true);
    assert.equal(appCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
