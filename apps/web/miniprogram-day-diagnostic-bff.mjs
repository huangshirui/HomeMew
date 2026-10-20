import { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_SORTS = Object.freeze({
  attention: 'attention:desc',
  date_asc: 'effectiveDate:asc',
  date_desc: 'effectiveDate:desc',
  created_desc: 'createdAt:desc',
  updated_desc: 'updatedAt:desc',
});

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramDayDiagnosticRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/diagnostics/lifespace-core`) return { kind: 'diagnostic' };
  let match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-records/icon-imageimport { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_SORTS = Object.freeze({
  attention: 'attention:desc',
  date_asc: 'effectiveDate:asc',
  date_desc: 'effectiveDate:desc',
  created_desc: 'createdAt:desc',
  updated_desc: 'updatedAt:desc',
});

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramDayDiagnosticRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/diagnostics/lifespace-core`) return { kind: 'diagnostic' };
, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    return familyId ? { kind: 'icon-upload', familyId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-recordsimport { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_SORTS = Object.freeze({
  attention: 'attention:desc',
  date_asc: 'effectiveDate:asc',
  date_desc: 'effectiveDate:desc',
  created_desc: 'createdAt:desc',
  updated_desc: 'updatedAt:desc',
});

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramDayDiagnosticRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/diagnostics/lifespace-core`) return { kind: 'diagnostic' };
, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    return familyId ? { kind: 'day-records', familyId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-records/([^/]+)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const recordId = decodeId(match[2], RECORD_ID);
    return familyId && recordId ? { kind: 'day-record', familyId, recordId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-records/([^/]+)/(icon-image)import { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_SORTS = Object.freeze({
  attention: 'attention:desc',
  date_asc: 'effectiveDate:asc',
  date_desc: 'effectiveDate:desc',
  created_desc: 'createdAt:desc',
  updated_desc: 'updatedAt:desc',
});

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramDayDiagnosticRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/diagnostics/lifespace-core`) return { kind: 'diagnostic' };
  let match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-records/icon-imageimport { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_SORTS = Object.freeze({
  attention: 'attention:desc',
  date_asc: 'effectiveDate:asc',
  date_desc: 'effectiveDate:desc',
  created_desc: 'createdAt:desc',
  updated_desc: 'updatedAt:desc',
});

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramDayDiagnosticRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/diagnostics/lifespace-core`) return { kind: 'diagnostic' };
, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    return familyId ? { kind: 'icon-upload', familyId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-recordsimport { errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';

const MINI_PREFIX = '/api/v1/miniprogram';
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const USER_ID = /^(?:me|usr_[A-Za-z0-9_-]+)$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_SORTS = Object.freeze({
  attention: 'attention:desc',
  date_asc: 'effectiveDate:asc',
  date_desc: 'effectiveDate:desc',
  created_desc: 'createdAt:desc',
  updated_desc: 'updatedAt:desc',
});

function decodeId(value, pattern) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function matchMiniProgramDayDiagnosticRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/diagnostics/lifespace-core`) return { kind: 'diagnostic' };
, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    return familyId ? { kind: 'day-records', familyId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-records/([^/]+)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const recordId = decodeId(match[2], RECORD_ID);
    return familyId && recordId ? { kind: 'day-record', familyId, recordId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-records/([^/]+), 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const recordId = decodeId(match[2], RECORD_ID);
    return familyId && recordId ? { kind: match[3], familyId, recordId } : null;
  }
  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/day-records/([^/]+)/(occurrences|archive|restore)$`, 'u').exec(pathname);
  if (match) {
    const familyId = decodeId(match[1], FAMILY_ID);
    const recordId = decodeId(match[2], RECORD_ID);
    return familyId && recordId ? { kind: match[3], familyId, recordId } : null;
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
    return { ok: false, response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid response') };
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

function modelCollection(familyId) {
  return `/api/v1/spaces/${encodeURIComponent(familyId)}/models/day_record/records`;
}

function modelRecord(familyId, recordId) {
  return `${modelCollection(familyId)}/${encodeURIComponent(recordId)}`;
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
  return { ok: true, limit, cursor };
}

async function members(request, env, familyId) {
  const result = await callJson(request, env, `/api/v1/spaces/${encodeURIComponent(familyId)}/members`);
  if (!result.ok) return result;
  return Array.isArray(result.data)
    ? result
    : { ok: false, response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned invalid members') };
}

async function currentUserId(request, env) {
  const result = await callJson(request, env, '/api/v1/me');
  if (!result.ok) return result;
  return typeof result.data?.principal?.id === 'string'
    ? { ...result, data: result.data.principal.id }
    : { ok: false, response: errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid principal') };
}

async function resolveUserId(request, env, list, userId) {
  if (userId === null) return { ok: true, data: null };
  if (typeof userId !== 'string' || !USER_ID.test(userId)) {
    return { ok: false, response: errorResponse(422, 'VALIDATION_ERROR', 'subjectUserId is invalid') };
  }
  let effective = userId;
  if (userId === 'me') {
    const me = await currentUserId(request, env);
    if (!me.ok) return me;
    effective = me.data;
  }
  const member = list.find(item => item.userId === effective);
  return member?.personId
    ? { ok: true, data: member.personId }
    : { ok: false, response: errorResponse(422, 'MEMBER_NOT_FOUND', 'Selected family member is unavailable') };
}

function userAvatarUrl(request, userId) {
  return new URL(`${MINI_PREFIX}/media/users/${encodeURIComponent(userId)}/avatar`, request.url).toString();
}

function personRef(request, personId, list) {
  if (!personId) return null;
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

function dayDto(request, raw, list) {
  const computed = raw.computed?.temporal;
  const common = {
    id: raw.id,
    familyId: raw.spaceId,
    name: raw.name,
    description: raw.description ?? null,
    subject: personRef(request, raw.subjectPersonId, list),
    ...(raw.presentation?.icon ? { presentation: raw.presentation } : {}),
    status: raw.status,
    version: raw.version,
    createdBy: actor(raw.createdBy),
    updatedBy: actor(raw.updatedBy),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (raw.kind === 'elapsed') return {
    ...common,
    kind: 'elapsed',
    anchorDate: raw.anchorDate,
    attentionAfterDays: raw.attentionAfterDays ?? null,
    computed,
  };
  if (raw.kind === 'countdown') return {
    ...common,
    kind: 'countdown',
    anchorDate: raw.anchorDate,
    attentionBeforeDays: raw.attentionBeforeDays ?? null,
    computed,
  };
  return {
    ...common,
    kind: 'cycle',
    anchorDate: raw.anchorDate,
    cycleDays: raw.cycleDays ?? 1,
    nextDueDate: computed?.nextDueDate ?? raw.anchorDate,
    attentionBeforeDays: raw.attentionBeforeDays ?? null,
    computed,
  };
}

function occurrenceDto(raw) {
  return {
    id: raw.id,
    dayRecordId: raw.recordId,
    occurredOn: raw.occurredOn,
    note: raw.note ?? null,
    source: raw.source,
    intervalDays: raw.intervalDays ?? null,
    recordedBy: actor(raw.recordedBy),
    createdAt: raw.createdAt,
  };
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

async function listDays(request, env, familyId, url) {
  const queryCheck = parseSingleParams(url, ['kind', 'status', 'subjectUserId', 'attentionOnly', 'sort', 'limit', 'cursor']);
  if (!queryCheck.ok) return queryCheck.response;
  const page = parsePage(url);
  if (!page.ok) return page.response;
  const kind = url.searchParams.get('kind');
  // The Mini life tab uses the two-value enum filter already supported by LifeSpace's canonical-backed GET.
  if (kind !== null && !['elapsed', 'countdown', 'cycle', 'elapsed,cycle'].includes(kind)) return errorResponse(400, 'INVALID_QUERY', 'kind is invalid');
  const status = url.searchParams.get('status');
  if (status !== null && !['active', 'archived'].includes(status)) return errorResponse(400, 'INVALID_QUERY', 'status is invalid');
  const attentionRaw = url.searchParams.get('attentionOnly');
  if (attentionRaw !== null && !['true', 'false'].includes(attentionRaw)) return errorResponse(400, 'INVALID_QUERY', 'attentionOnly is invalid');
  const sortName = url.searchParams.get('sort');
  if (sortName !== null && !Object.hasOwn(DAY_SORTS, sortName)) return errorResponse(400, 'INVALID_QUERY', 'sort is invalid');
  if (kind === 'elapsed,cycle' && (attentionRaw !== null || ['attention', 'date_asc', 'date_desc'].includes(sortName))) {
    // Temporal-only GET paths do not support multi-kind filtering; never return a silently incomplete list.
    return errorResponse(400, 'INVALID_QUERY', 'multi-kind cannot be combined with Temporal-only filters or sorts');
  }
  const subjectUserId = url.searchParams.get('subjectUserId');
  if (subjectUserId !== null && !USER_ID.test(subjectUserId)) return errorResponse(400, 'INVALID_QUERY', 'subjectUserId is invalid');

  const memberResult = await members(request, env, familyId);
  if (!memberResult.ok) return memberResult.response;
  let subjectPersonId;
  if (subjectUserId !== null) {
    const resolved = await resolveUserId(request, env, memberResult.data, subjectUserId);
    if (!resolved.ok) return resolved.response;
    subjectPersonId = resolved.data;
  }
  const path = `${modelCollection(familyId)}${queryString({
    kind: kind ?? undefined,
    status: status ?? undefined,
    subjectPersonId,
    attentionOnly: attentionRaw ?? undefined,
    sort: sortName ? DAY_SORTS[sortName] : undefined,
    limit: page.limit,
    cursor: page.cursor,
  })}`;
  const result = await callJson(request, env, path);
  if (!result.ok) return result.response;
  if (!Array.isArray(result.data?.items)) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid day-record page');
  return json({ data: {
    items: result.data.items.map(item => dayDto(request, item, memberResult.data)),
    nextCursor: result.data.nextCursor ?? null,
  } }, 200, result.requestId);
}

async function getDay(request, env, route) {
  const [record, memberResult] = await Promise.all([
    callJson(request, env, modelRecord(route.familyId, route.recordId)),
    members(request, env, route.familyId),
  ]);
  if (!record.ok) return record.response;
  if (!memberResult.ok) return memberResult.response;
  return json({ data: dayDto(request, record.data, memberResult.data) }, 200, record.requestId);
}

const DAY_FIELDS = ['kind', 'name', 'description', 'anchorDate', 'subjectUserId', 'attentionAfterDays', 'attentionBeforeDays', 'cycleDays', 'presentation'];

function validNullableString(value) {
  return value === undefined || value === null || typeof value === 'string';
}

function validOptionalInteger(value, minimum) {
  return value === undefined || value === null || (Number.isInteger(value) && value >= minimum);
}

function validDayFields(data) {
  return validNullableString(data.description)
    && validOptionalInteger(data.attentionAfterDays, 0)
    && validOptionalInteger(data.attentionBeforeDays, 0)
    && validOptionalInteger(data.cycleDays, 1)
    && (!Object.hasOwn(data, 'name') || (typeof data.name === 'string' && data.name.trim().length > 0));
}

async function writeDay(request, env, route, method) {
  const allowed = method === 'POST' ? DAY_FIELDS : [...DAY_FIELDS.filter(key => key !== 'kind'), 'version'];
  const input = await readBody(request, allowed);
  if (!input.ok) return input.response;
  if (method === 'POST' && !['elapsed', 'countdown', 'cycle'].includes(input.data.kind)) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Day record kind is invalid');
  }
  const changed = DAY_FIELDS.filter(key => key !== 'kind').some(key => Object.hasOwn(input.data, key));
  if (method === 'PATCH' && (!Number.isInteger(input.data.version) || input.data.version < 1 || !changed)) {
    return errorResponse(422, 'VALIDATION_ERROR', 'version is invalid');
  }
  if (!validDayFields(input.data)) return errorResponse(422, 'VALIDATION_ERROR', 'Day record payload is invalid');
  if (method === 'POST') {
    const validCommon = typeof input.data.name === 'string' && input.data.name.trim().length > 0
      && typeof input.data.anchorDate === 'string' && DATE.test(input.data.anchorDate);
    const validKindFields = (input.data.kind === 'elapsed'
      && !Object.hasOwn(input.data, 'attentionBeforeDays') && !Object.hasOwn(input.data, 'cycleDays'))
      || (input.data.kind === 'countdown'
        && !Object.hasOwn(input.data, 'attentionAfterDays') && !Object.hasOwn(input.data, 'cycleDays'))
      || (input.data.kind === 'cycle' && Number.isInteger(input.data.cycleDays)
        && input.data.cycleDays >= 1 && !Object.hasOwn(input.data, 'attentionAfterDays'));
    if (!validCommon || !validKindFields) return errorResponse(422, 'VALIDATION_ERROR', 'Day record payload is invalid');
  }
  if (Object.hasOwn(input.data, 'anchorDate') && (typeof input.data.anchorDate !== 'string' || !DATE.test(input.data.anchorDate))) {
    return errorResponse(422, 'VALIDATION_ERROR', 'anchorDate is invalid');
  }
  const memberResult = await members(request, env, route.familyId);
  if (!memberResult.ok) return memberResult.response;
  const data = { ...input.data };
  if (Object.hasOwn(data, 'subjectUserId')) {
    const resolved = await resolveUserId(request, env, memberResult.data, data.subjectUserId);
    if (!resolved.ok) return resolved.response;
    data.subjectPersonId = resolved.data;
    delete data.subjectUserId;
  }
  const path = method === 'POST' ? modelCollection(route.familyId) : modelRecord(route.familyId, route.recordId);
  const result = await callJson(request, env, path, { method, data });
  if (!result.ok) return result.response;
  return json({ data: dayDto(request, result.data, memberResult.data) }, result.status, result.requestId);
}

async function versionOperation(request, env, route, suffix, method = 'POST') {
  const input = await readBody(request, ['version']);
  if (!input.ok) return input.response;
  if (!Number.isInteger(input.data.version) || input.data.version < 1) return errorResponse(422, 'VALIDATION_ERROR', 'version is invalid');
  const path = `${modelRecord(route.familyId, route.recordId)}${suffix}`;
  if (method === 'DELETE') {
    return forwardLifeSpace(derivedRequest(request, 'DELETE', { version: input.data.version }), env, { target: 'core', upstreamPath: path });
  }
  const [result, memberResult] = await Promise.all([
    callJson(request, env, path, { method: 'POST', data: { version: input.data.version } }),
    members(request, env, route.familyId),
  ]);
  if (!result.ok) return result.response;
  if (!memberResult.ok) return memberResult.response;
  return json({ data: dayDto(request, result.data, memberResult.data) }, 200, result.requestId);
}

async function listOccurrences(request, env, route, url) {
  const queryCheck = parseSingleParams(url, ['limit', 'cursor']);
  if (!queryCheck.ok) return queryCheck.response;
  const page = parsePage(url);
  if (!page.ok) return page.response;
  const result = await callJson(request, env, `${modelRecord(route.familyId, route.recordId)}/occurrences${queryString({ limit: page.limit, cursor: page.cursor })}`);
  if (!result.ok) return result.response;
  if (!Array.isArray(result.data?.items)) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned invalid occurrences');
  return json({ data: {
    items: result.data.items.map(occurrenceDto),
    nextCursor: result.data.nextCursor ?? null,
  } }, 200, result.requestId);
}

function dateDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

async function createOccurrence(request, env, route) {
  const input = await readBody(request, ['occurredOn', 'note', 'version']);
  if (!input.ok) return input.response;
  if (typeof input.data.occurredOn !== 'string' || !DATE.test(input.data.occurredOn)
    || !Number.isInteger(input.data.version) || input.data.version < 1) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Occurrence payload is invalid');
  }
  const base = modelRecord(route.familyId, route.recordId);
  const [previous, memberResult] = await Promise.all([
    callJson(request, env, base), members(request, env, route.familyId),
  ]);
  if (!previous.ok) return previous.response;
  if (!memberResult.ok) return memberResult.response;
  const result = await callJson(request, env, `${base}/actions/record-occurrence`, {
    method: 'POST', data: input.data,
  });
  if (!result.ok) return result.response;
  return json({ data: {
    previousAnchorDate: previous.data.anchorDate,
    intervalDays: dateDays(previous.data.anchorDate, input.data.occurredOn),
    record: dayDto(request, result.data, memberResult.data),
  } }, 200, result.requestId);
}

const ICON_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ICON_MAX_BYTES = 256 * 1024;

async function uploadIconImage(request, env, route) {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim()?.toLowerCase() || '';
  if (!ICON_CONTENT_TYPES.has(contentType)) return errorResponse(415, 'INVALID_ICON_IMAGE', 'Only PNG, JPEG, WebP icons are supported');
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > ICON_MAX_BYTES) return errorResponse(413, 'FILE_TOO_LARGE', 'Icon exceeds 256 KiB');
  const base = `/api/v1/spaces/${encodeURIComponent(route.familyId)}`;
  const initiate = await callJson(request, env, `${base}/file-uploads`, {
    method: 'POST',
    data: { modelKey: 'day_record', fieldKey: '__record_icon', ...(route.recordId ? { recordId: route.recordId } : {}),
      size: bytes.byteLength, name: 'record-icon', contentType },
  });
  if (!initiate.ok) return initiate.response;
  const upload = initiate.data?.upload;
  if (upload?.method !== 'PUT' || typeof upload.url !== 'string') return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'File upload session is invalid');
  const target = new URL(upload.url);
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.r2.cloudflarestorage.com')) {
    return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'File transfer target is invalid');
  }
  let put;
  try {
    put = await fetch(upload.url, {
      method: 'PUT', headers: { 'content-type': contentType }, body: bytes,
      redirect: 'manual',
    });
  } catch {
    return errorResponse(503, 'FILE_TRANSFER_UNAVAILABLE', 'File transfer is unavailable');
  }
  if (!put.ok) return errorResponse(502, 'FILE_TRANSFER_FAILED', 'Image upload failed');
  const complete = await callJson(request, env, `${base}/file-uploads/${encodeURIComponent(initiate.data.id)}/complete`, {
    method: 'POST', data: {},
  });
  if (!complete.ok) return complete.response;
  return json({ data: { fileId: complete.data.id } }, 200, complete.requestId);
}

async function downloadIconImage(request, env, route) {
  const record = await callJson(request, env, modelRecord(route.familyId, route.recordId));
  if (!record.ok) return record.response;
  const icon = record.data?.presentation?.icon;
  if (icon?.type !== 'image' || !/^fil_[0-9a-f]{32}$/u.test(icon.fileId)) {
    return errorResponse(404, 'FILE_NOT_FOUND', 'Record does not have an image Icon');
  }
  const base = `/api/v1/spaces/${encodeURIComponent(route.familyId)}`;
  const download = await callJson(request, env, `${base}/file-downloads`, {
    method: 'POST', data: { modelKey: 'day_record', recordId: route.recordId,
      fieldKey: '__record_icon', fileId: icon.fileId },
  });
  if (!download.ok) return download.response;
  const signed = download.data?.url;
  if (typeof signed !== 'string') return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'Missing image download URL');
  const url = new URL(signed);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com')) {
    return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'Unsafe image download URL');
  }
  let fetched;
  try { fetched = await fetch(signed, { redirect: 'manual' }); }
  catch { return errorResponse(503, 'FILE_TRANSFER_UNAVAILABLE', 'Image download unavailable'); }
  const ct = fetched.headers.get('content-type')?.toLowerCase();
  if (!fetched.ok || !ICON_CONTENT_TYPES.has(ct)) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid image response');
  const bytes = await fetched.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > ICON_MAX_BYTES) return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid Icon size');
  return new Response(bytes, { status: 200, headers: {
    'content-type': ct, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  } });
}

async function timedProbe(request, env, path, method = 'GET', data) {
  const started = Date.now();
  const response = await forwardLifeSpace(derivedRequest(request, method, data), env, { target: 'core', upstreamPath: path });
  const elapsedMs = Date.now() - started;
  return response.ok ? { ok: true, elapsedMs } : { ok: false, response };
}

async function diagnostics(request, env) {
  const input = await readBody(request, ['familyId']);
  if (!input.ok) return input.response;
  if (typeof input.data.familyId !== 'string' || !FAMILY_ID.test(input.data.familyId)) {
    return errorResponse(422, 'VALIDATION_ERROR', 'familyId is invalid');
  }
  const healthSamples = [];
  const statusSamples = [];
  const businessSamples = [];
  for (let index = 0; index < 3; index += 1) {
    const nonce = `${Date.now()}-${index}`;
    const health = await timedProbe(request, env, `/health?latencyProbe=${nonce}`);
    if (!health.ok) return health.response;
    healthSamples.push(health.elapsedMs);
    const status = await timedProbe(request, env, `/api/v1/status?latencyProbe=${nonce}`);
    if (!status.ok) return status.response;
    statusSamples.push(status.elapsedMs);
    const business = await timedProbe(
      request,
      env,
      `/api/v1/spaces/${encodeURIComponent(input.data.familyId)}/models/task/records/query`,
      'POST',
      { filter: { field: 'status', op: 'eq', value: 'pending' }, sort: [{ field: 'dueDate', direction: 'asc' }], page: { limit: 1 } },
    );
    if (!business.ok) return business.response;
    businessSamples.push(business.elapsedMs);
  }
  return json({ data: {
    target: 'LifeSpace Core (Cloudflare Service Binding)',
    sampleCount: 3,
    healthSamples,
    statusSamples,
    businessSamples,
    testedAt: new Date().toISOString(),
  } }, 200, request.headers.get('x-request-id') ?? '');
}

export async function handleMiniProgramDayDiagnosticBff(request, env) {
  const url = new URL(request.url);
  const route = matchMiniProgramDayDiagnosticRoute(url.pathname);
  if (!route) return null;
  const queryAllowed = (route.kind === 'day-records' && request.method === 'GET')
    || (route.kind === 'occurrences' && request.method === 'GET');
  if (!queryAllowed && [...url.searchParams.keys()].length > 0) return errorResponse(400, 'INVALID_QUERY', 'Query parameters are not supported');

  if (route.kind === 'icon-upload') {
    if (request.method === 'POST') return uploadIconImage(request, env, route);
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  if (route.kind === 'icon-image') {
    if (request.method === 'GET') return downloadIconImage(request, env, route);
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  if (route.kind === 'day-records') {
    if (request.method === 'GET') return listDays(request, env, route.familyId, url);
    if (request.method === 'POST') return writeDay(request, env, route, 'POST');
  }
  if (route.kind === 'day-record') {
    if (request.method === 'GET') return getDay(request, env, route);
    if (request.method === 'PATCH') return writeDay(request, env, route, 'PATCH');
    if (request.method === 'DELETE') return versionOperation(request, env, route, '', 'DELETE');
  }
  if (route.kind === 'occurrences') {
    if (request.method === 'GET') return listOccurrences(request, env, route, url);
    if (request.method === 'POST') return createOccurrence(request, env, route);
  }
  if ((route.kind === 'archive' || route.kind === 'restore') && request.method === 'POST') {
    return versionOperation(request, env, route, `/actions/${route.kind}`);
  }
  if (route.kind === 'diagnostic' && request.method === 'POST') return diagnostics(request, env);
  return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for Mini Program Day/diagnostic route');
}
