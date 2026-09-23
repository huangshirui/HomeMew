import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMiniProgramFamilyBff, matchMiniProgramFamilyRoute } from './miniprogram-family-bff.mjs';

const TOKEN = 'Bearer user-token-1234567890';

function request(path, { method = 'GET', body, token = TOKEN } = {}) {
  const headers = new Headers({ 'x-request-id': 'req_family' });
  if (token) headers.set('authorization', token);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://homemew.example.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ok(data, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_upstream' },
  });
}

function env(core, identity = async () => assert.fail('unexpected Identity call'), initialFamilyIds = []) {
  const familyIds = new Set(initialFamilyIds);
  return {
    LIFESPACE_CORE: { fetch: core },
    LIFESPACE_IDENTITY: { fetch: identity },
    HOMEMEW_BACKEND: {
      async fetch(incoming) {
        const path = new URL(incoming.url).pathname;
        const body = incoming.method === 'POST' ? await incoming.json() : {};
        if (path === '/internal/v1/family-catalog/register') {
          familyIds.add(body.spaceId);
          return ok({ spaceId: body.spaceId, source: body.source, registeredAt: '2026-09-23T00:00:00Z' });
        }
        if (path === '/internal/v1/family-catalog/reconcile') {
          for (const spaceId of body.legacyFamilySpaceIds ?? []) familyIds.add(spaceId);
          return ok({ familySpaceIds: (body.spaceIds ?? []).filter(spaceId => familyIds.has(spaceId)) });
        }
        return assert.fail(`unexpected backend path ${path}`);
      },
    },
  };
}

test('matches only bounded family/member/invitation routes', () => {
  assert.deepEqual(matchMiniProgramFamilyRoute('/api/v1/miniprogram/families'), { kind: 'families' });
  assert.deepEqual(matchMiniProgramFamilyRoute('/api/v1/miniprogram/families/spc_home/members/usr_mew'), {
    kind: 'member', familyId: 'spc_home', userId: 'usr_mew',
  });
  assert.deepEqual(matchMiniProgramFamilyRoute('/api/v1/miniprogram/family-invites/join'), { kind: 'invite-join' });
  assert.equal(matchMiniProgramFamilyRoute('/api/v1/miniprogram/families/not-space'), null);
  assert.equal(matchMiniProgramFamilyRoute('/api/v1/miniprogram/families/spc_home/invites/not-invite/revoke'), null);
});

test('family list reconciles legacy kind into the HomeMew catalog before filtering', async () => {
  const calls = [];
  const response = await handleMiniProgramFamilyBff(request('/api/v1/miniprogram/families'), env(async incoming => {
    const path = new URL(incoming.url).pathname;
    calls.push(path);
    if (path === '/api/v1/me/spaces') return ok([
      { id: 'spc_home', kind: 'family', name: 'Home', timezone: 'Asia/Shanghai', avatarUrl: 'https://core/assets/spaces/spc_home/avatar', role: 'owner' },
      { id: 'spc_personal', kind: 'personal', name: 'Mine', timezone: 'UTC', avatarUrl: null, role: 'owner' },
    ]);
    if (path === '/api/v1/spaces/spc_home/members') return ok([{ userId: 'usr_1' }, { userId: 'usr_2' }]);
    return assert.fail(`unexpected Core path ${path}`);
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['/api/v1/me/spaces', '/api/v1/spaces/spc_home/members']);
  assert.deepEqual((await response.json()).data.items, [{
    id: 'spc_home', name: 'Home', timezone: 'Asia/Shanghai', role: 'admin', memberCount: 2,
    avatarUrl: 'https://homemew.example.test/api/v1/miniprogram/media/families/spc_home/avatar',
  }]);
});

test('family creation shadows the created Space into the HomeMew catalog during compatibility', async () => {
  let coreBody;
  const response = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families', { method: 'POST', body: { name: 'Home' } }),
    env(async incoming => {
      assert.equal(incoming.method, 'POST');
      coreBody = await incoming.json();
      return ok({ id: 'spc_home', kind: 'family', name: 'Home', timezone: 'Asia/Shanghai', avatarUrl: null, role: 'owner' }, 201);
    }, async incoming => {
      assert.equal(new URL(incoming.url).pathname, '/api/v1/me');
      return ok({ id: 'usr_owner', displayName: 'Owner', avatarUrl: null, status: 'active' });
    }),
  );
  assert.deepEqual(coreBody, { kind: 'family', name: 'Home', timezone: 'Asia/Shanghai', ownerDisplayName: 'Owner' });
  const result = (await response.json()).data;
  assert.equal(response.status, 201);
  assert.equal(result.role, 'admin');
  assert.equal(result.memberCount, 1);
  assert.match(result.createdAt, /^\d{4}-\d{2}-\d{2}T/u);
});

test('family detail composes Space, members and current Core principal', async () => {
  const response = await handleMiniProgramFamilyBff(request('/api/v1/miniprogram/families/spc_home'), env(async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path === '/api/v1/spaces/spc_home') return ok({
      id: 'spc_home', name: 'Home', timezone: 'Asia/Shanghai', avatarUrl: null, version: 7, access: { role: 'editor' },
    });
    if (path === '/api/v1/spaces/spc_home/members') return ok([
      { userId: 'usr_owner', role: 'owner', displayName: 'Owner', createdAt: '2026-01-01T00:00:00Z' },
      { userId: 'usr_me', role: 'editor', displayName: 'Me', createdAt: '2026-01-02T00:00:00Z' },
    ]);
    if (path === '/api/v1/me') return ok({ principal: { id: 'usr_me' } });
    return assert.fail(`unexpected ${path}`);
  }));
  assert.deepEqual((await response.json()).data, {
    id: 'spc_home', name: 'Home', avatarUrl: null, timezone: 'Asia/Shanghai', status: 'active',
    createdBy: 'usr_owner', currentUserRole: 'member', isOwner: false, version: 7, memberCount: 2, createdAt: '2026-01-01T00:00:00Z',
  });
});

test('family update and close fetch current Space version inside the BFF', async () => {
  const bodies = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (incoming.method === 'GET') return ok({ id: 'spc_home', name: 'Old', timezone: 'UTC', avatarUrl: null, version: 7 });
    bodies.push({ path, body: await incoming.json() });
    if (incoming.method === 'PATCH') return ok({ id: 'spc_home', name: 'New', timezone: 'UTC', avatarUrl: null, version: 8 });
    return new Response(null, { status: 204 });
  };
  const updated = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home', { method: 'PATCH', body: { name: 'New' } }), env(core),
  );
  assert.equal((await updated.json()).data.name, 'New');
  const closed = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/close', { method: 'POST', body: {} }), env(core),
  );
  assert.equal(closed.status, 204);
  assert.deepEqual(bodies, [
    { path: '/api/v1/spaces/spc_home', body: { name: 'New', version: 7 } },
    { path: '/api/v1/spaces/spc_home/close', body: { version: 7 } },
  ]);
});

test('member list and role update map product roles and hide Person/version fields', async () => {
  const calls = [];
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    calls.push({ method: incoming.method, path });
    if (incoming.method === 'GET') return ok([{
      userId: 'usr_mew', displayName: 'Mew', role: 'editor', version: 4, personId: 'per_hidden', createdAt: '2026-01-01T00:00:00Z',
    }]);
    assert.deepEqual(await incoming.json(), { role: 'admin', version: 4 });
    return ok({ userId: 'usr_mew', role: 'admin', version: 5 });
  };
  const listed = await handleMiniProgramFamilyBff(request('/api/v1/miniprogram/families/spc_home/members'), env(core));
  assert.deepEqual((await listed.json()).data.items, [{
    userId: 'usr_mew', displayName: 'Mew', role: 'member', joinedAt: '2026-01-01T00:00:00Z',
    avatarUrl: 'https://homemew.example.test/api/v1/miniprogram/media/users/usr_mew/avatar',
  }]);
  const updated = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/members/usr_mew', { method: 'PATCH', body: { role: 'admin' } }), env(core),
  );
  assert.deepEqual((await updated.json()).data, { userId: 'usr_mew', role: 'admin' });
  assert.equal(calls.at(-1).path, '/api/v1/spaces/spc_home/members/usr_mew');
});

test('leave and member removal forward only their fixed Core operations', async () => {
  const calls = [];
  const core = async incoming => {
    calls.push({ method: incoming.method, path: new URL(incoming.url).pathname });
    return new Response(null, { status: 204 });
  };
  const left = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/leave', { method: 'POST' }), env(core),
  );
  const removed = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/members/usr_mew', { method: 'DELETE' }), env(core),
  );
  assert.equal(left.status, 204);
  assert.equal(removed.status, 204);
  assert.deepEqual(calls, [
    { method: 'POST', path: '/api/v1/spaces/spc_home/leave' },
    { method: 'DELETE', path: '/api/v1/spaces/spc_home/members/usr_mew' },
  ]);
});

test('invitation create/list/revoke use fixed editor invites and product DTOs', async () => {
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    if (path.endsWith('/revoke')) return new Response(null, { status: 204 });
    if (incoming.method === 'POST') {
      assert.deepEqual(await incoming.json(), { role: 'editor', maxUses: 2 });
      return ok({ id: 'inv_1', token: 'LS-ABCD-EFGH-JKLM-NPQR', expiresAt: '2026-09-17T00:00:00Z', maxUses: 2, usedCount: 0 }, 201);
    }
    return ok([{ id: 'inv_1', status: 'active', expiresAt: '2026-09-17T00:00:00Z', maxUses: 2, usedCount: 0, createdByUserId: 'usr_owner', createdAt: '2026-09-16T00:00:00Z' }]);
  };
  const created = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/invites', { method: 'POST', body: { maxUses: 2 } }), env(core),
  );
  assert.equal((await created.json()).data.joinPath, '/pages/family/join?code=LS-ABCD-EFGH-JKLM-NPQR');
  const listed = await handleMiniProgramFamilyBff(request('/api/v1/miniprogram/families/spc_home/invites'), env(core));
  assert.equal((await listed.json()).data.items[0].createdBy, 'usr_owner');
  const revoked = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/invites/inv_1/revoke', { method: 'POST' }), env(core),
  );
  assert.equal(revoked.status, 204);
});

test('invite preview/join map code and obtain display name from Identity only for join', async () => {
  let joinBody;
  const core = async incoming => {
    const path = new URL(incoming.url).pathname;
    const body = await incoming.json();
    if (path.endsWith('/preview')) {
      assert.deepEqual(body, { token: 'LS-CODE' });
      return ok({ space: { id: 'spc_home', kind: 'family', name: 'Home', memberCount: 2 }, expiresAt: '2026-09-17T00:00:00Z', canJoin: true });
    }
    joinBody = body;
    return ok({ spaceId: 'spc_home', role: 'editor', joinedAt: '2026-09-16T01:00:00Z' }, 201);
  };
  const identity = async () => ok({ id: 'usr_me', displayName: 'Me', avatarUrl: null, status: 'active' });
  const preview = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/family-invites/preview', { method: 'POST', body: { code: 'LS-CODE' } }), env(core, identity),
  );
  assert.deepEqual((await preview.json()).data.family, { id: 'spc_home', name: 'Home', avatarUrl: null, memberCount: 2 });
  const joined = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/family-invites/join', { method: 'POST', body: { code: 'LS-CODE' } }), env(core, identity),
  );
  assert.deepEqual(joinBody, { token: 'LS-CODE', displayName: 'Me' });
  assert.deepEqual((await joined.json()).data, {
    familyId: 'spc_home', familyName: 'Home', role: 'member', joinedAt: '2026-09-16T01:00:00Z',
  });
});

test('invite preview rejects a non-HomeMew Space even when LifeSpace invite is otherwise valid', async () => {
  const response = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/family-invites/preview', { method: 'POST', body: { code: 'LS-OTHER' } }),
    env(async incoming => {
      assert.equal(new URL(incoming.url).pathname, '/api/v1/space-invites/preview');
      return ok({
        space: { id: 'spc_other', kind: 'personal', name: 'Other', memberCount: 1 },
        expiresAt: '2026-09-17T00:00:00Z',
        canJoin: true,
      });
    }),
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'NOT_HOMEMEW_FAMILY_INVITE');
});

test('family routes reject arbitrary fields, query parameters and invalid product roles', async () => {
  const arbitrary = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families', { method: 'POST', body: { name: 'Home', upstream: 'evil' } }), env(async () => assert.fail()),
  );
  const query = await handleMiniProgramFamilyBff(request('/api/v1/miniprogram/families?modelKey=task'), env(async () => assert.fail()));
  const role = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/members/usr_mew', { method: 'PATCH', body: { role: 'owner' } }), env(async () => assert.fail()),
  );
  assert.equal(arbitrary.status, 400);
  assert.equal(query.status, 400);
  assert.equal(role.status, 422);
});

test('LifeSpace authorization errors are preserved without remapping', async () => {
  const response = await handleMiniProgramFamilyBff(
    request('/api/v1/miniprogram/families/spc_home/members'),
    env(async () => new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'Insufficient Space role' },
    }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_forbidden' },
    })),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-request-id'), 'req_forbidden');
  assert.deepEqual(await response.json(), {
    error: { code: 'FORBIDDEN', message: 'Insufficient Space role' },
  });
});
