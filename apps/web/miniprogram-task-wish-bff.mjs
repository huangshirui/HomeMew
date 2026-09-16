import { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const TASK_SORTS = Object.freeze({
  due_asc: { field: 'dueDate', direction: 'asc' },
  due_desc: { field: 'dueDate', direction: 'desc' },
  created_desc: { field: 'createdAt', direction: 'desc' },
  updated_desc: { field: 'updatedAt', direction: 'desc' },
});

const WISH_SORTS = Object.freeze({
  default: { field: 'desiredDate', direction: 'asc' },
  desired_asc: { field: 'desiredDate', direction: 'asc' },
  created_desc: { field: 'createdAt', direction: 'desc' },
  updated_desc: { field: 'updatedAt', direction: 'desc' },
});

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramTaskWishRoute(pathname) {
  let match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/(tasks|wishes)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    return familyId ? { kind: match[2], familyId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/(tasks|wishes)/([^/]+)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const recordId = decodeId(match[3], RECORD_ID);
    const kind = match[2] === 'tasks' ? 'task' : 'wish';
    return familyId && recordId ? { kind, familyId, recordId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/(tasks|wishes)/([^/]+)/(complete|reopen|fulfill)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const recordId = decodeId(match[3], RECORD_ID);
    const model = match[2] === 'tasks' ? 'task' : 'wish';
    const valid = model === 'task' ? ['complete', 'reopen'] : ['fulfill', 'reopen'];
    return familyId && recordId && valid.includes(match[4])
      ? { kind: `${model}-action`, familyId, recordId, action: match[4] }
      : null;
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

async function callJson(request, env, path, { method = 'GET', data } = {}) {
  const response = await forwardLifeSpace(derivedRequest(request, method, data), env, {
    target: 'core', upstreamPath: path,
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

function modelCollection(familyId, model) {
  return `/api/v1/spaces/${encodeURIComponent(familyId)}/models/${model}/records`;
}

function modelRecord(familyId, model, recordId) {
  return `${modelCollection(familyId, model)}/${encodeURIComponent(recordId)}`;
}

function andFilters(filters) {
  const present = filters.filter(Boolean);
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : { and: present };
}

function parseSingleParams(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) {
      return { ok: false, response: errorResponse(400, 'INVALID_QUERY', 'Query parameters are invalid') };
    }
  }
  return { ok: true };
}

function parsePage(url) {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, response: errorResponse(400, 'INVALID_QUERY', 'limit must be an integer between 1 and 100') };
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (!cursor || cursor.length > 4096)) {
    return { ok: false, response: errorResponse(400, 'INVALID_QUERY', 'cursor is invalid') };
  }
  return { ok: true, page: { limit, cursor } };
}

function parseDate(value, name) {
  if (value === null) return { ok: true, value: undefined };
  return DATE.test(value)
    ? { ok: true, value }
    : { ok: false, response: errorResponse(400, 'INVALID_QUERY', `${name} must be YYYY-MM-DD`) };
}

async function members(request, env, familyId) {
  const result = await callJson(request, env, `/api/v1/spaces/${encodeURIComponent(familyId)}/members`);
  if (!result.ok) return result;
  if (!Array.isArray(result.data)) {
    return { ok: false, response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned invalid members') };
  }
  return result;
}

async function currentUserId(request, env) {
  const result = await callJson(request, env, '/api/v1/me');
  if (!result.ok) return result;
  const id = result.data?.principal?.id;
  return typeof id === 'string'
    ? { ...result, data: id }
    : { ok: false, response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid principal') };
}

async function resolveUserIds(request, env, list, userIds) {
  if (!Array.isArray(userIds) || userIds.some(id => typeof id !== 'string' || !USER_ID.test(id))) {
    return { ok: false, response: errorResponse(422, 'VALIDATION_ERROR', 'member IDs are invalid') };
  }
  let me = null;
  if (userIds.includes('me')) {
    const result = await currentUserId(request, env);
    if (!result.ok) return result;
    me = result.data;
  }
  const personIds = [];
  for (const userId of userIds) {
    const effective = userId === 'me' ? me : userId;
    const member = list.find(item => item.userId === effective);
    if (!member || typeof member.personId !== 'string') {
      return { ok: false, response: errorResponse(422, 'MEMBER_NOT_FOUND', 'Selected family member is unavailable') };
    }
    personIds.push(member.personId);
  }
  return { ok: true, data: [...new Set(personIds)] };
}

function userAvatarUrl(request, userId) {
  return new URL(`${MINI_PREFIX}/media/users/${encodeURIComponent(userId)}/avatar`, request.url).toString();
}

function personRef(request, personId, list) {
  const member = list.find(item => item.personId === personId);
  return member ? {
    userId: member.userId,
    displayName: member.displayName,
    avatarUrl: userAvatarUrl(request, member.userId),
  } : null;
}

function actor(raw) {
  return {
    type: raw?.type === 'user' ? 'user' : 'system',
    id: raw?.id ?? '',
    name: raw?.displayName ?? raw?.id ?? '',
    avatarUrl: null,
  };
}

function taskDto(request, raw, list) {
  let completedBy = null;
  if (raw.completedByType && raw.completedById) {
    const member = raw.completedByType === 'user'
      ? list.find(item => item.userId === raw.completedById)
      : null;
    completedBy = {
      type: raw.completedByType === 'user' ? 'user' : 'system',
      id: raw.completedById,
      name: member?.displayName ?? raw.completedById,
      avatarUrl: null,
    };
  }
  return {
    id: raw.id,
    familyId: raw.spaceId,
    name: raw.name,
    description: raw.description ?? null,
    dueDate: raw.dueDate ?? null,
    status: raw.status,
    assignees: (raw.assigneePersonIds ?? []).map(id => personRef(request, id, list)).filter(Boolean),
    completedAt: raw.completedAt ?? null,
    completedBy,
    createdBy: actor(raw.createdBy),
    updatedBy: actor(raw.updatedBy),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function wishDto(request, raw, list) {
  return {
    id: raw.id,
    familyId: raw.spaceId,
    title: raw.title,
    description: raw.description ?? null,
    desiredDate: raw.desiredDate ?? null,
    status: raw.status,
    owner: personRef(request, raw.ownerPersonId, list) ?? {
      userId: '', displayName: '已离开成员', avatarUrl: null,
    },
    fulfilledAt: raw.fulfilledAt ?? null,
    createdBy: actor(raw.createdBy),
    updatedBy: actor(raw.updatedBy),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function validOptionalDate(value) {
  return value === undefined || value === null || (typeof value === 'string' && DATE.test(value));
}

function validVersion(value) {
  return Number.isInteger(value) && value >= 1;
}

async function listTasks(request, env, familyId, url) {
  const queryCheck = parseSingleParams(url, [
    'status', 'assigneeId', 'dueDateFrom', 'dueDateTo', 'includeNoDue', 'q', 'sort', 'cursor', 'limit',
  ]);
  if (!queryCheck.ok) return queryCheck.response;
  const page = parsePage(url);
  if (!page.ok) return page.response;
  const status = url.searchParams.get('status');
  if (status !== null && !['pending', 'completed'].includes(status)) {
    return errorResponse(400, 'INVALID_QUERY', 'status must be pending or completed');
  }
  const assigneeId = url.searchParams.get('assigneeId');
  if (assigneeId !== null && !USER_ID.test(assigneeId)) {
    return errorResponse(400, 'INVALID_QUERY', 'assigneeId is invalid');
  }
  const from = parseDate(url.searchParams.get('dueDateFrom'), 'dueDateFrom');
  if (!from.ok) return from.response;
  const to = parseDate(url.searchParams.get('dueDateTo'), 'dueDateTo');
  if (!to.ok) return to.response;
  const includeRaw = url.searchParams.get('includeNoDue');
  if (includeRaw !== null && !['true', 'false'].includes(includeRaw)) {
    return errorResponse(400, 'INVALID_QUERY', 'includeNoDue must be true or false');
  }
  const q = url.searchParams.get('q')?.trim();
  if (q !== undefined && (!q || q.length > 100)) return errorResponse(400, 'INVALID_QUERY', 'q must contain 1-100 characters');
  const sortName = url.searchParams.get('sort') ?? 'due_asc';
  if (!Object.hasOwn(TASK_SORTS, sortName)) return errorResponse(400, 'INVALID_QUERY', 'sort is invalid');

  const memberResult = await members(request, env, familyId);
  if (!memberResult.ok) return memberResult.response;
  let assigneePersonId;
  if (assigneeId !== null) {
    const resolved = await resolveUserIds(request, env, memberResult.data, [assigneeId]);
    if (!resolved.ok) return resolved.response;
    assigneePersonId = resolved.data[0];
  }
  const dueBounds = [
    from.value ? { field: 'dueDate', op: 'gte', value: from.value } : undefined,
    to.value ? { field: 'dueDate', op: 'lte', value: to.value } : undefined,
  ].filter(Boolean);
  const dueRange = andFilters(dueBounds);
  const dueFilter = includeRaw === 'true' && dueRange
    ? { or: [dueRange, { field: 'dueDate', op: 'isNull' }] }
    : dueRange;
  const filter = andFilters([
    status ? { field: 'status', op: 'eq', value: status } : undefined,
    assigneePersonId ? { field: 'assigneePersonIds', op: 'contains', value: assigneePersonId } : undefined,
    dueFilter,
  ]);
  const result = await callJson(request, env, `${modelCollection(familyId, 'task')}/query`, {
    method: 'POST',
    data: {
      ...(q ? { search: { text: q } } : {}),
      ...(filter ? { filter } : {}),
      sort: [TASK_SORTS[sortName]],
      page: page.page,
    },
  });
  if (!result.ok) return result.response;
  if (!Array.isArray(result.data?.items)) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid task page');
  return json({ data: {
    items: result.data.items.map(item => taskDto(request, item, memberResult.data)),
    nextCursor: result.data.nextCursor ?? null,
  } }, 200, result.requestId);
}

async function listWishes(request, env, familyId, url) {
  const queryCheck = parseSingleParams(url, [
    'status', 'ownerUserId', 'desiredFrom', 'desiredTo', 'sort', 'cursor', 'limit',
  ]);
  if (!queryCheck.ok) return queryCheck.response;
  const page = parsePage(url);
  if (!page.ok) return page.response;
  const status = url.searchParams.get('status');
  if (status !== null && !['open', 'fulfilled'].includes(status)) {
    return errorResponse(400, 'INVALID_QUERY', 'status must be open or fulfilled');
  }
  const ownerUserId = url.searchParams.get('ownerUserId');
  if (ownerUserId !== null && !USER_ID.test(ownerUserId)) {
    return errorResponse(400, 'INVALID_QUERY', 'ownerUserId is invalid');
  }
  const from = parseDate(url.searchParams.get('desiredFrom'), 'desiredFrom');
  if (!from.ok) return from.response;
  const to = parseDate(url.searchParams.get('desiredTo'), 'desiredTo');
  if (!to.ok) return to.response;
  const sortName = url.searchParams.get('sort') ?? 'default';
  if (!Object.hasOwn(WISH_SORTS, sortName)) return errorResponse(400, 'INVALID_QUERY', 'sort is invalid');

  const memberResult = await members(request, env, familyId);
  if (!memberResult.ok) return memberResult.response;
  let ownerPersonId;
  if (ownerUserId !== null) {
    const resolved = await resolveUserIds(request, env, memberResult.data, [ownerUserId]);
    if (!resolved.ok) return resolved.response;
    ownerPersonId = resolved.data[0];
  }
  const filter = andFilters([
    status ? { field: 'status', op: 'eq', value: status } : undefined,
    ownerPersonId ? { field: 'ownerPersonId', op: 'contains', value: ownerPersonId } : undefined,
    from.value ? { field: 'desiredDate', op: 'gte', value: from.value } : undefined,
    to.value ? { field: 'desiredDate', op: 'lte', value: to.value } : undefined,
  ]);
  const result = await callJson(request, env, `${modelCollection(familyId, 'wish')}/query`, {
    method: 'POST',
    data: {
      ...(filter ? { filter } : {}),
      sort: [WISH_SORTS[sortName]],
      page: page.page,
    },
  });
  if (!result.ok) return result.response;
  if (!Array.isArray(result.data?.items)) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid wish page');
  return json({ data: {
    items: result.data.items.map(item => wishDto(request, item, memberResult.data)),
    nextCursor: result.data.nextCursor ?? null,
  } }, 200, result.requestId);
}

async function getRecord(request, env, route, model) {
  const [record, memberResult] = await Promise.all([
    callJson(request, env, modelRecord(route.familyId, model, route.recordId)),
    members(request, env, route.familyId),
  ]);
  if (!record.ok) return record.response;
  if (!memberResult.ok) return memberResult.response;
  const dto = model === 'task'
    ? taskDto(request, record.data, memberResult.data)
    : wishDto(request, record.data, memberResult.data);
  return json({ data: dto }, 200, record.requestId);
}

async function createTask(request, env, familyId) {
  const input = await readBody(request, ['name', 'description', 'dueDate', 'assigneeIds']);
  if (!input.ok) return input.response;
  if (typeof input.data.name !== 'string' || !input.data.name.trim()
    || !validOptionalDate(input.data.dueDate)
    || (input.data.assigneeIds !== undefined && !Array.isArray(input.data.assigneeIds))) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Task payload is invalid');
  }
  const memberResult = await members(request, env, familyId);
  if (!memberResult.ok) return memberResult.response;
  const resolved = await resolveUserIds(request, env, memberResult.data, input.data.assigneeIds ?? []);
  if (!resolved.ok) return resolved.response;
  const result = await callJson(request, env, modelCollection(familyId, 'task'), {
    method: 'POST', data: {
      name: input.data.name,
      description: input.data.description ?? null,
      dueDate: input.data.dueDate ?? null,
      assigneePersonIds: resolved.data,
    },
  });
  if (!result.ok) return result.response;
  return json({ data: taskDto(request, result.data, memberResult.data) }, result.status, result.requestId);
}

async function updateTask(request, env, route) {
  const input = await readBody(request, ['name', 'description', 'dueDate', 'assigneeIds', 'version']);
  if (!input.ok) return input.response;
  const changed = ['name', 'description', 'dueDate', 'assigneeIds'].some(key => Object.hasOwn(input.data, key));
  if (!validVersion(input.data.version) || !changed || !validOptionalDate(input.data.dueDate)
    || (input.data.assigneeIds !== undefined && !Array.isArray(input.data.assigneeIds))) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Task update payload is invalid');
  }
  const memberResult = await members(request, env, route.familyId);
  if (!memberResult.ok) return memberResult.response;
  let assigneePersonIds;
  if (input.data.assigneeIds !== undefined) {
    const resolved = await resolveUserIds(request, env, memberResult.data, input.data.assigneeIds);
    if (!resolved.ok) return resolved.response;
    assigneePersonIds = resolved.data;
  }
  const data = { version: input.data.version };
  for (const key of ['name', 'description', 'dueDate']) {
    if (Object.hasOwn(input.data, key)) data[key] = input.data[key];
  }
  if (assigneePersonIds !== undefined) data.assigneePersonIds = assigneePersonIds;
  const result = await callJson(request, env, modelRecord(route.familyId, 'task', route.recordId), {
    method: 'PATCH', data,
  });
  if (!result.ok) return result.response;
  return json({ data: taskDto(request, result.data, memberResult.data) }, 200, result.requestId);
}

async function createWish(request, env, familyId) {
  const input = await readBody(request, ['title', 'description', 'desiredDate']);
  if (!input.ok) return input.response;
  if (typeof input.data.title !== 'string' || !input.data.title.trim() || !validOptionalDate(input.data.desiredDate)) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Wish payload is invalid');
  }
  const [memberResult, me] = await Promise.all([members(request, env, familyId), currentUserId(request, env)]);
  if (!memberResult.ok) return memberResult.response;
  if (!me.ok) return me.response;
  const owner = memberResult.data.find(item => item.userId === me.data);
  if (!owner?.personId) return errorResponse(422, 'MEMBER_NOT_FOUND', 'Current user is not an active family member');
  const result = await callJson(request, env, modelCollection(familyId, 'wish'), {
    method: 'POST', data: {
      title: input.data.title,
      description: input.data.description ?? null,
      desiredDate: input.data.desiredDate ?? null,
      ownerPersonId: owner.personId,
    },
  });
  if (!result.ok) return result.response;
  return json({ data: wishDto(request, result.data, memberResult.data) }, result.status, result.requestId);
}

async function updateWish(request, env, route) {
  const input = await readBody(request, ['title', 'description', 'desiredDate', 'version']);
  if (!input.ok) return input.response;
  const changed = ['title', 'description', 'desiredDate'].some(key => Object.hasOwn(input.data, key));
  if (!validVersion(input.data.version) || !changed || !validOptionalDate(input.data.desiredDate)) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Wish update payload is invalid');
  }
  const memberResult = await members(request, env, route.familyId);
  if (!memberResult.ok) return memberResult.response;
  const result = await callJson(request, env, modelRecord(route.familyId, 'wish', route.recordId), {
    method: 'PATCH', data: input.data,
  });
  if (!result.ok) return result.response;
  return json({ data: wishDto(request, result.data, memberResult.data) }, 200, result.requestId);
}

async function versionForward(request, env, route, model, suffix = '') {
  const input = await readBody(request, ['version']);
  if (!input.ok) return input.response;
  if (!validVersion(input.data.version)) return errorResponse(422, 'VALIDATION_ERROR', 'version is invalid');
  const path = `${modelRecord(route.familyId, model, route.recordId)}${suffix}`;
  if (request.method === 'DELETE') {
    return forwardLifeSpace(derivedRequest(request, 'DELETE', { version: input.data.version }), env, {
      target: 'core', upstreamPath: path,
    });
  }
  const [result, memberResult] = await Promise.all([
    callJson(request, env, path, { method: 'POST', data: { version: input.data.version } }),
    members(request, env, route.familyId),
  ]);
  if (!result.ok) return result.response;
  if (!memberResult.ok) return memberResult.response;
  const dto = model === 'task'
    ? taskDto(request, result.data, memberResult.data)
    : wishDto(request, result.data, memberResult.data);
  return json({ data: dto }, 200, result.requestId);
}

export async function handleMiniProgramTaskWishBff(request, env) {
  const url = new URL(request.url);
  const route = matchMiniProgramTaskWishRoute(url.pathname);
  if (!route) return null;

  const isList = route.kind === 'tasks' || route.kind === 'wishes';
  if (!isList && [...url.searchParams.keys()].length > 0) {
    return errorResponse(400, 'INVALID_QUERY', 'Query parameters are not supported');
  }
  if (route.kind === 'tasks') {
    if (request.method === 'GET') return listTasks(request, env, route.familyId, url);
    if (request.method === 'POST') return createTask(request, env, route.familyId);
  }
  if (route.kind === 'wishes') {
    if (request.method === 'GET') return listWishes(request, env, route.familyId, url);
    if (request.method === 'POST') return createWish(request, env, route.familyId);
  }
  if (route.kind === 'task') {
    if (request.method === 'GET') return getRecord(request, env, route, 'task');
    if (request.method === 'PATCH') return updateTask(request, env, route);
    if (request.method === 'DELETE') return versionForward(request, env, route, 'task');
  }
  if (route.kind === 'wish') {
    if (request.method === 'GET') return getRecord(request, env, route, 'wish');
    if (request.method === 'PATCH') return updateWish(request, env, route);
    if (request.method === 'DELETE') return versionForward(request, env, route, 'wish');
  }
  if (route.kind === 'task-action' && request.method === 'POST') {
    return versionForward(request, env, route, 'task', `/actions/${route.action}`);
  }
  if (route.kind === 'wish-action' && request.method === 'POST') {
    return versionForward(request, env, route, 'wish', `/actions/${route.action}`);
  }
  return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for Mini Program Task/Wish route');
}
