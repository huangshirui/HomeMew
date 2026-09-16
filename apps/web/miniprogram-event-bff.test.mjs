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

function canonicalEvent(overrides = {}) {
  return {
    id: 'rec_abc123',
    spaceId: 'spc_family',
    summary: 'Dinner',
    description: null,
    location: null,
    status: 'active',
    attendeePersonIds: [],
    version: 3,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-09-15T01:00:00.000Z',
    updatedAt: '2026-09-15T01:00:00.000Z',
    when: { kind: 'date', start: '2026-09-15', endExclusive: '2026-09-16' },
    ...overrides,
  };
}

test('matches only bounded Mini Program Event routes', () => {
  assert.deepEqual(matchMiniProgramEventRoute('/api/v1/miniprogram/spaces/spc_family/events'), {
    spaceId: 'spc_family',
    recordId: null,
  });
  assert.deepEqual(matchMiniProgramEventRoute('/api/v1/miniprogram/spaces/spc_family/events/rec_abc123'), {
    spaceId: 'spc_family',
    recordId: 'rec_abc123',
  });
  assert.equal(matchMiniProgramEventRoute('/api/v1/miniprogram/spaces/not-space/events'), null);
  assert.equal(matchMiniProgramEventRoute('/api/v1/miniprogram/spaces/spc_family/tasks'), null);
});

test('lowers stable Mini list parameters into Canonical Query and restores the legacy Event DTO', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ data: { items: [canonicalEvent()], nextCursor: 'next_1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_core' },
    });
  };
  try {
    const response = await handleMiniProgramEventBff(
      request('/api/v1/miniprogram/spaces/spc_family/events?rangeStart=2026-09-14T16%3A00%3A00.000Z&rangeEnd=2026-09-15T16%3A00%3A00.000Z&dateStart=2026-09-15&dateEndExclusive=2026-09-16&timezone=Asia%2FShanghai&status=active&sort=calendarStart%3Aasc&limit=50'),
      { LIFESPACE_CORE_URL: 'https://core.example.test' },
    );
    assert.equal(response.status, 200);
    assert.equal(captured.url, 'https://core.example.test/api/v1/spaces/spc_family/models/event/records/query');
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers.get('authorization'), 'Bearer user-token-1234567890');
    assert.deepEqual(JSON.parse(captured.init.body), {
      filter: {
        and: [
          {
            field: 'when',
            op: 'overlaps',
            value: {
              kind: 'local_date_window',
              startDate: '2026-09-15',
              endDateExclusive: '2026-09-16',
              timezone: 'Asia/Shanghai',
            },
          },
          { field: 'status', op: 'eq', value: 'active' },
        ],
      },
      sort: [{ field: 'when', direction: 'asc' }],
      page: { limit: 50 },
      context: { viewingTimezone: 'Asia/Shanghai' },
    });
    const payload = await response.json();
    assert.equal(payload.data.nextCursor, 'next_1');
    assert.equal(payload.data.items[0].isAllDay, true);
    assert.equal(payload.data.items[0].startDate, '2026-09-15');
    assert.equal(payload.data.items[0].endDateExclusive, '2026-09-16');
    assert.equal(payload.data.items[0].when, undefined);
    assert.equal(response.headers.get('x-request-id'), 'req_core');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('translates legacy Mini mutations to TemporalRange and translates the response back', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({
      data: canonicalEvent({
        when: {
          kind: 'instant',
          start: '2026-09-15T10:00:00.000Z',
          endExclusive: '2026-09-15T11:00:00.000Z',
        },
      }),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const legacyPayload = {
      version: 3,
      summary: 'Dinner',
      isAllDay: false,
      startAt: '2026-09-15T10:00:00.000Z',
      endAt: '2026-09-15T11:00:00.000Z',
      startTimezone: 'Asia/Shanghai',
      endTimezone: 'Asia/Shanghai',
      startDate: null,
      endDateExclusive: null,
    };
    const response = await handleMiniProgramEventBff(
      request('/api/v1/miniprogram/spaces/spc_family/events/rec_abc123', { method: 'PATCH', body: legacyPayload }),
      { LIFESPACE_CORE_URL: 'https://core.example.test/' },
    );
    assert.equal(response.status, 200);
    assert.equal(captured.url, 'https://core.example.test/api/v1/spaces/spc_family/models/event/records/rec_abc123');
    assert.equal(captured.init.method, 'PATCH');
    assert.deepEqual(JSON.parse(captured.init.body), {
      version: 3,
      summary: 'Dinner',
      when: {
        kind: 'instant',
        start: '2026-09-15T10:00:00.000Z',
        endExclusive: '2026-09-15T11:00:00.000Z',
      },
    });
    const payload = await response.json();
    assert.equal(payload.data.isAllDay, false);
    assert.equal(payload.data.startAt, '2026-09-15T10:00:00.000Z');
    assert.equal(payload.data.endAt, '2026-09-15T11:00:00.000Z');
    assert.equal(payload.data.startTimezone, null);
    assert.equal(payload.data.when, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects missing bearer, missing timezone context, and unsupported query parameters', async () => {
  const noBearer = await handleMiniProgramEventBff(
    request('/api/v1/miniprogram/spaces/spc_family/events', { token: '' }),
    { LIFESPACE_CORE_URL: 'https://core.example.test' },
  );
  assert.equal(noBearer.status, 401);

  const missingTimezone = await handleMiniProgramEventBff(
    request('/api/v1/miniprogram/spaces/spc_family/events?dateStart=2026-09-15&dateEndExclusive=2026-09-16'),
    { LIFESPACE_CORE_URL: 'https://core.example.test' },
  );
  assert.equal(missingTimezone.status, 400);

  const badQuery = await handleMiniProgramEventBff(
    request('/api/v1/miniprogram/spaces/spc_family/events?upstream=https%3A%2F%2Fevil.example'),
    { LIFESPACE_CORE_URL: 'https://core.example.test' },
  );
  assert.equal(badQuery.status, 400);
});
