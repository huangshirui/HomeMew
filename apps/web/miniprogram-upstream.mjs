const TARGETS = Object.freeze({
  core: { binding: 'LIFESPACE_CORE', unavailableCode: 'LIFESPACE_CORE_UNAVAILABLE' },
  identity: { binding: 'LIFESPACE_IDENTITY', unavailableCode: 'LIFESPACE_IDENTITY_UNAVAILABLE' },
});

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'if-modified-since',
  'if-none-match',
  'range',
  'x-request-id',
];

const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
  'x-request-id',
];

export function json(data, status = 200, requestId = '') {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  if (requestId) headers.set('x-request-id', requestId);
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(status, code, message, requestId = '') {
  return json({ error: { code, message } }, status, requestId);
}

export function authorizationHeader(request) {
  const value = request.headers.get('authorization')?.trim() || '';
  if (!value.startsWith('Bearer ') || value.slice(7).trim().length < 10) return null;
  return value;
}

function fixedUpstreamPath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('://');
}

function responseHeaders(upstream, incomingRequestId, responseKind) {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('x-request-id') && incomingRequestId) {
    headers.set('x-request-id', incomingRequestId);
  }
  if (responseKind === 'json' && !headers.has('cache-control')) {
    headers.set('cache-control', 'no-store');
  }
  return headers;
}

export async function forwardLifeSpace(
  request,
  env,
  { target, upstreamPath, auth = 'required', responseKind = 'json' },
) {
  const targetConfig = TARGETS[target];
  if (!targetConfig || !fixedUpstreamPath(upstreamPath)) {
    return errorResponse(500, 'BFF_ROUTE_CONFIGURATION_ERROR', 'Mini BFF route is not configured safely');
  }

  const requestId = request.headers.get('x-request-id')?.trim() || '';
  if (auth === 'required' && !authorizationHeader(request)) {
    return errorResponse(401, 'UNAUTHORIZED', 'LifeSpace user bearer is required', requestId);
  }

  const service = env[targetConfig.binding];
  if (!service || typeof service.fetch !== 'function') {
    return errorResponse(503, 'BFF_NOT_CONFIGURED', `LifeSpace ${target} binding is not configured`, requestId);
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    if (auth === 'none' && name === 'authorization') continue;
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 0) body = bytes;
  }

  const upstreamRequest = new Request(`https://lifespace.internal${upstreamPath}`, {
    method: request.method,
    headers,
    ...(body ? { body } : {}),
  });

  try {
    const upstream = await service.fetch(upstreamRequest);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream, requestId, responseKind),
    });
  } catch {
    return errorResponse(502, targetConfig.unavailableCode, `LifeSpace ${target} is temporarily unavailable`, requestId);
  }
}
