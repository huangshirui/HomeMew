/**
 * One HomeMew deployment, two explicit LifeSpace environments.
 * /_stage/api/* selects staging by route, never by a spoofable upstream URL.
 * Fail closed if any staging binding or secret is missing; no prod fallback.
 */
const PREFIX = '/_stage';
const REQUIRED = [
  'HOMEMEW_BACKEND_STAGING',
  'LIFESPACE_CORE_STAGING',
  'LIFESPACE_IDENTITY_STAGING',
];
function unavailable() {
  return new Response(JSON.stringify({ error: {
    code: 'STAGING_NOT_CONFIGURED',
    message: 'HomeMew staging 尚未配置完成，已拒绝请求以避免误写生产数据',
  } }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
export function selectApplicationEnvironment(request, env) {
  const url = new URL(request.url);
  if (!(url.pathname === PREFIX + '/health' || url.pathname.startsWith(PREFIX + '/api/'))) {
    return { request, env, staging: false };
  }
  if (!REQUIRED.every(key => typeof env[key]?.fetch === 'function')
    || typeof env.STAGING_LIFESPACE_APPLICATION_CREDENTIAL !== 'string'
    || !env.STAGING_LIFESPACE_APPLICATION_CREDENTIAL.startsWith('lsa_')
    || typeof env.STAGING_WEB_SESSION_SECRET !== 'string'
    || env.STAGING_WEB_SESSION_SECRET.length < 32
    || !env.STAGING_LIFESPACE_IDENTITY_URL?.startsWith('https://')
    || !env.STAGING_LIFESPACE_CORE_URL?.startsWith('https://')) {
    return { error: unavailable() };
  }
  url.pathname = url.pathname.slice(PREFIX.length);
  // Preserve Access assertion, Origin, user bearer, and same-origin request body.
  // The Origin must remain the original application host for CSRF checks.
  return {
    request: new Request(url, request),
    staging: true,
    env: {
      ...env,
      ENVIRONMENT: 'staging',
      HOMEMEW_BACKEND: env.HOMEMEW_BACKEND_STAGING,
      LIFESPACE_CORE: env.LIFESPACE_CORE_STAGING,
      LIFESPACE_IDENTITY: env.LIFESPACE_IDENTITY_STAGING,
      LIFESPACE_CORE_URL: env.STAGING_LIFESPACE_CORE_URL,
      LIFESPACE_IDENTITY_URL: env.STAGING_LIFESPACE_IDENTITY_URL,
      LIFESPACE_APPLICATION_CREDENTIAL: env.STAGING_LIFESPACE_APPLICATION_CREDENTIAL,
      WEB_SESSION_SECRET: env.STAGING_WEB_SESSION_SECRET,
      WEB_SESSION_COOKIE: '__Host-homemew_staging_session',
    },
  };
}
