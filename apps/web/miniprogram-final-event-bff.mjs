import { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';
import { adaptEventWritePayload, eventLocationName, eventLocationWireFormat } from './event-location-compat.mjs';

const ROUTE = /^\/api\/v1\/miniprogram\/families\/([^/]+)\/events(?:\/([^/]+))?$/u;
const SPACE_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const LIST_KEYS = new Set(['startDate', 'endDateExclusive', 'timezone', 'attendeeId', 'status', 'q', 'cursor', 'limit']);
const WRITE_FIELDS = ['presentation', 'summary', 'description', 'location', 'attendeeIds', 'isAllDay', 'startAt', 'endAt', 'startTimezone', 'endTimezone', 'startDate', 'endDateExclusive'];
const TIME_FIELDS = ['isAllDay', 'startAt', 'endAt', 'startTimezone', 'endTimezone', 'startDate', 'endDateExclusive'];

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch { return null; }
}

export function matchMiniProgramFinalEventRoute(pathname) {
  const match = ROUTE.exec(pathname);
  if (!match) return null;
  const familyId = decodeId(match[1], SPACE_ID);
  const recordId = match[2] ? decodeId(match[2], RECORD_ID) : null;
  return familyId && (!match[2] || recordId) ? { familyId, recordId } : null;
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
    if (!envelope || typeof envelope !== 'object' || !Object.hasOwn(envelope, 'data')) throw new Error();
    return {
      ok: true, data: envelope.data, status: response.status,
      requestId: response.headers.get('x-request-id') || request.headers.get('x-request-id') || '',
    };
  } catch {
    return { ok: false, response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid Event response') };
  }
}

function collection(familyId) {
  return `/api/v1/spaces/${encodeURIComponent(familyId)}/models/event/records`;
}

function recordPath(familyId, recordId) {
  return `${collection(familyId)}/${encodeURIComponent(recordId)}`;
}

function validDate(value) {
  if (!DATE.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validTimezone(value) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; }
}

function parseList(url) {
  for (const key of url.searchParams.keys()) {
    if (!LIST_KEYS.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  }
  const startDate = url.searchParams.get('startDate');
  const endDateExclusive = url.searchParams.get('endDateExclusive');
  const timezone = url.searchParams.get('timezone');
  const attendeeId = url.searchParams.get('attendeeId');
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');
  const cursor = url.searchParams.get('cursor');
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 100;
  if (!validDate(startDate) || !validDate(endDateExclusive) || startDate >= endDateExclusive || !validTimezone(timezone)) return null;
  if (attendeeId !== null && !USER_ID.test(attendeeId)) return null;
  if (status !== null && status !== 'active' && status !== 'cancelled') return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (q !== null && q.length > 500) || (cursor !== null && (!cursor || cursor.length > 4096))) return null;
  return { startDate, endDateExclusive, timezone, attendeeId, status, q, cursor, limit };
}

async function members(request, env, familyId) {
  const result = await callJson(request, env, `/api/v1/spaces/${encodeURIComponent(familyId)}/members`);
  if (!result.ok) return result;
  return Array.isArray(result.data)
    ? result
    : { ok: false, response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned invalid members') };
}

async function resolveUser(request, env, list, userId) {
  if (!USER_ID.test(userId)) return { ok: false, response: errorResponse(422, 'VALIDATION_ERROR', 'attendee user is invalid') };
  let effective = userId;
  if (effective === 'me') {
    const me = await callJson(request, env, '/api/v1/me');
    if (!me.ok) return me;
    effective = me.data?.principal?.id;
  }
  const member = list.find(item => item.userId === effective);
  return member?.personId
    ? { ok: true, data: member.personId }
    : { ok: false, response: errorResponse(422, 'MEMBER_NOT_FOUND', 'Selected family member is unavailable') };
}

async function resolveUsers(request, env, list, userIds) {
  if (!Array.isArray(userIds) || userIds.some(value => typeof value !== 'string') || new Set(userIds).size !== userIds.length) {
    return { ok: false, response: errorResponse(422, 'VALIDATION_ERROR', 'attendeeIds is invalid') };
  }
  const output = [];
  for (const userId of userIds) {
    const result = await resolveUser(request, env, list, userId);
    if (!result.ok) return result;
    output.push(result.data);
  }
  return { ok: true, data: output };
}

function actor(raw) {
  return {
    type: raw?.type === 'user' ? 'user' : 'system',
    id: raw?.id ?? '', name: raw?.displayName ?? raw?.id ?? '', avatarUrl: null,
  };
}

export function eventDto(request, raw, list) {
  const common = {
    id: raw.id, familyId: raw.spaceId, summary: raw.summary,
    ...(raw.presentation?.icon ? { presentation: raw.presentation } : {}),
    description: raw.description ?? null, location: eventLocationName(raw.location), status: raw.status,
    attendees: (raw.attendeePersonIds ?? []).map(personId => list.find(item => item.personId === personId))
      .filter(Boolean).map(member => ({
        userId: member.userId, displayName: member.displayName,
        avatarUrl: new URL(`/api/v1/miniprogram/media/users/${encodeURIComponent(member.userId)}/avatar`, request.url).toString(),
      })),
    createdBy: actor(raw.createdBy), updatedBy: actor(raw.updatedBy), version: raw.version,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt,
  };
  if (raw.when?.kind === 'date') return {
    ...common, isAllDay: true,
    startDate: raw.when.start,
    endDateExclusive: raw.when.endExclusive,
  };
  if (raw.when?.kind === 'instant') return {
    ...common, isAllDay: false,
    startAt: raw.when.start,
    endAt: raw.when.endExclusive,
    startTimezone: null,
    endTimezone: null,
  };
  throw new Error('invalid temporal representation');
}

function temporalRange(input) {
  if (input.isAllDay === true && validDate(input.startDate) && validDate(input.endDateExclusive) && input.startDate < input.endDateExclusive) {
    return { kind: 'date', start: input.startDate, endExclusive: input.endDateExclusive };
  }
  if (input.isAllDay === false && RFC3339.test(input.startAt ?? '') && RFC3339.test(input.endAt ?? '') && Date.parse(input.startAt) < Date.parse(input.endAt)) {
    return { kind: 'instant', start: new Date(input.startAt).toISOString(), endExclusive: new Date(input.endAt).toISOString() };
  }
  return null;
}

function stableTemporal(raw) {
  if (raw.when?.kind === 'date') {
    return { isAllDay: true, startDate: raw.when.start, endDateExclusive: raw.when.endExclusive };
  }
  if (raw.when?.kind === 'instant') {
    return {
      isAllDay: false,
      startAt: raw.when.start,
      endAt: raw.when.endExclusive,
      startTimezone: null,
      endTimezone: null,
    };
  }
  return null;
}

async function listEvents(request, env, route, url) {
  const params = parseList(url);
  if (!params) return errorResponse(400, 'INVALID_QUERY', 'Event query parameters are invalid');
  const memberResult = await members(request, env, route.familyId);
  if (!memberResult.ok) return memberResult.response;
  let attendeePersonId;
  if (params.attendeeId) {
    const resolved = await resolveUser(request, env, memberResult.data, params.attendeeId);
    if (!resolved.ok) return resolved.response;
    attendeePersonId = resolved.data;
  }
  const filters = [{ field: 'when', op: 'overlaps', value: {
    kind: 'local_date_window', startDate: params.startDate,
    endDateExclusive: params.endDateExclusive, timezone: params.timezone,
  } }];
  if (attendeePersonId) filters.push({ field: 'attendeePersonIds', op: 'contains', value: attendeePersonId });
  if (params.status) filters.push({ field: 'status', op: 'eq', value: params.status });
  const result = await callJson(request, env, `${collection(route.familyId)}/query`, { method: 'POST', data: {
    ...(params.q ? { search: { text: params.q } } : {}),
    filter: filters.length === 1 ? filters[0] : { and: filters },
    sort: [{ field: 'when', direction: 'asc' }],
    page: { limit: params.limit, ...(params.cursor ? { cursor: params.cursor } : {}) },
    context: { viewingTimezone: params.timezone },
  } });
  if (!result.ok) return result.response;
  if (!Array.isArray(result.data?.items)) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid Event page');
  try {
    return json({ data: {
      items: result.data.items.map(item => eventDto(request, item, memberResult.data)),
      nextCursor: result.data.nextCursor ?? null,
    } }, 200, result.requestId);
  } catch { return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid Event resource'); }
}

async function readBody(request, allowed) {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) throw new Error();
    return { ok: true, data };
  } catch { return { ok: false, response: errorResponse(400, 'INVALID_REQUEST', 'Request body is invalid') }; }
}

async function writeEvent(request, env, route, method) {
  const input = await readBody(request, method === 'POST' ? WRITE_FIELDS : [...WRITE_FIELDS, 'version']);
  if (!input.ok) return input.response;
  if (method === 'POST' && (typeof input.data.summary !== 'string' || !input.data.summary.trim())) return errorResponse(422, 'VALIDATION_ERROR', 'summary is required');
  if (method === 'PATCH' && (!Number.isInteger(input.data.version) || input.data.version < 1 || !WRITE_FIELDS.some(key => Object.hasOwn(input.data, key)))) {
    return errorResponse(422, 'VALIDATION_ERROR', 'version and at least one update are required');
  }
  const memberResult = await members(request, env, route.familyId);
  if (!memberResult.ok) return memberResult.response;
  const data = { ...input.data };
  if (Object.hasOwn(data, 'attendeeIds')) {
    const resolved = await resolveUsers(request, env, memberResult.data, data.attendeeIds);
    if (!resolved.ok) return resolved.response;
    data.attendeePersonIds = resolved.data;
    delete data.attendeeIds;
  }
  // The reviewed Mini DTO accepts only a label, never an arbitrary canonical
  // object supplied by the browser/client. This preserves the product boundary.
  if (Object.hasOwn(data, 'location') && data.location !== null && typeof data.location !== 'string') {
    return errorResponse(422, 'VALIDATION_ERROR', 'Event Location must be text or null');
  }
  const touchedTime = TIME_FIELDS.some(key => Object.hasOwn(data, key));
  let currentEvent = null;
  if (method === 'POST' && !touchedTime) return errorResponse(422, 'VALIDATION_ERROR', 'Event time is required');
  if (touchedTime) {
    let complete = data;
    if (method === 'PATCH') {
      const current = await callJson(request, env, recordPath(route.familyId, route.recordId));
      if (!current.ok) return current.response;
      currentEvent = current.data;
      const currentTemporal = stableTemporal(currentEvent);
      if (!currentTemporal) {
        return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid Event temporal range');
      }
      complete = { ...currentTemporal, ...data };
    }
    const when = temporalRange(complete);
    if (!when) return errorResponse(422, 'VALIDATION_ERROR', 'Event time range is invalid');
    for (const key of TIME_FIELDS) delete data[key];
    data.when = when;
  }
  // An older Mini client submits the displayed location label again when the
  // user edits an unrelated field. Preserve richer canonical coordinates only
  // when the name is unchanged; otherwise treat this as an explicit relocation.
  if (method === 'PATCH' && Object.hasOwn(data, 'location') && eventLocationWireFormat(env) === 'location') {
    if (!currentEvent) {
      const existing = await callJson(request, env, recordPath(route.familyId, route.recordId));
      if (!existing.ok) return existing.response;
      currentEvent = existing.data;
    }
    try {
      const oldName = eventLocationName(currentEvent.location);
      const newName = data.location === null ? null : data.location.trim() || null;
      if (oldName && oldName === newName && currentEvent.location && typeof currentEvent.location === 'object') {
        data.location = currentEvent.location;
      }
    } catch {
      return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace Event Location is invalid');
    }
  }
  let adapted;
  try { adapted = adaptEventWritePayload(data, env); }
  catch { return errorResponse(422, 'VALIDATION_ERROR', 'Event Location is invalid for this LifeSpace release'); }
  const path = method === 'POST' ? collection(route.familyId) : recordPath(route.familyId, route.recordId);
  const result = await callJson(request, env, path, { method, data: adapted });
  if (!result.ok) return result.response;
  try { return json({ data: eventDto(request, result.data, memberResult.data) }, result.status, result.requestId); }
  catch { return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid Event resource'); }
}

export async function handleMiniProgramFinalEventBff(request, env) {
  const url = new URL(request.url);
  const route = matchMiniProgramFinalEventRoute(url.pathname);
  if (!route) return null;
  if (route.recordId) {
    if (url.search) return errorResponse(400, 'INVALID_QUERY', 'Query parameters are not supported for this Event operation');
    if (request.method === 'GET') {
      const [record, memberResult] = await Promise.all([
        callJson(request, env, recordPath(route.familyId, route.recordId)),
        members(request, env, route.familyId),
      ]);
      if (!record.ok) return record.response;
      if (!memberResult.ok) return memberResult.response;
      try { return json({ data: eventDto(request, record.data, memberResult.data) }, 200, record.requestId); }
      catch { return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid Event resource'); }
    }
    if (request.method === 'PATCH') return writeEvent(request, env, route, 'PATCH');
    if (request.method === 'DELETE') {
      const input = await readBody(request, ['version']);
      if (!input.ok) return input.response;
      if (!Number.isInteger(input.data.version) || input.data.version < 1) return errorResponse(422, 'VALIDATION_ERROR', 'version is invalid');
      return forwardLifeSpace(derivedRequest(request, 'DELETE', input.data), env, {
        target: 'core', upstreamPath: recordPath(route.familyId, route.recordId),
      });
    }
  } else {
    if (request.method === 'GET') return listEvents(request, env, route, url);
    if (request.method === 'POST' && !url.search) return writeEvent(request, env, route, 'POST');
  }
  return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for Mini Program Event BFF');
}
