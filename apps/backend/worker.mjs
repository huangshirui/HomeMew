const USER_SCOPES = [
  'profile:read', 'profile:write', 'spaces:read', 'spaces:write', 'spaces:manage',
  'resources:read', 'resources:write', 'creation-drafts:read', 'creation-drafts:write',
];

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
function baseUrl(value, name) {
  if (!value) throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', `${name} is not configured`);
  return value.replace(/\/+$/u, '');
}
async function readJson(request) {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  }
  return value;
}
async function exchangeWechatCode(env, code) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', env.WECHAT_APP_ID);
  url.searchParams.set('secret', env.WECHAT_APP_SECRET);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.openid !== 'string' || !payload.openid) {
    throw new HttpError(401, 'WECHAT_LOGIN_FAILED', '微信登录凭证校验失败');
  }
  return payload.openid;
}
async function lifespaceRequest(env, path, { method = 'GET', body } = {}) {
  if (!env.LIFESPACE_APPLICATION_CREDENTIAL?.startsWith('lsa_')) {
    throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', 'LifeSpace application credential is not configured');
  }
  const response = await fetch(`${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${env.LIFESPACE_APPLICATION_CREDENTIAL}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}
const dataObject = payload => payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
async function createLifeSpaceUser(env, openid) {
  const result = await lifespaceRequest(env, '/internal/v1/users', {
    method: 'POST', body: { displayName: `微信用户${openid.slice(0, 6)}` },
  });
  const userId = dataObject(result.payload).id;
  if (result.status !== 201 || typeof userId !== 'string' || !userId.startsWith('usr_')) {
    throw new HttpError(502, 'LIFESPACE_USER_CREATE_FAILED', 'LifeSpace 用户初始化失败');
  }
  return userId;
}
async function issueUserToken(env, userId) {
  const result = await lifespaceRequest(env, '/internal/v1/tokens', {
    method: 'POST', body: { subjectId: userId, scopes: USER_SCOPES },
  });
  if (result.status === 404) return null;
  const data = dataObject(result.payload);
  if (result.status !== 200 || typeof data.accessToken !== 'string' || typeof data.expiresIn !== 'number') {
    throw new HttpError(502, 'LIFESPACE_TOKEN_EXCHANGE_FAILED', 'LifeSpace 登录令牌签发失败');
  }
  return { accessToken: data.accessToken, expiresIn: data.expiresIn };
}
async function login(request, env) {
  const input = await readJson(request);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!code) throw new HttpError(400, 'INVALID_REQUEST', 'code is required');
  const openid = await exchangeWechatCode(env, code);
  const existing = await env.DB.prepare(
    'SELECT openid,lifespace_user_id,created_at,updated_at FROM wechat_identity_mappings WHERE openid=?',
  ).bind(openid).first();
  let userId = existing?.lifespace_user_id ?? '';
  let isNewUser = false;
  let token = userId ? await issueUserToken(env, userId) : null;
  if (!userId || !token) {
    userId = await createLifeSpaceUser(env, openid);
    token = await issueUserToken(env, userId);
    if (!token) throw new HttpError(502, 'LIFESPACE_TOKEN_EXCHANGE_FAILED', 'LifeSpace 新用户令牌签发失败');
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO wechat_identity_mappings(openid,lifespace_user_id,created_at,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(openid) DO UPDATE SET lifespace_user_id=excluded.lifespace_user_id,updated_at=excluded.updated_at`)
      .bind(openid, userId, existing?.created_at ?? now, now).run();
    isNewUser = true;
  } else {
    await env.DB.prepare('UPDATE wechat_identity_mappings SET updated_at=? WHERE openid=?')
      .bind(new Date().toISOString(), openid).run();
  }
  return json({
    accessToken: token.accessToken,
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    isNewUser,
    coreApiUrl: baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL'),
    identityApiUrl: baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL'),
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'homemew-backend' });
      if (request.method === 'POST' && url.pathname === '/api/v1/login/wechat') return await login(request, env);
      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
      console.error('[HomeMew backend] unhandled error', error instanceof Error ? error.message : 'unknown');
      return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }, 500);
    }
  },
};
