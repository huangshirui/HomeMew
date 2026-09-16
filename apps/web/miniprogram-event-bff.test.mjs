import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMiniProgramEventBff, matchMiniProgramEventRoute } from './miniprogram-event-bff.mjs';

function request(path, { method = 'GET', body, token = 'Bearer user-token-1234567890' } = {}) {
  const headers = new Headers({ authorization: token, 'x-request-id': 'req_test' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('matches only bounded Mini Program Event routes', () => {
  assert.deepEqual(matchMiniProgramEventRoute('/api/v1/miniprogram/spaces/spc_family/events'), {
    spaceId: 'spc_family', recordId: null,
  });
  assert.equal(matchMiniProgramEventRoute('/api/v1/miniprogram/spaces/spc_family/tasks'), null);
});

test('uses the Core binding and preserves the current legacy Event query', async () => {
  let captured;
  const response = await handleMiniProgramEventBff(
    request('/api/v1/miniprogram/spaces/spc_family/events?dateStart=2026-09-15&dateEndExclusive=2026-09-16&timezone=Asia%2FShanghai&sort=calendarStart%3Aasc'),
    { LIFESPACE_CORE: { fetch: async incoming => {
      captured = incoming;
      return new Response(JSON.stringify({ data: { items: [], nextCursor: null } }), {
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_core' },
      });
    } } },
  );
  assert.equal(
    String(captured.url),
    'https://lifespace.internal/api/v1/spaces/spc_family/models/event/records?dateStart=2026-09-15&dateEndExclusive=2026-09-16&sort=calendarStart%3Aasc',
  );
  assert.equal(captured.headers.get('authorization'), 'Bearer user-token-1234567890');
  assert.equal(response.headers.get('x-request-id'), 'req_core');
});

test('forwards event mutation body through the binding', async () => {
  let captured;
  const payload = { version: 3, summary: 'Dinner' };
  const response = await handleMiniProgramEventBff(
    request('/api/v1/miniprogram/spaces/spc_family/events/rec_abc123', { method: 'PATCH', body: payload }),
    { LIFESPACE_CORE: { fetch: async incoming => {
      captured = incoming;
      return new Response(JSON.stringify({ data: { id: 'rec_abc123' } }), {
        headers: { 'content-type': 'application/json' },
      });
    } } },
  );
  assert.equal(response.status, 200);
  assert.equal(new URL(captured.url).pathname, '/api/v1/spaces/spc_family/models/event/records/rec_abc123');
  assert.deepEqual(await captured.json(), payload);
});

test('rejects missing bearer and unsupported query parameters', async () => {
  const noBearer = await handleMiniProgramEventBff(
    request('/api/v1/miniprogram/spaces/spc_family/events', { token: '' }), { LIFESPACE_CORE: { fetch: async () => assert.fail() } },
  );
  assert.equal(noBearer.status, 401);
  const badQuery = await handleMiniProgramEventBff(
    request('/api/v1/miniprogram/spaces/spc_family/events?upstream=https%3A%2F%2Fevil.example'),
    { LIFESPACE_CORE: { fetch: async () => assert.fail() } },
  );
  assert.equal(badQuery.status, 400);
});
