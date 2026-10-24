import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMiniProgramFinalEventBff, matchMiniProgramFinalEventRoute } from './miniprogram-final-event-bff.mjs';

function request(path, { method = 'GET', body } = {}) {
  const headers = new Headers({ authorization: 'Bearer user-token-1234567890', 'x-request-id': 'req_test' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function response(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify({ data }), {
    status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_core' },
  });
}

const members = [
  { userId: 'usr_alice', personId: 'per_alice', displayName: 'Alice' },
  { userId: 'usr_bob', personId: 'per_bob', displayName: 'Bob' },
];

function common(overrides = {}) {
  return {
    id: 'rec_event', spaceId: 'spc_family', summary: 'Dinner', description: null,
    location: 'Home', status: 'active', attendeePersonIds: ['per_alice'],
    createdBy: { type: 'user', id: 'usr_alice', displayName: 'Alice' },
    updatedBy: { type: 'user', id: 'usr_alice', displayName: 'Alice' },
    version: 3, createdAt: '2026-09-15T01:00:00.000Z',
    updatedAt: '2026-09-15T01:00:00.000Z', ...overrides,
  };
}

const temporalItems = [
  common({ when: { kind: 'date', start: '2026-09-15', endExclusive: '2026-09-16' } }),
  common({ id: 'rec_timed', when: { kind: 'instant', start: '2026-09-15T10:00:00.000Z', endExclusive: '2026-09-15T11:00:00.000Z' } }),
];

test('matches only bounded final family Event routes', () => {
  assert.deepEqual(matchMiniProgramFinalEventRoute('/api/v1/miniprogram/families/spc_family/events'), {
    familyId: 'spc_family', recordId: null,
  });
  assert.deepEqual(matchMiniProgramFinalEventRoute('/api/v1/miniprogram/families/spc_family/events/rec_event'), {
    familyId: 'spc_family', recordId: 'rec_event',
  });
  assert.equal(matchMiniProgramFinalEventRoute('/api/v1/miniprogram/spaces/spc_family/events'), null);
  assert.equal(matchMiniProgramFinalEventRoute('/api/v1/miniprogram/families/bad/events'), null);
});

async function list(items = temporalItems) {
  const calls = [];
  const env = {
    LIFESPACE_CORE: { fetch: async incoming => {
      calls.push(incoming);
      const url = new URL(incoming.url);
      if (url.pathname.endsWith('/members')) return response(members);
      return response({ items, nextCursor: 'next_1' });
    } },
  };
  const result = await handleMiniProgramFinalEventBff(
    request('/api/v1/miniprogram/families/spc_family/events?startDate=2026-09-15&endDateExclusive=2026-09-16&timezone=Asia%2FShanghai&attendeeId=usr_alice&status=active&q=dinner&limit=50'),
    env,
  );
  return { result, payload: await result.json(), calls };
}

test('TemporalRange resources project to the stable Mini Event DTO', async () => {
  const listed = await list();
  assert.equal(listed.result.status, 200);
  assert.equal(listed.payload.data.items[0].isAllDay, true);
  assert.equal(listed.payload.data.items[0].startDate, '2026-09-15');
  assert.equal(listed.payload.data.items[1].isAllDay, false);
  assert.equal(listed.payload.data.items[1].startAt, '2026-09-15T10:00:00.000Z');
  assert.deepEqual(listed.payload.data.items[0].attendees[0], {
    userId: 'usr_alice', displayName: 'Alice',
    avatarUrl: 'https://homemew.example.test/api/v1/miniprogram/media/users/usr_alice/avatar',
  });
});

test('new LifeSpace Location objects are projected into the stable Mini string Event DTO', async () => {
  const source = common({ ...temporalItems[0],
    location: { name: '球场', address: '上海', coordinates: { latitude: 31, longitude: 121 } },
  });
  const result = await list([source]);
  assert.equal(result.payload.data.items[0].location, '球场');
});

test('Mini string write converts to canonical Location only after explicit upstream cutover', async () => {
  for (const format of ['string', 'location']) {
    const calls = [];
    const env = {
      LIFESPACE_EVENT_LOCATION_FORMAT: format,
      LIFESPACE_CORE: { fetch: async incoming => {
        calls.push(incoming);
        if (new URL(incoming.url).pathname.endsWith('/members')) return response(members);
        return response(common({ ...temporalItems[0],
          location: format === 'location' ? { name: '球场' } : '球场',
        }), 201);
      } },
    };
    const result = await handleMiniProgramFinalEventBff(request('/api/v1/miniprogram/families/spc_family/events', {
      method: 'POST', body: {
        summary: '训练', location: '球场', isAllDay: true,
        startDate: '2026-09-15', endDateExclusive: '2026-09-16',
      },
    }), env);
    assert.equal(result.status, 201);
    const body = await calls[1].json();
    assert.deepEqual(body.location, format === 'location' ? { name: '球场' } : '球场');
    assert.equal((await result.json()).data.location, '球场');
  }
});

test('older Mini title edits preserve rich coordinates when location name is unchanged', async () => {
  const original = common({
    ...temporalItems[0],
    location: { name: '球场', address: '上海', coordinates: { latitude: 31, longitude: 121 } },
  });
  const calls = [];
  const env = {
    LIFESPACE_EVENT_LOCATION_FORMAT: 'location',
    LIFESPACE_CORE: { fetch: async incoming => {
      calls.push(incoming);
      if (new URL(incoming.url).pathname.endsWith('/members')) return response(members);
      if (incoming.method === 'GET') return response(original);
      const update = await incoming.clone().json();
      return response({ ...original, ...update, version: 4 });
    } },
  };
  const result = await handleMiniProgramFinalEventBff(request(
    '/api/v1/miniprogram/families/spc_family/events/rec_event', {
      method: 'PATCH', body: { version: 3, summary: '新标题', location: '球场' },
    }), env);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 3); // members, one existing Event read, one PATCH
  assert.deepEqual((await calls[2].json()).location, original.location);
  assert.equal((await result.json()).data.location, '球场');
});

test('older Mini explicit rename drops outdated coordinates and rejects structured client fields', async () => {
  const original = common({
    ...temporalItems[0],
    location: { name: '球场', address: '上海', coordinates: { latitude: 31, longitude: 121 } },
  });
  const calls = [];
  const env = {
    LIFESPACE_EVENT_LOCATION_FORMAT: 'location',
    LIFESPACE_CORE: { fetch: async incoming => {
      calls.push(incoming);
      if (new URL(incoming.url).pathname.endsWith('/members')) return response(members);
      if (incoming.method === 'GET') return response(original);
      const update = await incoming.clone().json();
      return response({ ...original, ...update, version: 4 });
    } },
  };
  const changed = await handleMiniProgramFinalEventBff(request(
    '/api/v1/miniprogram/families/spc_family/events/rec_event', {
      method: 'PATCH', body: { version: 3, summary: '新标题', location: '新球场' },
    }), env);
  assert.equal(changed.status, 200);
  assert.deepEqual((await calls[2].json()).location, { name: '新球场' });

  const clientObject = await handleMiniProgramFinalEventBff(request(
    '/api/v1/miniprogram/families/spc_family/events/rec_event', {
      method: 'PATCH', body: { version: 3, location: original.location },
    }), env);
  assert.equal(clientObject.status, 422);
});

test('list sends the authoritative Canonical Query local_date_window', async () => {
  const { calls } = await list();
  assert.equal(new URL(calls[1].url).pathname, '/api/v1/spaces/spc_family/models/event/records/query');
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(await calls[1].json(), {
    search: { text: 'dinner' },
    filter: { and: [
      { field: 'when', op: 'overlaps', value: {
        kind: 'local_date_window', startDate: '2026-09-15',
        endDateExclusive: '2026-09-16', timezone: 'Asia/Shanghai',
      } },
      { field: 'attendeePersonIds', op: 'contains', value: 'per_alice' },
      { field: 'status', op: 'eq', value: 'active' },
    ] },
    sort: [{ field: 'when', direction: 'asc' }],
    page: { limit: 50 },
    context: { viewingTimezone: 'Asia/Shanghai' },
  });
});

test('create maps stable all-day fields and user attendees to TemporalRange and Person IDs', async () => {
  const calls = [];
  const env = {
    LIFESPACE_CORE: { fetch: async incoming => {
      calls.push(incoming);
      if (new URL(incoming.url).pathname.endsWith('/members')) return response(members);
      return response(temporalItems[0], 201);
    } },
  };
  const result = await handleMiniProgramFinalEventBff(request('/api/v1/miniprogram/families/spc_family/events', {
    method: 'POST',
    body: {
      summary: 'Dinner', attendeeIds: ['usr_alice'], isAllDay: true,
      startDate: '2026-09-15', endDateExclusive: '2026-09-16',
    },
  }), env);
  assert.equal(result.status, 201);
  assert.deepEqual(await calls[1].json(), {
    summary: 'Dinner', attendeePersonIds: ['per_alice'],
    when: { kind: 'date', start: '2026-09-15', endExclusive: '2026-09-16' },
  });
});

test('partial time update fetches and atomically rewrites the complete TemporalRange', async () => {
  const calls = [];
  const current = temporalItems[1];
  const env = {
    LIFESPACE_CORE: { fetch: async incoming => {
      calls.push(incoming);
      const path = new URL(incoming.url).pathname;
      if (path.endsWith('/members')) return response(members);
      if (incoming.method === 'GET') return response(current);
      return response({ ...current, version: 4, when: { ...current.when, endExclusive: '2026-09-15T12:00:00.000Z' } });
    } },
  };
  const result = await handleMiniProgramFinalEventBff(request('/api/v1/miniprogram/families/spc_family/events/rec_timed', {
    method: 'PATCH', body: { version: 3, endAt: '2026-09-15T12:00:00.000Z' },
  }), env);
  assert.equal(result.status, 200);
  assert.deepEqual(await calls[2].json(), {
    version: 3,
    when: {
      kind: 'instant', start: '2026-09-15T10:00:00.000Z',
      endExclusive: '2026-09-15T12:00:00.000Z',
    },
  });
});

test('legacy split Event resources are rejected instead of silently becoming truth again', async () => {
  const legacy = common({
    isAllDay: true,
    startDate: '2026-09-15',
    endDateExclusive: '2026-09-16',
  });
  const result = await list([legacy]);
  assert.equal(result.result.status, 502);
  assert.equal(result.payload.error.code, 'INVALID_UPSTREAM_RESPONSE');
});

test('rejects client-controlled transport knobs and invalid temporal ranges', async () => {
  const never = { fetch: async () => assert.fail('must not call upstream') };
  const badQuery = await handleMiniProgramFinalEventBff(
    request('/api/v1/miniprogram/families/spc_family/events?upstream=https%3A%2F%2Fevil.example'),
    { LIFESPACE_CORE: never },
  );
  assert.equal(badQuery.status, 400);
  const badCreate = await handleMiniProgramFinalEventBff(request('/api/v1/miniprogram/families/spc_family/events', {
    method: 'POST', body: {
      summary: 'Bad', isAllDay: true, startDate: '2026-09-16', endDateExclusive: '2026-09-15',
    },
  }), { LIFESPACE_CORE: { fetch: async incoming => new URL(incoming.url).pathname.endsWith('/members') ? response(members) : assert.fail() } });
  assert.equal(badCreate.status, 422);
});


test('Event icon metadata is optional and never required for existing clients', async () => {
  const without = await list([temporalItems[0]]);
  assert.equal(Object.hasOwn(without.payload.data.items[0], 'presentation'), false);
  const withIcon = await list([common({ ...temporalItems[0], presentation: { icon: { type: 'emoji', value: '⚽' } } })]);
  assert.deepEqual(withIcon.payload.data.items[0].presentation, { icon: { type: 'emoji', value: '⚽' } });
});
