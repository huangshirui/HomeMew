import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMiniProgramTaskWishBff, matchMiniProgramTaskWishRoute } from './miniprogram-task-wish-bff.mjs';

const TOKEN = 'Bearer user-token-1234567890';
const MEMBERS = [
  { userId: 'usr_me', personId: 'per_me', displayName: 'Me' },
  { userId: 'usr_kid', personId: 'per_kid', displayName: 'Kid' },
];

function request(path, { method = 'GET', body, token = TOKEN } = {}) {
  const headers = new Headers({ 'x-request-id': 'req_task_wish' });
  if (token) headers.set('authorization', token);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ok(data, status = 200, requestId = 'req_upstream') {
  return new Response(JSON.stringify({ data }), {
    status, headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

function resource(model, fields = {}) {
  return {
    id: `rec_${model}`,
    spaceId: 'spc_home',
    modelKey: model,
    modelVersion: 1,
    version: 2,
    createdBy: { type: 'user', id: 'usr_me', displayName: 'Me' },
    updatedBy: { type: 'service', id: 'svc_agent', displayName: 'Agent' },
    createdAt: '2026-09-16T00:00:00Z',
    updatedAt: '2026-09-16T01:00:00Z',
    ...fields,
  };
}

function task(fields = {}) {
  return resource('task', {
    name: 'Buy milk', description: null, status: 'pending', dueDate: null,
    assigneePersonIds: ['per_kid'], completedAt: null, completedByType: null, completedById: null,
    ...fields,
  });
}

function wish(fields = {}) {
  return resource('wish', {
    title: 'See aurora', description: null, desiredDate: null, status: 'open',
    ownerPersonId: 'per_me', fulfilledAt: null,
    ...fields,
  });
}

function env(core) {
  return { LIFESPACE_CORE: { fetch: core } };
}

test('matches only bounded Task and Wish product routes', () => {
  assert.deepEqual(matchMiniProgramTaskWishRoute('/api/v1/miniprogram/families/spc_home/tasks'), {
    kind: 'tasks', familyId: 'spc_home',
  });
  assert.deepEqual(matchMiniProgramTaskWishRoute('/api/v1/miniprogram/families/spc_home/tasks/rec_1/complete'), {
    kind: 'task-action', familyId: 'spc_home', recordId: 'rec_1', action: 'complete',
  });
  assert.deepEqual(matchMiniProgramTaskWishRoute('/api/v1/miniprogram/families/spc_home/wishes/rec_1/fulfill'), {
    kind: 'wish-action', familyId: 'spc_home', recordId: 'rec_1', action: 'fulfill',
  });
  assert.equal(matchMiniProgramTaskWishRoute('/api/v1/miniprogram/families/spc_home/models/task'), null);
  assert.equal(matchMiniProgramTaskWishRoute('/api/v1/miniprogram/families/spc_home/tasks/not-record'), null);
  assert.equal(matchMiniProgramTaskWishRoute('/api/v1/miniprogram/families/spc_home/tasks/rec_1/fulfill'), null);
  assert.equal(matchMiniProgramTaskWishRoute('/api/v1/miniprogram/families/spc_home/wishes/rec_1/complete'), null);
});

test('Task list lowers product search/filter/sort/page exactly and maps Person DTOs', async () => {
  let queryBody;
  const response = await handleMiniProgramTaskWishBff(request(
    '/api/v1/miniprogram/families/spc_home/tasks?status=pending&assigneeId=usr_kid&dueDateFrom=2026-09-16&dueDateTo=2026-09-30&includeNoDue=true&q=milk&sort=updated_desc&cursor=cur_1&limit=20',
  ), env(async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    assert.equal(path, '/api/v1/spaces/spc_home/models/task/records/query');
    assert.equal(incoming.method, 'POST');
    queryBody = await incoming.json();
    return ok({ items: [task()], nextCursor: 'cur_2' });
  }));
  assert.deepEqual(queryBody, {
    search: { text: 'milk' },
    filter: { and: [
      { field: 'status', op: 'eq', value: 'pending' },
      { field: 'assigneePersonIds', op: 'contains', value: 'per_kid' },
      { or: [
        { and: [
          { field: 'dueDate', op: 'gte', value: '2026-09-16' },
          { field: 'dueDate', op: 'lte', value: '2026-09-30' },
        ] },
        { field: 'dueDate', op: 'isNull' },
      ] },
    ] },
    sort: [{ field: 'updatedAt', direction: 'desc' }],
    page: { cursor: 'cur_1', limit: 20 },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'req_upstream');
  const data = (await response.json()).data;
  assert.equal(data.nextCursor, 'cur_2');
  assert.deepEqual(data.items[0].assignees, [{
    userId: 'usr_kid', displayName: 'Kid',
    avatarUrl: 'https://homemew.example.test/api/v1/miniprogram/media/users/usr_kid/avatar',
  }]);
  assert.deepEqual(data.items[0].createdBy, {
    type: 'user', id: 'usr_me', name: 'Me', avatarUrl: null,
  });
  assert.deepEqual(data.items[0].updatedBy, {
    type: 'system', id: 'svc_agent', name: 'Agent', avatarUrl: null,
  });
});

test('Task assignee me is resolved from the authoritative Core principal', async () => {
  const calls = [];
  const response = await handleMiniProgramTaskWishBff(request(
    '/api/v1/miniprogram/families/spc_home/tasks?assigneeId=me',
  ), env(async incoming => {
    const path = new URL(incoming.url).pathname;
    calls.push(path);
    if (path.endsWith('/members')) return ok(MEMBERS);
    if (path === '/api/v1/me') return ok({ principal: { id: 'usr_me' } });
    assert.deepEqual((await incoming.json()).filter, {
      field: 'assigneePersonIds', op: 'contains', value: 'per_me',
    });
    return ok({ items: [], nextCursor: null });
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    '/api/v1/spaces/spc_home/members',
    '/api/v1/me',
    '/api/v1/spaces/spc_home/models/task/records/query',
  ]);
});

test('Task create/update translate assignee user IDs and preserve optimistic version', async () => {
  const mutations = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    if (path === '/api/v1/me') return ok({ principal: { id: 'usr_me' } });
    mutations.push({ method: incoming.method, path, body: await incoming.json() });
    return ok(task({ assigneePersonIds: ['per_me', 'per_kid'], dueDate: '2026-09-20', version: 3 }), incoming.method === 'POST' ? 201 : 200);
  };
  const created = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/tasks', {
    method: 'POST', body: { name: 'Buy milk', dueDate: '2026-09-20', assigneeIds: ['me', 'usr_kid', 'usr_kid'] },
  }), env(core));
  const updated = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/tasks/rec_task', {
    method: 'PATCH', body: { description: 'Two bottles', assigneeIds: [], version: 3 },
  }), env(core));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.assignees.length, 2);
  assert.equal(updated.status, 200);
  assert.deepEqual(mutations, [
    {
      method: 'POST', path: '/api/v1/spaces/spc_home/models/task/records',
      body: { name: 'Buy milk', description: null, dueDate: '2026-09-20', assigneePersonIds: ['per_me', 'per_kid'] },
    },
    {
      method: 'PATCH', path: '/api/v1/spaces/spc_home/models/task/records/rec_task',
      body: { version: 3, description: 'Two bottles', assigneePersonIds: [] },
    },
  ]);
});

test('Task get/delete/complete/reopen use only the fixed model record and Action paths', async () => {
  const calls = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    calls.push({ method: incoming.method, path, body: incoming.method === 'GET' ? undefined : await incoming.json() });
    if (incoming.method === 'DELETE') return new Response(null, { status: 204 });
    return ok(task({ status: path.endsWith('/complete') ? 'completed' : 'pending' }));
  };
  const got = await handleMiniProgramTaskWishBff(
    request('/api/v1/miniprogram/families/spc_home/tasks/rec_task'), env(core),
  );
  const deleted = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/tasks/rec_task', {
    method: 'DELETE', body: { version: 2 },
  }), env(core));
  const completed = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/tasks/rec_task/complete', {
    method: 'POST', body: { version: 2 },
  }), env(core));
  const reopened = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/tasks/rec_task/reopen', {
    method: 'POST', body: { version: 3 },
  }), env(core));
  assert.equal(got.status, 200);
  assert.equal(deleted.status, 204);
  assert.equal(completed.status, 200);
  assert.equal(reopened.status, 200);
  assert.deepEqual(calls, [
    { method: 'GET', path: '/api/v1/spaces/spc_home/models/task/records/rec_task', body: undefined },
    { method: 'DELETE', path: '/api/v1/spaces/spc_home/models/task/records/rec_task', body: { version: 2 } },
    { method: 'POST', path: '/api/v1/spaces/spc_home/models/task/records/rec_task/actions/complete', body: { version: 2 } },
    { method: 'POST', path: '/api/v1/spaces/spc_home/models/task/records/rec_task/actions/reopen', body: { version: 3 } },
  ]);
});

test('Wish list lowers owner/date/sort/page and maps the owner DTO', async () => {
  let queryBody;
  const response = await handleMiniProgramTaskWishBff(request(
    '/api/v1/miniprogram/families/spc_home/wishes?status=open&ownerUserId=usr_me&desiredFrom=2026-09-01&desiredTo=2026-12-31&sort=created_desc&limit=10',
  ), env(async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    queryBody = await incoming.json();
    return ok({ items: [wish()], nextCursor: null });
  }));
  assert.deepEqual(queryBody, {
    filter: { and: [
      { field: 'status', op: 'eq', value: 'open' },
      { field: 'ownerPersonId', op: 'contains', value: 'per_me' },
      { field: 'desiredDate', op: 'gte', value: '2026-09-01' },
      { field: 'desiredDate', op: 'lte', value: '2026-12-31' },
    ] },
    sort: [{ field: 'createdAt', direction: 'desc' }],
    page: { limit: 10, cursor: null },
  });
  assert.deepEqual((await response.json()).data.items[0].owner, {
    userId: 'usr_me', displayName: 'Me',
    avatarUrl: 'https://homemew.example.test/api/v1/miniprogram/media/users/usr_me/avatar',
  });
});

test('Wish create fixes owner to the current Space Person and update omits immutable owner', async () => {
  const mutations = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    if (path === '/api/v1/me') return ok({ principal: { id: 'usr_me' } });
    mutations.push({ method: incoming.method, path, body: await incoming.json() });
    return ok(wish({ desiredDate: '2027-01-01', version: 3 }), incoming.method === 'POST' ? 201 : 200);
  };
  const created = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/wishes', {
    method: 'POST', body: { title: 'See aurora', desiredDate: '2027-01-01' },
  }), env(core));
  const updated = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/wishes/rec_wish', {
    method: 'PATCH', body: { description: 'In Iceland', version: 2 },
  }), env(core));
  assert.equal(created.status, 201);
  assert.equal(updated.status, 200);
  assert.deepEqual(mutations, [
    {
      method: 'POST', path: '/api/v1/spaces/spc_home/models/wish/records',
      body: { title: 'See aurora', description: null, desiredDate: '2027-01-01', ownerPersonId: 'per_me' },
    },
    {
      method: 'PATCH', path: '/api/v1/spaces/spc_home/models/wish/records/rec_wish',
      body: { description: 'In Iceland', version: 2 },
    },
  ]);
});

test('Wish get/delete/fulfill/reopen preserve fixed action paths and missing-owner fallback', async () => {
  const calls = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    calls.push({ method: incoming.method, path });
    if (incoming.method === 'DELETE') return new Response(null, { status: 204 });
    return ok(wish({ ownerPersonId: 'per_left' }));
  };
  const got = await handleMiniProgramTaskWishBff(
    request('/api/v1/miniprogram/families/spc_home/wishes/rec_wish'), env(core),
  );
  const deleted = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/wishes/rec_wish', {
    method: 'DELETE', body: { version: 2 },
  }), env(core));
  const fulfilled = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/wishes/rec_wish/fulfill', {
    method: 'POST', body: { version: 2 },
  }), env(core));
  const reopened = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/wishes/rec_wish/reopen', {
    method: 'POST', body: { version: 3 },
  }), env(core));
  assert.deepEqual((await got.json()).data.owner, { userId: '', displayName: '已离开成员', avatarUrl: null });
  assert.equal(deleted.status, 204);
  assert.equal(fulfilled.status, 200);
  assert.equal(reopened.status, 200);
  assert.deepEqual(calls.map(call => call.path), [
    '/api/v1/spaces/spc_home/models/wish/records/rec_wish',
    '/api/v1/spaces/spc_home/models/wish/records/rec_wish',
    '/api/v1/spaces/spc_home/models/wish/records/rec_wish/actions/fulfill',
    '/api/v1/spaces/spc_home/models/wish/records/rec_wish/actions/reopen',
  ]);
});

test('Task/Wish routes reject arbitrary query/body fields, invalid enums and unsupported methods', async () => {
  const never = env(async () => assert.fail('unexpected upstream call'));
  const arbitraryQuery = await handleMiniProgramTaskWishBff(
    request('/api/v1/miniprogram/families/spc_home/tasks?modelKey=event'), never,
  );
  const duplicateQuery = await handleMiniProgramTaskWishBff(
    request('/api/v1/miniprogram/families/spc_home/wishes?status=open&status=fulfilled'), never,
  );
  const arbitraryBody = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/tasks', {
    method: 'POST', body: { name: 'x', upstreamPath: '/admin' },
  }), never);
  const invalidSort = await handleMiniProgramTaskWishBff(
    request('/api/v1/miniprogram/families/spc_home/tasks?sort=name_asc'), never,
  );
  const method = await handleMiniProgramTaskWishBff(
    request('/api/v1/miniprogram/families/spc_home/wishes/rec_wish', { method: 'PUT', body: {} }), never,
  );
  assert.equal(arbitraryQuery.status, 400);
  assert.equal(duplicateQuery.status, 400);
  assert.equal(arbitraryBody.status, 400);
  assert.equal(invalidSort.status, 400);
  assert.equal(method.status, 405);
});

test('LifeSpace concurrency and authorization errors are preserved', async () => {
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/members')) return ok(MEMBERS);
    return new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'stale version' } }), {
      status: 409, headers: { 'content-type': 'application/json', 'x-request-id': 'req_conflict' },
    });
  };
  const response = await handleMiniProgramTaskWishBff(request('/api/v1/miniprogram/families/spc_home/tasks/rec_task', {
    method: 'PATCH', body: { name: 'new', version: 1 },
  }), env(core));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('x-request-id'), 'req_conflict');
  assert.deepEqual(await response.json(), { error: { code: 'VERSION_CONFLICT', message: 'stale version' } });
});
