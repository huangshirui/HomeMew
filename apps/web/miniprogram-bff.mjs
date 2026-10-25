import { errorResponse, forwardLifeSpace } from './miniprogram-upstream.mjs';

const USER_ID = /^usr_[A-Za-z0-9_-]+$/u;
const FAMILY_ID = /^spc_[A-Za-z0-9_-]+$/u;
const CHALLENGE_ID = /^alc_[0-9a-f]{64}$/u;
const MINI_PREFIX = '/api/v1/miniprogram';

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function idSegment(value, pattern) {
  const decoded = decodeSegment(value);
  return decoded && decoded.length <= 200 && pattern.test(decoded) ? decoded : null;
}

export function matchMiniProgramBffRoute(pathname) {
  if (pathname === `${MINI_PREFIX}/me`) return { kind: 'me' };
  if (pathname === `${MINI_PREFIX}/me/avatar`) return { kind: 'me-avatar' };
  if (pathname === `${MINI_PREFIX}/me/web-login`) return { kind: 'web-login' };

  let match = new RegExp(`^${MINI_PREFIX}/me/access-link-challenges/([^/]+)/confirm$`, 'u').exec(pathname);
  if (match) {
    const challengeId = idSegment(match[1], CHALLENGE_ID);
    return challengeId ? { kind: 'access-link-confirm', challengeId } : null;
  }

  match = new RegExp(`^${MINI_PREFIX}/media/users/([^/]+)/avatar$`, 'u').exec(pathname);
  if (match) {
    const userId = idSegment(match[1], USER_ID);
    return userId ? { kind: 'user-avatar-read', userId } : null;
  }

  match = new RegExp(`^${MINI_PREFIX}/media/families/([^/]+)/avatar$`, 'u').exec(pathname);
  if (match) {
    const familyId = idSegment(match[1], FAMILY_ID);
    return familyId ? { kind: 'family-avatar-read', familyId } : null;
  }

  match = new RegExp(`^${MINI_PREFIX}/families/([^/]+)/avatar$`, 'u').exec(pathname);
  if (match) {
    const familyId = idSegment(match[1], FAMILY_ID);
    return familyId ? { kind: 'family-avatar-write', familyId } : null;
  }

  return null;
}

function routeDefinition(route) {
  switch (route.kind) {
    case 'me':
      return { methods: ['GET', 'PATCH'], target: 'identity', path: '/api/v1/me', rewriteAvatars: true };
    case 'me-avatar':
      return { methods: ['PUT'], target: 'identity', path: '/api/v1/me/avatar', rewriteAvatars: true };
    case 'web-login':
      return { methods: ['GET', 'PATCH'], target: 'identity', path: '/api/v1/me/web-login' };
    case 'access-link-confirm':
      return {
        methods: ['POST'],
        target: 'identity',
        path: `/api/v1/me/access-link-challenges/${encodeURIComponent(route.challengeId)}/confirm`,
      };
    case 'user-avatar-read':
      return {
        methods: ['GET', 'HEAD'],
        target: 'identity',
        path: `/assets/users/${encodeURIComponent(route.userId)}/avatar`,
        auth: 'none',
        responseKind: 'asset',
      };
    case 'family-avatar-read':
      return {
        methods: ['GET', 'HEAD'],
        target: 'core',
        path: `/assets/spaces/${encodeURIComponent(route.familyId)}/avatar`,
        auth: 'none',
        responseKind: 'asset',
      };
    case 'family-avatar-write':
      return {
        methods: ['PUT'],
        target: 'core',
        path: `/api/v1/spaces/${encodeURIComponent(route.familyId)}/avatar`,
        rewriteAvatars: true,
      };
    default:
      return null;
  }
}

function rewriteAvatarUrl(value, incomingUrl) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('invalid-avatar-url');
  const parsed = new URL(value, incomingUrl.origin);

  let match = /^\/assets\/users\/([^/]+)\/avatar$/u.exec(parsed.pathname);
  if (match) {
    const userId = idSegment(match[1], USER_ID);
    if (!userId) throw new Error('invalid-avatar-user');
    return new URL(`${MINI_PREFIX}/media/users/${encodeURIComponent(userId)}/avatar`, incomingUrl.origin).toString();
  }

  match = /^\/assets\/spaces\/([^/]+)\/avatar$/u.exec(parsed.pathname);
  if (match) {
    const familyId = idSegment(match[1], FAMILY_ID);
    if (!familyId) throw new Error('invalid-avatar-family');
    return new URL(`${MINI_PREFIX}/media/families/${encodeURIComponent(familyId)}/avatar`, incomingUrl.origin).toString();
  }

  if (parsed.origin === incomingUrl.origin && parsed.pathname.startsWith(`${MINI_PREFIX}/media/`)) {
    return parsed.toString();
  }
  throw new Error('unknown-avatar-url');
}

function rewriteAvatarFields(value, incomingUrl) {
  if (Array.isArray(value)) return value.map(item => rewriteAvatarFields(item, incomingUrl));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = key === 'avatarUrl'
      ? rewriteAvatarUrl(child, incomingUrl)
      : rewriteAvatarFields(child, incomingUrl);
  }
  return result;
}

async function rewriteAvatarResponse(response, incomingUrl) {
  if (response.status < 200 || response.status >= 300) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid JSON response');
  }
  try {
    const payload = rewriteAvatarFields(await response.json(), incomingUrl);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(payload), { status: response.status, headers });
  } catch {
    return errorResponse(502, 'INVALID_UPSTREAM_RESPONSE', 'LifeSpace returned an invalid avatar URL');
  }
}

export async function handleMiniProgramBff(request, env) {
  const incomingUrl = new URL(request.url);
  const isMiniPath = incomingUrl.pathname === MINI_PREFIX || incomingUrl.pathname.startsWith(`${MINI_PREFIX}/`);
  if (!isMiniPath) return null;

  const route = matchMiniProgramBffRoute(incomingUrl.pathname);
  if (!route) return errorResponse(404, 'BFF_ROUTE_NOT_FOUND', 'Unknown Mini Program BFF route');
  const definition = routeDefinition(route);
  if (!definition.methods.includes(request.method)) {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for Mini Program BFF route');
  }
  if ([...incomingUrl.searchParams.keys()].length > 0) {
    return errorResponse(400, 'INVALID_QUERY', 'Query parameters are not supported for this operation');
  }

  const response = await forwardLifeSpace(request, env, {
    target: definition.target,
    upstreamPath: definition.path,
    auth: definition.auth,
    responseKind: definition.responseKind,
  });
  return definition.rewriteAvatars ? rewriteAvatarResponse(response, incomingUrl) : response;
}
