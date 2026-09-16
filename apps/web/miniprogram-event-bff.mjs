const EVENT_ROUTE = /^\/api\/v1\/miniprogram\/spaces\/([^/]+)\/events(?:\/([^/]+))?$/u;
const SPACE_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const LIST_QUERY_KEYS = new Set([
  'rangeStart',
  'rangeEnd',
  'dateStart',
  'dateEndExclusive',
  'timezone',
  'attendeePersonIds',
  'status',
  'q',
  'sort',
  'cursor',
  'limit',
]);
const LEGACY_TEMPORAL_KEYS = new Set([
  'isAllDay',
  'startAt',
  'endAt',
  'startTimezone',
  'endTimezone',
  'startDate',
  'endDateExclusive',
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function error(status, code, message) {
  return json({ error: { code, message } }, status);
}

function baseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().replace(/\/+$/u, '');
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function matchMiniProgramEventRoute(pathname) {
  const match = EVENT_ROUTE.exec(pathname);
  if (!match) return null;
  const spaceId = decodeSegment(match[1]);
  const recordId = match[2] ? decodeSegment(match[2]) : null;
  if (!spaceId || !SPACE_ID.test(spaceId) || spaceId.length > 200) return null;
  if (recordId && (!RECORD_ID.test(recordId) || recordId.length > 200)) return null;
  return { spaceId, recordId };
}

function allowedMethod(method, recordId) {
  if (recordId) return method === 'GET' || method === 'PATCH' || method === 'DELETE';
  return method === 'GET' || method === 'POST';
}

function authorizationHeader(request) {
  const value = request.headers.get('authorization')?.trim() || '';
  if (!value.startsWith('Bearer ') || value.slice(7).trim().length < 10) return null;
  return value;
}

function readSingleQuery(params, key) {
  const values = params.getAll(key);
  if (values.length > 1) throw new Error(`duplicate-query:${key}`);
  return values.length === 1 ? values[0] : null;
}

function parseLimit(value) {
  if (value === null || value === '') return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error('invalid-limit');
  }
  return parsed;
}

function buildCanonicalListQuery(params) {
  for (const key of params.keys()) {
    if (!LIST_QUERY_KEYS.has(key)) throw new Error(`unsupported-query:${key}`);
  }

  const dateStart = readSingleQuery(params, 'dateStart');
  const dateEndExclusive = readSingleQuery(params, 'dateEndExclusive');
  const timezone = readSingleQuery(params, 'timezone');
  if (!dateStart || !dateEndExclusive || !timezone) throw new Error('missing-window-context');

  const sort = readSingleQuery(params, 'sort');
  if (sort && sort !== 'calendarStart:asc') throw new Error('unsupported-sort');

  const filters = [{
    field: 'when',
    op: 'overlaps',
    value: {
      kind: 'local_date_window',
      startDate: dateStart,
      endDateExclusive: dateEndExclusive,
      timezone,
    },
  }];
  const attendeePersonId = readSingleQuery(params, 'attendeePersonIds');
  const status = readSingleQuery(params, 'status');
  if (attendeePersonId) filters.push({ field: 'attendeePersonIds', op: 'contains', value: attendeePersonId });
  if (status) filters.push({ field: 'status', op: 'eq', value: status });

  const q = readSingleQuery(params, 'q');
  const cursor = readSingleQuery(params, 'cursor');
  const limit = parseLimit(readSingleQuery(params, 'limit'));

  // rangeStart/rangeEnd remain accepted in the stable Mini contract during rollout,
  // but the canonical query deliberately derives its interval from the explicit
  // local date window + IANA timezone instead of trusting pre-projected UTC bounds.
  readSingleQuery(params, 'rangeStart');
  readSingleQuery(params, 'rangeEnd');

  return {
    ...(q ? { search: { text: q } } : {}),
    filter: filters.length === 1 ? filters[0] : { and: filters },
    sort: [{ field: 'when', direction: 'asc' }],
    page: { limit, ...(cursor ? { cursor } : {}) },
    context: { viewingTimezone: timezone },
  };
}

function temporalRangeFromLegacy(input) {
  const touched = [...LEGACY_TEMPORAL_KEYS].some(key => hasOwn(input, key));
  if (!touched) return undefined;

  const explicitAllDay = input.isAllDay;
  const hasDatePair = typeof input.startDate === 'string' && typeof input.endDateExclusive === 'string';
  const hasInstantPair = typeof input.startAt === 'string' && typeof input.endAt === 'string';

  if (explicitAllDay === true || (explicitAllDay === undefined && hasDatePair && !hasInstantPair)) {
    if (!hasDatePair) throw new Error('invalid-date-range');
    return { kind: 'date', start: input.startDate, endExclusive: input.endDateExclusive };
  }
  if (explicitAllDay === false || (explicitAllDay === undefined && hasInstantPair && !hasDatePair)) {
    if (!hasInstantPair) throw new Error('invalid-instant-range');
    return { kind: 'instant', start: input.startAt, endExclusive: input.endAt };
  }
  throw new Error('ambiguous-temporal-range');
}

function canonicalMutationFromLegacy(input) {
  if (!isObject(input)) throw new Error('invalid-body');
  const when = temporalRangeFromLegacy(input);
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!LEGACY_TEMPORAL_KEYS.has(key)) output[key] = value;
  }
  if (when) output.when = when;
  return output;
}

function legacyEventFromCanonical(resource) {
  if (!isObject(resource)) return resource;
  const when = resource.when;
  if (!isObject(when) || (when.kind !== 'date' && when.kind !== 'instant')) {
    throw new Error('invalid-upstream-event');
  }
  const output = { ...resource };
  delete output.when;
  if (when.kind === 'date') {
    return {
      ...output,
      isAllDay: true,
      startAt: null,
      endAt: null,
      startTimezone: null,
      endTimezone: null,
      startDate: when.start,
      endDateExclusive: when.endExclusive,
    };
  }
  return {
    ...output,
    isAllDay: false,
    startAt: when.start,
    endAt: when.endExclusive,
    startTimezone: null,
    endTimezone: null,
    startDate: null,
    endDateExclusive: null,
  };
}

function legacyDataFromCanonical(data) {
  if (isObject(data) && Array.isArray(data.items)) {
    return {
      ...data,
      items: data.items.map(legacyEventFromCanonical),
    };
  }
  if (isObject(data) && hasOwn(data, 'when')) return legacyEventFromCanonical(data);
  return data;
}

async function translatedSuccessResponse(upstream, incomingRequestId) {
  const headers = responseHeaders(upstream, incomingRequestId);
  if (upstream.status === 204) return new Response(null, { status: upstream.status, headers });
  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  const payload = await upstream.json();
  if (!isObject(payload) || !hasOwn(payload, 'data')) {
    return error(502, 'UPSTREAM_RESPONSE_INVALID', 'LifeSpace Core returned an invalid Event response');
  }
  try {
    return json(
      { ...payload, data: legacyDataFromCanonical(payload.data) },
      upstream.status,
      Object.fromEntries(headers.entries()),
    );
  } catch {
    return error(502, 'UPSTREAM_RESPONSE_INVALID', 'LifeSpace Core returned an invalid Event resource');
  }
}

function responseHeaders(upstream, incomingRequestId) {
  const headers = new Headers({ 'cache-control': 'no-store' });
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const requestId = upstream.headers.get('x-request-id') || incomingRequestId;
  if (requestId) headers.set('x-request-id', requestId);
  return headers;
}

export async function handleMiniProgramEventBff(request, env) {
  const incomingUrl = new URL(request.url);
  const route = matchMiniProgramEventRoute(incomingUrl.pathname);
  if (!route) return null;

  if (!allowedMethod(request.method, route.recordId)) {
    return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for Mini Program Event BFF');
  }

  const authorization = authorizationHeader(request);
  if (!authorization) {
    return error(401, 'UNAUTHORIZED', 'LifeSpace user bearer is required');
  }

  const coreBaseUrl = baseUrl(env.LIFESPACE_CORE_URL);
  if (!coreBaseUrl) {
    return error(503, 'BFF_NOT_CONFIGURED', 'LifeSpace Core is not configured');
  }

  const collectionPath = `${coreBaseUrl}/api/v1/spaces/${encodeURIComponent(route.spaceId)}/models/event/records`;
  const upstreamUrl = new URL(route.recordId
    ? `${collectionPath}/${encodeURIComponent(route.recordId)}`
    : request.method === 'GET'
      ? `${collectionPath}/query`
      : collectionPath);

  if (!(request.method === 'GET' && !route.recordId) && [...incomingUrl.searchParams.keys()].length > 0) {
    return error(400, 'INVALID_QUERY', 'Query parameters are not supported for this Event operation');
  }

  const headers = new Headers({
    accept: 'application/json',
    authorization,
  });
  const incomingRequestId = request.headers.get('x-request-id')?.trim() || '';
  if (incomingRequestId) headers.set('x-request-id', incomingRequestId);

  let upstreamMethod = request.method;
  let body;
  try {
    if (request.method === 'GET' && !route.recordId) {
      upstreamMethod = 'POST';
      body = JSON.stringify(buildCanonicalListQuery(incomingUrl.searchParams));
      headers.set('content-type', 'application/json');
    } else if (request.method === 'POST' || request.method === 'PATCH') {
      const text = await request.text();
      const parsed = text ? JSON.parse(text) : {};
      body = JSON.stringify(canonicalMutationFromLegacy(parsed));
      headers.set('content-type', 'application/json');
    } else if (request.method === 'DELETE') {
      body = await request.text();
      if (body) headers.set('content-type', 'application/json');
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    if (message.startsWith('unsupported-query:')) {
      return error(400, 'INVALID_QUERY', `Unsupported Event query parameter: ${message.slice('unsupported-query:'.length)}`);
    }
    if (message === 'duplicate-query:dateStart' || message === 'duplicate-query:dateEndExclusive' || message === 'duplicate-query:timezone') {
      return error(400, 'INVALID_QUERY', 'Duplicate Event query parameter');
    }
    if (message === 'missing-window-context') {
      return error(400, 'INVALID_QUERY', 'dateStart, dateEndExclusive and timezone are required');
    }
    if (message === 'unsupported-sort') {
      return error(400, 'INVALID_QUERY', 'Only calendarStart:asc is supported by the stable Mini Event contract');
    }
    if (message === 'invalid-limit') {
      return error(400, 'INVALID_QUERY', 'Event limit must be an integer from 1 to 200');
    }
    return error(400, 'INVALID_EVENT', 'Event payload cannot be represented by the canonical TemporalRange contract');
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: upstreamMethod,
      headers,
      ...(body ? { body } : {}),
    });
    if (!upstream.ok) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders(upstream, incomingRequestId),
      });
    }
    return translatedSuccessResponse(upstream, incomingRequestId);
  } catch {
    return error(502, 'LIFESPACE_CORE_UNAVAILABLE', 'LifeSpace Core is temporarily unavailable');
  }
}
