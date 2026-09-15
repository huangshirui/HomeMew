const EVENT_ROUTE = /^\/api\/v1\/miniprogram\/spaces\/([^/]+)\/events(?:\/([^/]+))?$/u;
const SPACE_ID = /^spc_[A-Za-z0-9_-]+$/u;
const RECORD_ID = /^rec_[A-Za-z0-9_-]+$/u;
const LIST_QUERY_KEYS = new Set([
  'rangeStart',
  'rangeEnd',
  'dateStart',
  'dateEndExclusive',
  'attendeePersonIds',
  'status',
  'q',
  'sort',
  'cursor',
  'limit',
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
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

function copyListQuery(input, output) {
  for (const [key, value] of input.entries()) {
    if (!LIST_QUERY_KEYS.has(key)) {
      throw new Error(`unsupported-query:${key}`);
    }
    if (output.has(key)) {
      throw new Error(`duplicate-query:${key}`);
    }
    output.set(key, value);
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

  const upstreamUrl = new URL(
    `${coreBaseUrl}/api/v1/spaces/${encodeURIComponent(route.spaceId)}/models/event/records${route.recordId ? `/${encodeURIComponent(route.recordId)}` : ''}`,
  );

  if (request.method === 'GET' && !route.recordId) {
    try {
      copyListQuery(incomingUrl.searchParams, upstreamUrl.searchParams);
    } catch (queryError) {
      const message = queryError instanceof Error ? queryError.message : '';
      if (message.startsWith('unsupported-query:')) {
        return error(400, 'INVALID_QUERY', `Unsupported Event query parameter: ${message.slice('unsupported-query:'.length)}`);
      }
      return error(400, 'INVALID_QUERY', 'Duplicate Event query parameter');
    }
  } else if ([...incomingUrl.searchParams.keys()].length > 0) {
    return error(400, 'INVALID_QUERY', 'Query parameters are not supported for this Event operation');
  }

  const headers = new Headers({
    accept: 'application/json',
    authorization,
  });
  const incomingRequestId = request.headers.get('x-request-id')?.trim() || '';
  if (incomingRequestId) headers.set('x-request-id', incomingRequestId);

  let body;
  if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE') {
    body = await request.text();
    if (body) headers.set('content-type', 'application/json');
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream, incomingRequestId),
    });
  } catch {
    return error(502, 'LIFESPACE_CORE_UNAVAILABLE', 'LifeSpace Core is temporarily unavailable');
  }
}
