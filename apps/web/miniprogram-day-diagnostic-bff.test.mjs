import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleMiniProgramDayDiagnosticBff,
  matchMiniProgramDayDiagnosticRoute,
} from './miniprogram-day-diagnostic-bff.mjs';

const TOKEN = 'Bearer user-token-1234567890';
const MEMBERS = [
  { userId: 'usr_me', personId: 'per_me', displayName: 'Me' },
  { userId: 'usr_kid', personId: 'per_kid', displayName: 'Kid' },
];

function request(path, { method = 'GET', body, token = TOKEN } = {}) {
  const headers = new Headers({ 'x-request-id': 'req_day' });
  if (token) headers.set('authorization', token);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ok(data, status = 200, requestId = 'req_upstream') {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

function env(core) {
  return { LIFESPACE_CORE: { fetch: core } };
}

function day(fields = {}) {
  return {
    id: 'rec_day',
    spaceId: 'spc_home',
    modelKey: 'day_record',
    modelVersion: 1,
    kind: 'cycle',
    name: 'Filter',
    description: null,
    anchorDate: '2026-09-01',
    subjectPersonId: 'per_kid',
    icon: '💧',
    status: 'active',
    attentionAfterDays: null,
    attentionBeforeDays: 2,
    cycleDays: 10,
    version: 2,
    computed: { temporal: {
      today: '2026-09-16', state: 'overdue', attentionLevel: 'critical',
      isAttentionRequired: true, elapsedDays: 15, remainingDays: -5,
      progressRatio: 1, nextDueDate: '2026-09-11',
    } },
    createdBy: { type: 'user', id: 'usr_me', displayName: 'Me' },
    updatedBy: { type: 'service', id: 'svc_agent', displayName: 'Agent' },
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-16T00:00:00Z',
    ...fields,
  };
}

test('matches only bounded Day and diagnostic routes; Creation Draft stays absent', () => {
  assert.deepEqual(matchMiniProgramDayDiagnosticRoute('/api/v1/miniprogram/families/spc_home/day-records'), {
    kind: 'day-records', familyId: 'spc_home',
  });
  assert.deepEqual(matchMiniProgramDayDiagnosticRoute('/api/v1/miniprogram/families/spc_home/day-records/rec_1/occurrences'), {
    kind: 'occurrences', familyId: 'spc_home', recordId: 'rec_1',
  });
  assert.deepEqual(matchMiniProgramDayDiagnosticRoute('/api/v1/miniprogram/diagnostics/lifespace-core'), {
    kind: 'diagnostic',
  });
  assert.equal(matchMiniProgramDayDiagnosticRoute('/api/v1/miniprogram/families/spc_home/creation-drafts'), null);
  assert.equal(matchMiniProgramDayDiagnosticRoute('/api/v1/miniprogram/families/spc_home/models/day_record'), null);
  assert.equal(matchMiniProgramDayDiagnosticRoute('/api/v1/miniprogram/families/not-space/day-records'), null);
});

test('Day list lowers the compatibility query exactly and preserves Temporal computed state', async () => {
  const calls = [];
  const response = await handleMiniProgramDayDiagnosticBff(request(
    '/api/v1/miniprogram/families/spc_home/day-records?kind=cycle&status=active&subjectUserId=usr_kid&attentionOnly=true&sort=attention&limit=20&cursor=cur_1',
  ), env(async incoming => {
    const url = new URL(incoming.url);
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/members')) return ok(MEMBERS);
    return ok({ items: [day()], nextCursor: 'cur_2' });
  }));
  assert.deepEqual(calls, [
    '/api/v1/spaces/spc_home/members',
    '/api/v1/spaces/spc_home/models/day_record/records?kind=cycle&status=active&subjectPersonId=per_kid&attentionOnly=true&sort=attention%3Adesc&limit=20&cursor=cur_1',
  ]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'req_upstream');
  const result = (await response.json()).data;
  assert.equal(result.nextCursor, 'cur_2');
  assert.deepEqual(result.items[0].subject, {
    userId: 'usr_kid', displayName: 'Kid',
    avatarUrl: 'https://homemew.example.test/api/v1/miniprogram/media/users/usr_kid/avatar',
  });
  assert.deepEqual(result.items[0].computed, day().computed.temporal);
  assert.equal(result.items[0].nextDueDate, '2026-09-11');
});

test('Mini 生活记录 filter accepts elapsed,cycle with stable cursor pagination and Temporal DTOs', async () => {
  const calls = [];
  let pageCount = 0;
  const core = async incoming => {
    const url = new URL(incoming.url);
    if (url.pathname.endsWith('/members')) return ok(MEMBERS);
    calls.push({ method: incoming.method, path: url.pathname + url.search });
    pageCount += 1;
    return ok({
      items: [day({
        id: pageCount === 1 ? 'rec_elapsed' : 'rec_cycle',
        name: pageCount === 1 ? 'Life elapsed' : 'Life cycle',
        kind: pageCount === 1 ? 'elapsed' : 'cycle',
      })],
      nextCursor: pageCount === 1 ? 'cur_life_2' : null,
    });
  };
  const path = '/api/v1/miniprogram/families/spc_home/day-records?status=active&kind=elapsed%2Ccycle&limit=20';
  const first = await handleMiniProgramDayDiagnosticBff(request(path), env(core));
  assert.equal(first.status, 200);
  const firstPage = (await first.json()).data;
  assert.equal(firstPage.nextCursor, 'cur_life_2');
  assert.deepEqual(firstPage.items.map(item => item.kind), ['elapsed']);
  assert.deepEqual(firstPage.items[0].computed, day().computed.temporal);
  assert.equal(firstPage.items[0].subject.userId, 'usr_kid');

  const second = await handleMiniProgramDayDiagnosticBff(request(path + '&cursor=cur_life_2'), env(core));
  assert.equal(second.status, 200);
  const secondPage = (await second.json()).data;
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual(secondPage.items.map(item => item.kind), ['cycle']);
  assert.equal(secondPage.items[0].nextDueDate, '2026-09-11');
  assert.deepEqual(calls, [
    { method: 'GET', path: '/api/v1/spaces/spc_home/models/day_record/records?kind=elapsed%2Ccycle&status=active&limit=20' },
    { method: 'GET', path: '/api/v1/spaces/spc_home/models/day_record/records?kind=elapsed%2Ccycle&status=active&limit=20&cursor=cur_life_2' },
  ]);
});

test('Mini life filter rejects unsupported multi-kinds and Temporal-only combinations', async () => {
  const never = env(async () => assert.fail('invalid Day filter must not reach upstream'));
  const invalidQueries = [
    'kind=elapsed%2Ccycle%2Ccountdown',
    'kind=cycle%2Celapsed',
    'kind=elapsed%2Ccycle&attentionOnly=true',
    'kind=elapsed%2Ccycle&attentionOnly=false',
    'kind=elapsed%2Ccycle&sort=attention',
    'kind=elapsed%2Ccycle&sort=date_asc',
    'kind=elapsed%2Ccycle&sort=date_desc',
  ];
  for (const query of invalidQueries) {
    const response = await handleMiniProgramDayDiagnosticBff(
      request('/api/v1/miniprogram/families/spc_home/day-records?' + query),
      never,
    );
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error.code, 'INVALID_QUERY', query);
  }
});

test('Day subject me resolves through the current principal', async () => {
  const calls = [];
  const response = await handleMiniProgramDayDiagnosticBff(request(
    '/api/v1/miniprogram/families/spc_home/day-records?subjectUserId=me',
  ), env(async incoming => {
    const url = new URL(incoming.url);
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/members')) return ok(MEMBERS);
    if (url.pathname === '/api/v1/me') return ok({ principal: { id: 'usr_me' } });
    return ok({ items: [], nextCursor: null });
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    '/api/v1/spaces/spc_home/members',
    '/api/v1/me',
    '/api/v1/spaces/spc_home/models/day_record/records?subjectPersonId=per_me&limit=100',
  ]);
});

test('Day create/update translate subject user IDs and preserve version', async () => {
  const mutations = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    mutations.push({ method: incoming.method, path, body: await incoming.json() });
    return ok(day({ version: incoming.method === 'POST' ? 1 : 3 }), incoming.method === 'POST' ? 201 : 200);
  };
  const created = await handleMiniProgramDayDiagnosticBff(request(
    '/api/v1/miniprogram/families/spc_home/day-records', {
      method: 'POST', body: { kind: 'cycle', name: 'Filter', anchorDate: '2026-09-01', cycleDays: 10, subjectUserId: 'usr_kid' },
    },
  ), env(core));
  const updated = await handleMiniProgramDayDiagnosticBff(request(
    '/api/v1/miniprogram/families/spc_home/day-records/rec_day', {
      method: 'PATCH', body: { name: 'New', subjectUserId: null, version: 2 },
    },
  ), env(core));
  assert.equal(created.status, 201);
  assert.equal(updated.status, 200);
  assert.deepEqual(mutations, [
    { method: 'POST', path: '/api/v1/spaces/spc_home/models/day_record/records', body: {
      kind: 'cycle', name: 'Filter', anchorDate: '2026-09-01', cycleDays: 10, subjectPersonId: 'per_kid',
    } },
    { method: 'PATCH', path: '/api/v1/spaces/spc_home/models/day_record/records/rec_day', body: {
      name: 'New', version: 2, subjectPersonId: null,
    } },
  ]);
});

test('Day get/delete/archive/restore use only fixed record and Action paths', async () => {
  const calls = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    calls.push({ method: incoming.method, path, body: incoming.method === 'GET' ? null : await incoming.json() });
    if (path.endsWith('/members')) return ok(MEMBERS);
    if (incoming.method === 'DELETE') return new Response(null, { status: 204 });
    return ok(day());
  };
  const got = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day'), env(core));
  const deleted = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day', { method: 'DELETE', body: { version: 2 } }), env(core));
  const archived = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day/archive', { method: 'POST', body: { version: 2 } }), env(core));
  const restored = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day/restore', { method: 'POST', body: { version: 2 } }), env(core));
  assert.equal(got.status, 200);
  assert.equal(deleted.status, 204);
  assert.equal(archived.status, 200);
  assert.equal(restored.status, 200);
  assert.deepEqual(calls.filter(call => !call.path.endsWith('/members')).map(call => call.path), [
    '/api/v1/spaces/spc_home/models/day_record/records/rec_day',
    '/api/v1/spaces/spc_home/models/day_record/records/rec_day',
    '/api/v1/spaces/spc_home/models/day_record/records/rec_day/actions/archive',
    '/api/v1/spaces/spc_home/models/day_record/records/rec_day/actions/restore',
  ]);
});

test('Occurrence list maps DTO and create composes the previous anchor with updated record', async () => {
  const calls = [];
  const core = async incoming => {
    const url = new URL(incoming.url);
    calls.push({ method: incoming.method, path: url.pathname + url.search, body: incoming.method === 'POST' ? await incoming.clone().json() : null });
    if (url.pathname.endsWith('/members')) return ok(MEMBERS);
    if (url.pathname.endsWith('/occurrences')) return ok({ items: [{
      id: 'occ_1', recordId: 'rec_day', occurredOn: '2026-09-11', note: null,
      source: 'manual', intervalDays: 10,
      recordedBy: { type: 'service', id: 'svc_1', displayName: 'Agent' },
      createdAt: '2026-09-11T00:00:00Z',
    }], nextCursor: null });
    if (url.pathname.endsWith('/actions/record-occurrence')) return ok(day({ anchorDate: '2026-09-21', version: 3 }));
    return ok(day({ anchorDate: '2026-09-01' }));
  };
  const listed = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day/occurrences?limit=5'), env(core));
  const created = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day/occurrences', {
    method: 'POST', body: { occurredOn: '2026-09-21', note: 'done', version: 2 },
  }), env(core));
  assert.deepEqual((await listed.json()).data.items[0].recordedBy, {
    type: 'system', id: 'svc_1', name: 'Agent', avatarUrl: null,
  });
  const result = (await created.json()).data;
  assert.equal(result.previousAnchorDate, '2026-09-01');
  assert.equal(result.intervalDays, 20);
  assert.equal(result.record.anchorDate, '2026-09-21');
  assert.ok(calls.some(call => call.path.endsWith('/actions/record-occurrence')
    && call.body.version === 2 && call.body.occurredOn === '2026-09-21'));
});

test('diagnostic performs exactly three fixed Core binding probes per category', async () => {
  const calls = [];
  const response = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/diagnostics/lifespace-core', {
    method: 'POST', body: { familyId: 'spc_home' },
  }), env(async incoming => {
    const url = new URL(incoming.url);
    calls.push({ method: incoming.method, path: url.pathname, query: [...url.searchParams.keys()], body: incoming.method === 'POST' ? await incoming.json() : null });
    return ok({ ready: true });
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 9);
  assert.deepEqual(calls.filter(call => call.path === '/health').length, 3);
  assert.deepEqual(calls.filter(call => call.path === '/api/v1/status').length, 3);
  const business = calls.filter(call => call.path.endsWith('/models/task/records/query'));
  assert.equal(business.length, 3);
  assert.deepEqual(business[0].body, {
    filter: { field: 'status', op: 'eq', value: 'pending' },
    sort: [{ field: 'dueDate', direction: 'asc' }],
    page: { limit: 1 },
  });
  const report = (await response.json()).data;
  assert.equal(report.target, 'LifeSpace Core (Cloudflare Service Binding)');
  assert.equal(report.sampleCount, 3);
  assert.equal(report.healthSamples.length, 3);
  assert.equal(JSON.stringify(report).includes('http'), false);
});

test('Day/diagnostic routes deny arbitrary fields, queries, enums, methods and missing auth', async () => {
  const never = env(async () => assert.fail('unexpected upstream call'));
  const invalidQuery = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records?modelKey=task'), never);
  const duplicate = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records?status=active&status=archived'), never);
  const invalidBody = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records', { method: 'POST', body: { kind: 'cycle', upstreamUrl: 'https://evil.test' } }), never);
  const invalidKind = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records?kind=unknown'), never);
  const emptyUpdate = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day', { method: 'PATCH', body: { version: 2 } }), never);
  const method = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day', { method: 'PUT', body: {} }), never);
  const diagnosticField = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/diagnostics/lifespace-core', { method: 'POST', body: { familyId: 'spc_home', url: 'https://evil.test' } }), never);
  const unauthenticated = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records', { token: null }), env(async incoming => {
    if (new URL(incoming.url).pathname.endsWith('/members')) return new Response(JSON.stringify({ error: { code: 'NO' } }), { status: 401 });
    return assert.fail('unexpected');
  }));
  assert.deepEqual([invalidQuery.status, duplicate.status, invalidBody.status, invalidKind.status, emptyUpdate.status, method.status, diagnosticField.status, unauthenticated.status], [400, 400, 400, 400, 422, 405, 400, 401]);
});

test('LifeSpace authorization and optimistic-concurrency errors propagate unchanged', async () => {
  const upstream = new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'stale' } }), {
    status: 409, headers: { 'content-type': 'application/json', 'x-request-id': 'req_conflict' },
  });
  const response = await handleMiniProgramDayDiagnosticBff(request('/api/v1/miniprogram/families/spc_home/day-records/rec_day', {
    method: 'DELETE', body: { version: 1 },
  }), env(async () => upstream));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('x-request-id'), 'req_conflict');
  assert.deepEqual(await response.json(), { error: { code: 'VERSION_CONFLICT', message: 'stale' } });
});

test('DayRecord DTO uses only shared presentation Icon; legacy icon writes are rejected', async () => {
  const calls = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    calls.push({ path, method: incoming.method });
    if (path.endsWith('/members')) return ok(MEMBERS);
    if (path.endsWith('/icon')) {
      const body = await incoming.json();
      assert.deepEqual(body, { icon: { type: 'emoji', value: '📚' }, version: 2 });
      return ok({ id: 'rec_day', version: 3, presentation: { icon: body.icon } });
    }
    return ok(day({ presentation: { icon: { type: 'emoji', value: '📚' } } }));
  };
  const path = '/api/v1/miniprogram/families/spc_home/day-records/rec_day';
  assert.deepEqual(matchMiniProgramDayDiagnosticRoute(`${path}/icon`), {
    kind: 'icon', familyId: 'spc_home', recordId: 'rec_day',
  });
  assert.deepEqual(matchMiniProgramDayDiagnosticRoute(`${path}/icon-image`), {
    kind: 'icon-image', familyId: 'spc_home', recordId: 'rec_day',
  });
  const response = await handleMiniProgramDayDiagnosticBff(request(path), env(core));
  assert.equal(response.status, 200);
  const dto = (await response.json()).data;
  assert.deepEqual(dto.presentation, { icon: { type: 'emoji', value: '📚' } });
  assert.equal(Object.hasOwn(dto, 'icon'), false);

  const legacy = await handleMiniProgramDayDiagnosticBff(request(path, {
    method: 'PATCH', body: { version: 2, icon: null },
  }), env(core));
  assert.equal(legacy.status, 400);

  const changed = await handleMiniProgramDayDiagnosticBff(request(`${path}/icon`, {
    method: 'PATCH', body: { version: 2, icon: { type: 'emoji', value: '📚' } },
  }), env(core));
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).data.presentation.icon, { type: 'emoji', value: '📚' });
  assert.equal(calls.filter(call => call.path.endsWith('/icon')).length, 1);
});

test('DayRecord Icon image route rejects unsupported types and oversized bytes before transfer', async () => {
  const path = '/api/v1/miniprogram/families/spc_home/day-records/rec_day/icon-image';
  let forwards = 0;
  const app = env(async () => { forwards++; return assert.fail('no Core File call permitted'); });
  const invalidType = await handleMiniProgramDayDiagnosticBff(
    new Request(`https://homemew.example.test${path}`, {
      method: 'POST',
      headers: { authorization: TOKEN, 'content-type': 'image/svg+xml' },
      body: new Uint8Array([1, 2]),
    }), app);
  assert.equal(invalidType.status, 415);
  const oversized = await handleMiniProgramDayDiagnosticBff(
    new Request(`https://homemew.example.test${path}`, {
      method: 'POST',
      headers: { authorization: TOKEN, 'content-type': 'image/png' },
      body: new Uint8Array(256 * 1024 + 1),
    }), app);
  assert.equal(oversized.status, 413);
  assert.equal(forwards, 0);
});
