import { handleIntegrationRequest, integrationsReady } from './integration-api.mjs';

const ACCESS_ASSERTION_HEADER = 'cf-access-jwt-assertion';
const SESSION_COOKIE = '__Host-homemew_session';
const SESSION_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const USER_SCOPES = [
  'profile:read',
  'profile:write',
  'spaces:read',
  'spaces:write',
  'spaces:manage',
  'resources:read',
  'resources:write',
];

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requestId(request) {
  const existing = request.headers.get('x-request-id')?.trim();
  return existing || crypto.randomUUID();
}

function json(data, status = 200, headers = {}, id = undefined) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(id ? { 'x-request-id': id } : {}),
      ...headers,
    },
  });
}

function errorJson(error, id) {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message, requestId: id } }, error.status, {}, id);
  }
  console.error('[HomeMew web] unhandled error', error instanceof Error ? error.message : 'unknown');
  return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: id } }, 500, {}, id);
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(500, 'WEB_NOT_CONFIGURED', `${name} is not configured`);
  }
  return value.trim();
}

function baseUrl(value, name) {
  return requiredString(value, name).replace(/\/+$/u, '');
}

function applicationCredential(env) {
  const credential = requiredString(env.LIFESPACE_APPLICATION_CREDENTIAL, 'LIFESPACE_APPLICATION_CREDENTIAL');
  if (!credential.startsWith('lsa_')) {
    throw new HttpError(500, 'WEB_NOT_CONFIGURED', 'LIFESPACE_APPLICATION_CREDENTIAL is invalid');
  }
  return credential;
}

function sessionSecret(env) {
  const secret = requiredString(env.WEB_SESSION_SECRET, 'WEB_SESSION_SECRET');
  if (secret.length < 32) {
    throw new HttpError(500, 'WEB_NOT_CONFIGURED', 'WEB_SESSION_SECRET must contain at least 32 characters');
  }
  return secret;
}

function isReady(env) {
  return Boolean(
    env.LIFESPACE_IDENTITY_URL
      && env.LIFESPACE_CORE_URL
      && env.LIFESPACE_APPLICATION_CREDENTIAL?.startsWith('lsa_')
      && typeof env.WEB_SESSION_SECRET === 'string'
      && env.WEB_SESSION_SECRET.length >= 32,
  );
}

function activityReady(env) {
  return Boolean(env.HOMEMEW_BACKEND && typeof env.HOMEMEW_BACKEND.fetch === 'function');
}

function activityBackend(env) {
  if (!activityReady(env)) {
    throw new HttpError(503, 'ACTIVITY_BACKEND_NOT_CONFIGURED', 'HomeMew Activity 服务暂时不可用');
  }
  return env.HOMEMEW_BACKEND;
}

function applicationBackend(env) {
  if (!env.HOMEMEW_BACKEND || typeof env.HOMEMEW_BACKEND.fetch !== 'function') {
    throw new HttpError(503, 'APPLICATION_BACKEND_NOT_CONFIGURED', 'HomeMew 应用服务暂时不可用');
  }
  return env.HOMEMEW_BACKEND;
}

async function familyCatalogRequest(env, path, data) {
  const response = await applicationBackend(env).fetch(new Request(`https://homemew-backend.internal${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(data),
  }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data) {
    throw new HttpError(503, 'FAMILY_CATALOG_UNAVAILABLE', 'HomeMew 家庭目录暂时不可用');
  }
  return payload.data;
}

async function reconcileFamilySpaces(env, spaces) {
  const list = Array.isArray(spaces) ? spaces.filter(space => typeof space?.id === 'string' && space.id.startsWith('spc_')) : [];
  const catalog = await familyCatalogRequest(env, '/internal/v1/family-catalog/reconcile', {
    spaceIds: list.map(space => space.id),
  });
  const familyIds = new Set(catalog.familySpaceIds ?? []);
  return list.filter(space => familyIds.has(space.id));
}

function accessAssertion(request) {
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
  if (!assertion) {
    throw new HttpError(401, 'ACCESS_ASSERTION_REQUIRED', 'Cloudflare Access authentication is required');
  }
  return assertion;
}

function requireSameOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) {
    throw new HttpError(403, 'INVALID_ORIGIN', 'Cross-origin state-changing requests are not allowed');
  }
}

function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function accessFingerprint(assertion) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(assertion));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function makeSessionCookie(env, assertion, token, expiresIn, nowMs) {
  const maxAge = Math.max(1, Math.floor(expiresIn));
  const payload = {
    v: SESSION_VERSION,
    token,
    exp: Math.floor(nowMs / 1000) + maxAge,
    access: await accessFingerprint(assertion),
  };
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(sessionSecret(env));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encoded));
  const value = `${encoded}.${bytesToBase64Url(new Uint8Array(signature))}`;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}

async function readSession(request, env, assertion, nowMs) {
  const value = cookieValue(request, SESSION_COOKIE);
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;

  try {
    const key = await hmacKey(sessionSecret(env));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signature),
      encoder.encode(encoded),
    );
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(base64UrlToBytes(encoded)));
    if (payload?.v !== SESSION_VERSION || typeof payload.token !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(nowMs / 1000) + 15) return null;
    if (payload.access !== await accessFingerprint(assertion)) return null;
    return { accessToken: payload.token, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

function upstreamError(response, payload, fallbackCode) {
  const upstream = payload?.error;
  if (response.status >= 400 && response.status < 500 && upstream && typeof upstream.code === 'string') {
    return new HttpError(response.status, upstream.code, typeof upstream.message === 'string' ? upstream.message : 'Request rejected');
  }
  return new HttpError(502, fallbackCode, 'LifeSpace 服务暂时不可用');
}

async function identityApplicationRequest(env, fetcher, path, body, id) {
  const response = await fetcher(`${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${applicationCredential(env)}`,
      'content-type': 'application/json',
      'x-request-id': id,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function exchangeAccess(env, fetcher, assertion, id) {
  const { response, payload } = await identityApplicationRequest(env, fetcher, '/internal/v1/access/tokens', {
    accessAssertion: assertion,
    requestedScopes: USER_SCOPES,
  }, id);
  const data = payload?.data;
  if (response.status !== 200 || typeof data?.accessToken !== 'string' || typeof data?.expiresIn !== 'number') {
    throw upstreamError(response, payload, 'LIFESPACE_ACCESS_EXCHANGE_FAILED');
  }
  return { accessToken: data.accessToken, expiresIn: data.expiresIn };
}

async function createLinkChallenge(request, env, fetcher, assertion, id) {
  requireSameOrigin(request);
  const { response, payload } = await identityApplicationRequest(env, fetcher, '/internal/v1/access/link-challenges', {
    accessAssertion: assertion,
  }, id);
  if (response.status !== 201 || !payload?.data || typeof payload.data.challengeId !== 'string') {
    throw upstreamError(response, payload, 'LIFESPACE_LINK_CHALLENGE_FAILED');
  }
  return json({ data: payload.data }, 201, {}, id);
}

async function identityUserRequest(env, fetcher, path, token, id) {
  const response = await fetcher(`${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}${path}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'x-request-id': id,
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function ensureSession(request, env, fetcher, assertion, id, nowMs) {
  const existing = await readSession(request, env, assertion, nowMs);
  if (existing) return { ...existing, cookie: null };

  const exchanged = await exchangeAccess(env, fetcher, assertion, id);
  return {
    accessToken: exchanged.accessToken,
    expiresAt: nowMs + exchanged.expiresIn * 1000,
    cookie: await makeSessionCookie(env, assertion, exchanged.accessToken, exchanged.expiresIn, nowMs),
  };
}

async function sessionStatus(request, env, fetcher, assertion, id, nowMs) {
  let session = await ensureSession(request, env, fetcher, assertion, id, nowMs);
  let current = await identityUserRequest(env, fetcher, '/api/v1/me', session.accessToken, id);

  if (current.response.status === 401 && !session.cookie) {
    const exchanged = await exchangeAccess(env, fetcher, assertion, id);
    session = {
      accessToken: exchanged.accessToken,
      expiresAt: nowMs + exchanged.expiresIn * 1000,
      cookie: await makeSessionCookie(env, assertion, exchanged.accessToken, exchanged.expiresIn, nowMs),
    };
    current = await identityUserRequest(env, fetcher, '/api/v1/me', session.accessToken, id);
  }

  if (current.response.status !== 200 || !current.payload?.data) {
    throw upstreamError(current.response, current.payload, 'LIFESPACE_PROFILE_FAILED');
  }

  return json({
    data: {
      authenticated: true,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: current.payload.data,
    },
  }, 200, session.cookie ? { 'set-cookie': session.cookie } : {}, id);
}

function proxyHeaders(request, token, id) {
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'if-match', 'if-none-match']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('authorization', `Bearer ${token}`);
  headers.set('x-request-id', id);
  return headers;
}

function responseHeaders(response, id, sessionCookie) {
  const headers = new Headers();
  for (const name of ['content-type', 'cache-control', 'etag', 'location']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-request-id', response.headers.get('x-request-id') || id);
  if (sessionCookie) headers.set('set-cookie', sessionCookie);
  return headers;
}

async function reportWebActivity(request, env, fetcher, assertion, id, nowMs) {
  requireSameOrigin(request);
  const session = await ensureSession(request, env, fetcher, assertion, id, nowMs);
  const response = await activityBackend(env).fetch(new Request('https://homemew-backend.internal/api/v1/activity/me', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      'x-request-id': id,
    },
    body: JSON.stringify({ channel: 'web' }),
  }));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response, id, session.cookie),
  });
}

async function coreUserRequest(env, fetcher, path, token, id, { method = 'GET', body } = {}) {
  const response = await fetcher(`${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-request-id': id,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Object.hasOwn(payload, 'data')) {
    throw upstreamError(response, payload, 'LIFESPACE_CORE_FAILED');
  }
  return payload.data;
}

async function readObjectBody(request, allowed) {
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body is invalid');
  }
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  }
  return input;
}

async function familyInvitePreview(env, fetcher, token, id, inviteToken) {
  const preview = await coreUserRequest(env, fetcher, '/api/v1/space-invites/preview', token, id, {
    method: 'POST',
    body: { token: inviteToken },
  });
  const classified = await reconcileFamilySpaces(env, [preview.space]);
  if (classified.length !== 1) {
    throw new HttpError(422, 'NOT_HOMEMEW_FAMILY_INVITE', '这个邀请码不属于 HomeMew 家庭');
  }
  return {
    ...preview,
    space: classified[0],
    canJoin: preview.canJoin === true && Number(preview.space?.memberCount ?? 0) < 8,
  };
}

async function commitWebFamilyJoin(env, accessToken, familyId, token, displayName) {
  const response = await applicationBackend(env).fetch(new Request('https://homemew-backend.internal/internal/v1/family-joins/commit', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ familyId, token, displayName }),
  }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error;
    throw new HttpError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'FAMILY_JOIN_FAILED',
      typeof error?.message === 'string' ? error.message : '加入家庭失败',
    );
  }
  if (!payload?.data) throw new HttpError(502, 'INVALID_UPSTREAM_RESPONSE', 'HomeMew 家庭加入服务返回无效响应');
  return payload.data;
}

async function handleFamilies(request, env, fetcher, assertion, id, nowMs) {
  const session = await ensureSession(request, env, fetcher, assertion, id, nowMs);
  if (request.method === 'GET') {
    const spaces = await coreUserRequest(env, fetcher, '/api/v1/me/spaces', session.accessToken, id);
    const families = await reconcileFamilySpaces(env, spaces);
    return json({ data: families }, 200, session.cookie ? { 'set-cookie': session.cookie } : {}, id);
  }
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  requireSameOrigin(request);
  const input = await readObjectBody(request, ['name', 'timezone']);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new HttpError(422, 'VALIDATION_ERROR', '家庭名称无效');
  const me = await identityUserRequest(env, fetcher, '/api/v1/me', session.accessToken, id);
  if (me.response.status !== 200 || !me.payload?.data?.displayName) {
    throw upstreamError(me.response, me.payload, 'LIFESPACE_PROFILE_FAILED');
  }
  const created = await coreUserRequest(env, fetcher, '/api/v1/spaces', session.accessToken, id, {
    method: 'POST',
    body: {
      name,
      timezone: typeof input.timezone === 'string' && input.timezone ? input.timezone : 'Asia/Shanghai',
      ownerDisplayName: me.payload.data.displayName,
    },
  });
  try {
    await familyCatalogRequest(env, '/internal/v1/family-catalog/register', { spaceId: created.id, source: 'created' });
  } catch (error) {
    console.warn('[HomeMew Web] family catalog registration failed after create', created.id, error instanceof Error ? error.message : 'unknown');
  }
  return json({ data: created }, 201, session.cookie ? { 'set-cookie': session.cookie } : {}, id);
}

async function handleFamilyInvite(request, env, fetcher, assertion, id, nowMs, action) {
  requireSameOrigin(request);
  const session = await ensureSession(request, env, fetcher, assertion, id, nowMs);
  const input = await readObjectBody(request, ['token']);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!token || token.length > 200) throw new HttpError(422, 'VALIDATION_ERROR', '邀请码无效');
  const preview = await familyInvitePreview(env, fetcher, session.accessToken, id, token);
  if (action === 'preview') {
    return json({ data: preview }, 200, session.cookie ? { 'set-cookie': session.cookie } : {}, id);
  }
  const me = await identityUserRequest(env, fetcher, '/api/v1/me', session.accessToken, id);
  if (me.response.status !== 200 || !me.payload?.data?.displayName) {
    throw upstreamError(me.response, me.payload, 'LIFESPACE_PROFILE_FAILED');
  }
  const joined = await commitWebFamilyJoin(
    env,
    session.accessToken,
    preview.space.id,
    token,
    me.payload.data.displayName,
  );
  try {
    await familyCatalogRequest(env, '/internal/v1/family-catalog/register', { spaceId: joined.spaceId, source: 'joined' });
  } catch (error) {
    console.warn('[HomeMew Web] family catalog registration failed after join', joined.spaceId, error instanceof Error ? error.message : 'unknown');
  }
  return json({ data: joined }, 201, session.cookie ? { 'set-cookie': session.cookie } : {}, id);
}

async function proxyLifeSpace(request, env, fetcher, assertion, id, nowMs, service) {
  requireSameOrigin(request);
  const prefix = `/api/lifespace/${service}`;
  const url = new URL(request.url);
  const suffix = url.pathname.slice(prefix.length);
  if (!suffix.startsWith('/v1/')) {
    throw new HttpError(404, 'NOT_FOUND', 'LifeSpace API path not found');
  }

  const session = await ensureSession(request, env, fetcher, assertion, id, nowMs);
  const targetBase = service === 'core'
    ? baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')
    : baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL');
  const target = new URL(`${targetBase}/api${suffix}`);
  target.search = url.search;

  const response = await fetcher(target, {
    method: request.method,
    headers: proxyHeaders(request, session.accessToken, id),
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response, id, session.cookie),
  });
}

export function createWebHandler({ fetcher = fetch, now = () => Date.now() } = {}) {
  return {
    async fetch(request, env) {
      const id = requestId(request);
      try {
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/health') {
          return json({
            data: {
              ok: true,
              service: 'homemew-web',
              environment: env.ENVIRONMENT ?? 'unknown',
              ready: isReady(env),
              integrationsReady: integrationsReady(env),
              activityReady: activityReady(env),
              accessMode: 'cloudflare-access',
            },
          }, 200, {}, id);
        }

        if (!url.pathname.startsWith('/api/')) {
          return json({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: id } }, 404, {}, id);
        }

        const assertion = accessAssertion(request);
        const nowMs = now();

        if (request.method === 'GET' && url.pathname === '/api/session') {
          return await sessionStatus(request, env, fetcher, assertion, id, nowMs);
        }
        if (request.method === 'POST' && url.pathname === '/api/session/logout') {
          requireSameOrigin(request);
          return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie(), 'x-request-id': id } });
        }
        if (request.method === 'POST' && url.pathname === '/api/access/link-challenge') {
          return await createLinkChallenge(request, env, fetcher, assertion, id);
        }
        if (request.method === 'POST' && url.pathname === '/api/activity/me') {
          return await reportWebActivity(request, env, fetcher, assertion, id, nowMs);
        }
        if (url.pathname === '/api/families') {
          return await handleFamilies(request, env, fetcher, assertion, id, nowMs);
        }
        if (request.method === 'POST' && url.pathname === '/api/family-invites/preview') {
          return await handleFamilyInvite(request, env, fetcher, assertion, id, nowMs, 'preview');
        }
        if (request.method === 'POST' && url.pathname === '/api/family-invites/join') {
          return await handleFamilyInvite(request, env, fetcher, assertion, id, nowMs, 'join');
        }
        if (url.pathname === '/api/integrations' || url.pathname.startsWith('/api/integrations/')) {
          return await handleIntegrationRequest(request, env, { fetcher, assertion, id });
        }
        if (url.pathname.startsWith('/api/lifespace/core/')) {
          return await proxyLifeSpace(request, env, fetcher, assertion, id, nowMs, 'core');
        }
        if (url.pathname.startsWith('/api/lifespace/identity/')) {
          return await proxyLifeSpace(request, env, fetcher, assertion, id, nowMs, 'identity');
        }

        return json({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: id } }, 404, {}, id);
      } catch (error) {
        return errorJson(error, id);
      }
    },
  };
}

export default createWebHandler();