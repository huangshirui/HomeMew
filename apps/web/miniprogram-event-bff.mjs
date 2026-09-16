import { errorResponse, forwardLifeSpace } from './miniprogram-upstream.mjs';

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

function copyListQuery(input, output) {
  for (const [key, value] of input.entries()) {
    if (!LIST_QUERY_KEYS.has(key)) throw new Error(`unsupported-query:${key}`);
    if (key === 'timezone') continue;
    if (output.has(key)) throw new Error(`duplicate-query:${key}`);
    output.set(key, value);
  }
}

export async function handleMiniProgramEventBff(request, env) {
  const incomingUrl = new URL(request.url);
  const route = matchMiniProgramEventRoute(incomingUrl.pathname);
  if (!route) return null;

  if (!allowedMethod(request.method, route.recordId)) {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for Mini Program Event BFF');
  }

  let upstreamPath = `/api/v1/spaces/${encodeURIComponent(route.spaceId)}/models/event/records${route.recordId ? `/${encodeURIComponent(route.recordId)}` : ''}`;

  if (request.method === 'GET' && !route.recordId) {
    const query = new URLSearchParams();
    try {
      copyListQuery(incomingUrl.searchParams, query);
    } catch (queryError) {
      const message = queryError instanceof Error ? queryError.message : '';
      if (message.startsWith('unsupported-query:')) {
        return errorResponse(400, 'INVALID_QUERY', `Unsupported Event query parameter: ${message.slice('unsupported-query:'.length)}`);
      }
      return errorResponse(400, 'INVALID_QUERY', 'Duplicate Event query parameter');
    }
    if (query.size > 0) upstreamPath += `?${query.toString()}`;
  } else if ([...incomingUrl.searchParams.keys()].length > 0) {
    return errorResponse(400, 'INVALID_QUERY', 'Query parameters are not supported for this Event operation');
  }

  return forwardLifeSpace(request, env, { target: 'core', upstreamPath });
}
