import { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const USER_ID = /^usr_[A-Za-z0-9_-]+$/u;
const INVITE_ID = /^inv_[A-Za-z0-9_-]+$/u;

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramFamilyRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/families`) return { kind: 'families' };
  if (pathname === `${MINI_PREFIX}/family-invites/preview`) return { kind: 'invite-preview' };
  if (pathname === `${MINI_PREFIX}/family-invites/join`) return { kind: 'invite-join' };

  let match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    return familyId ? { kind: 'family', familyId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/(close|leave|members|invites)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    return familyId ? { kind: match[2], familyId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/members/([^/]+)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const userId = decodeId(match[2], USER_ID);
    return familyId && userId ? { kind: 'member', familyId, userId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/invites/([^/]+)/revoke$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const inviteId = decodeId(match[2], INVITE_ID);
    return familyId && inviteId ? { kind: 'invite-revoke', familyId, inviteId } : null;
  }
  return null;
}

function derivedRequest(request, method, data) {
  const headers = new Headers();
  for (const name of ['authorization', 'x-request-id', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let body;
  if (data !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(data);
  }
  return new Request(request.url, { method, headers, ...(body ? { body } : {}) });
}

async function callJson(request, env, target, path, { method = 'GET', data } = {}) {
  const response = await forwardLifeSpace(derivedRequest(request, method, data), env, {
    target,
    upstreamPath: path,
  });
  if (!response.ok) return { ok: false, response };
  try {
    const envelope = await response.json();
    if (!envelope || typeof envelope !== 'object' || !Object.hasOwn(envelope, 'data')) throw new Error('missing data');
    return {
      ok: true,
      data: envelope.data,
      status: response.status,
      requestId: response.headers.get('x-request-id') || request.headers.get('x-request-id') || '',
    };
  } catch {
    return {
      ok: false,
      response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid response'),
    };
  }
}

async function readBody(request, allowed) {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('unsupported field');
    return { ok: true, data: value };
  } catch {
    return { ok: false, response: errorResponse(400, 'INVALID_REQUEST', 'Request body is invalid') };
  }
}

function familyRole(role) {
  return role === 'owner' || role === 'admin' ? 'admin' : 'member';
}

function coreRole(role) {
  return role === 'admin' ? 'admin' : 'editor';
}

function familyAvatarUrl(request, familyId, upstreamAvatarUrl) {
  if (!upstreamAvatarUrl) return null;
  return new URL(`${MINI_PREFIX}/media/families/${encodeURIComponent(familyId)}/avatar`, request.url).toString();
}

function userAvatarUrl(request, userId) {
  return new URL(`${MINI_PREFIX}/media/users/${encodeURIComponent(userId)}/avatar`, request.url).toString();
}

function familyListItem(request, space, memberCount) {
  return {
    id: space.id,
    name: space.name,
    avatarUrl: familyAvatarUrl(request, space.id, space.avatarUrl),
    timezone: space.timezone,
    role: familyRole(space.role),
    memberCount,
  };
}

function familyMember(request, member) {
  return {
    userId: member.userId,
    displayName: member.displayName,
    avatarUrl: userAvatarUrl(request, member.userId),
    role: familyRole(member.role),
    joinedAt: member.createdAt ?? '',
  };
}

async function listFamilies(request, env) {
  const spaces = await callJson(request, env, 'core', '/api/v1/me/spaces');
  if (!spaces.ok) return spaces.response;
  const families = Array.isArray(spaces.data) ? spaces.data.filter(space => space?.kind === 'family') : [];
  const results = await Promise.all(families.map(async space => {
    const members = await callJson(request, env, 'core', `/api/v1/spaces/${encodeURIComponent(space.id)}/members`);
    return { space, members };
  }));
  const failed = results.find(result => !result.members.ok);
  if (failed) return failed.members.response;
  return json({ data: { items: results.map(({ space, members }) => familyListItem(request, space, members.data.length)) } }, 200, spaces.requestId);
}

async function createFamily(request, env) {
  const input = await readBody(request, ['name', 'timezone']);
  if (!input.ok) return input.response;
  const me = await callJson(request, env, 'identity', '/api/v1/me');
  if (!me.ok) return me.response;
  const created = await callJson(request, env, 'core', '/api/v1/spaces', {
    method: 'POST',
    data: {
      kind: 'family',
      name: input.data.name,
      timezone: input.data.timezone ?? 'Asia/Shanghai',
      ownerDisplayName: me.data.displayName,
    },
  });
  if (!created.ok) return created.response;
  return json({ data: {
    ...familyListItem(request, created.data, 1),
    createdAt: new Date().toISOString(),
  } }, created.status, created.requestId);
}

async function getFamily(request, env, familyId) {
  const encoded = encodeURIComponent(familyId);
  const [space, members, me] = await Promise.all([
    callJson(request, env, 'core', `/api/v1/spaces/${encoded}`),
    callJson(request, env, 'core', `/api/v1/spaces/${encoded}/members`),
    callJson(request, env, 'core', '/api/v1/me'),
  ]);
  for (const result of [space, members, me]) if (!result.ok) return result.response;
  const list = members.data;
  const mine = list.find(member => member.userId === me.data.principal.id);
  const owner = list.find(member => member.role === 'owner');
  return json({ data: {
    id: space.data.id,
    name: space.data.name,
    avatarUrl: familyAvatarUrl(request, space.data.id, space.data.avatarUrl),
    timezone: space.data.timezone,
    status: 'active',
    createdBy: owner?.userId ?? '',
    currentUserRole: familyRole(mine?.role ?? space.data.access?.role),
    memberCount: list.length,
    createdAt: owner?.createdAt ?? '',
  } }, 200, space.requestId);
}

async function updateFamily(request, env, familyId) {
  const input = await readBody(request, ['name', 'timezone']);
  if (!input.ok) return input.response;
  const path = `/api/v1/spaces/${encodeURIComponent(familyId)}`;
  const current = await callJson(request, env, 'core', path);
  if (!current.ok) return current.response;
  const updated = await callJson(request, env, 'core', path, {
    method: 'PATCH', data: { ...input.data, version: current.data.version },
  });
  if (!updated.ok) return updated.response;
  return json({ data: {
    id: updated.data.id,
    name: updated.data.name,
    avatarUrl: familyAvatarUrl(request, updated.data.id, updated.data.avatarUrl),
    timezone: updated.data.timezone,
    status: 'active',
  } }, 200, updated.requestId);
}

async function closeFamily(request, env, familyId) {
  const path = `/api/v1/spaces/${encodeURIComponent(familyId)}`;
  const current = await callJson(request, env, 'core', path);
  if (!current.ok) return current.response;
  return forwardLifeSpace(derivedRequest(request, 'POST', { version: current.data.version }), env, {
    target: 'core', upstreamPath: `${path}/close`,
  });
}

async function listMembers(request, env, familyId) {
  const result = await callJson(request, env, 'core', `/api/v1/spaces/${encodeURIComponent(familyId)}/members`);
  if (!result.ok) return result.response;
  return json({ data: { items: result.data.map(member => familyMember(request, member)) } }, 200, result.requestId);
}

async function updateMember(request, env, familyId, userId) {
  const input = await readBody(request, ['role']);
  if (!input.ok) return input.response;
  if (input.data.role !== 'admin' && input.data.role !== 'member') {
    return errorResponse(422, 'VALIDATION_ERROR', 'role must be admin or member');
  }
  const base = `/api/v1/spaces/${encodeURIComponent(familyId)}/members`;
  const members = await callJson(request, env, 'core', base);
  if (!members.ok) return members.response;
  const member = members.data.find(item => item.userId === userId);
  if (!member) return errorResponse(404, 'MEMBER_NOT_FOUND', 'Family member not found');
  const updated = await callJson(request, env, 'core', `${base}/${encodeURIComponent(userId)}`, {
    method: 'PATCH', data: { role: coreRole(input.data.role), version: member.version },
  });
  if (!updated.ok) return updated.response;
  return json({ data: { userId: updated.data.userId, role: familyRole(updated.data.role) } }, 200, updated.requestId);
}

async function createInvite(request, env, familyId) {
  const input = await readBody(request, ['expiresInMinutes', 'maxUses']);
  if (!input.ok) return input.response;
  const result = await callJson(request, env, 'core', `/api/v1/spaces/${encodeURIComponent(familyId)}/invites`, {
    method: 'POST', data: { role: 'editor', ...input.data },
  });
  if (!result.ok) return result.response;
  const invite = result.data;
  return json({ data: {
    id: invite.id,
    code: invite.token ?? '',
    joinPath: `/pages/family/join?code=${encodeURIComponent(invite.token ?? '')}`,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
  } }, result.status, result.requestId);
}

async function listInvites(request, env, familyId) {
  const result = await callJson(request, env, 'core', `/api/v1/spaces/${encodeURIComponent(familyId)}/invites`);
  if (!result.ok) return result.response;
  return json({ data: { items: result.data.map(invite => ({
    id: invite.id,
    status: invite.status,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    createdBy: invite.createdByUserId ?? '',
    createdAt: invite.createdAt,
  })) } }, 200, result.requestId);
}

async function inviteAction(request, env, kind) {
  const input = await readBody(request, ['code']);
  if (!input.ok) return input.response;
  if (typeof input.data.code !== 'string' || !input.data.code.trim() || input.data.code.length > 200) {
    return errorResponse(422, 'VALIDATION_ERROR', 'code is invalid');
  }
  if (kind === 'invite-preview') {
    const result = await callJson(request, env, 'core', '/api/v1/space-invites/preview', {
      method: 'POST', data: { token: input.data.code.trim() },
    });
    if (!result.ok) return result.response;
    return json({ data: {
      family: {
        id: result.data.space.id,
        name: result.data.space.name,
        avatarUrl: familyAvatarUrl(request, result.data.space.id, result.data.space.avatarUrl),
        memberCount: result.data.space.memberCount,
      },
      expiresAt: result.data.expiresAt,
      canJoin: result.data.canJoin,
    } }, 200, result.requestId);
  }
  const me = await callJson(request, env, 'identity', '/api/v1/me');
  if (!me.ok) return me.response;
  const result = await callJson(request, env, 'core', '/api/v1/space-invites/join', {
    method: 'POST', data: { token: input.data.code.trim(), displayName: me.data.displayName },
  });
  if (!result.ok) return result.response;
  return json({ data: {
    familyId: result.data.spaceId,
    familyName: '',
    role: 'member',
    joinedAt: result.data.joinedAt ?? new Date().toISOString(),
  } }, result.status, result.requestId);
}

export async function handleMiniProgramFamilyBff(request, env) {
  const url = new URL(request.url);
  const route = matchMiniProgramFamilyRoute(url.pathname);
  if (!route) return null;
  if ([...url.searchParams.keys()].length > 0) return errorResponse(400, 'INVALID_QUERY', 'Query parameters are not supported');

  if (route.kind === 'families') {
    if (request.method === 'GET') return listFamilies(request, env);
    if (request.method === 'POST') return createFamily(request, env);
  }
  if (route.kind === 'family') {
    if (request.method === 'GET') return getFamily(request, env, route.familyId);
    if (request.method === 'PATCH') return updateFamily(request, env, route.familyId);
  }
  if (route.kind === 'close' && request.method === 'POST') return closeFamily(request, env, route.familyId);
  if (route.kind === 'leave' && request.method === 'POST') {
    return forwardLifeSpace(derivedRequest(request, 'POST'), env, {
      target: 'core', upstreamPath: `/api/v1/spaces/${encodeURIComponent(route.familyId)}/leave`,
    });
  }
  if (route.kind === 'members' && request.method === 'GET') return listMembers(request, env, route.familyId);
  if (route.kind === 'member') {
    if (request.method === 'PATCH') return updateMember(request, env, route.familyId, route.userId);
    if (request.method === 'DELETE') {
      return forwardLifeSpace(derivedRequest(request, 'DELETE'), env, {
        target: 'core',
        upstreamPath: `/api/v1/spaces/${encodeURIComponent(route.familyId)}/members/${encodeURIComponent(route.userId)}`,
      });
    }
  }
  if (route.kind === 'invites') {
    if (request.method === 'GET') return listInvites(request, env, route.familyId);
    if (request.method === 'POST') return createInvite(request, env, route.familyId);
  }
  if (route.kind === 'invite-revoke' && request.method === 'POST') {
    return forwardLifeSpace(derivedRequest(request, 'POST'), env, {
      target: 'core',
      upstreamPath: `/api/v1/spaces/${encodeURIComponent(route.familyId)}/invites/${encodeURIComponent(route.inviteId)}/revoke`,
    });
  }
  if ((route.kind === 'invite-preview' || route.kind === 'invite-join') && request.method === 'POST') {
    return inviteAction(request, env, route.kind);
  }
  return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for Mini Program family route');
}
