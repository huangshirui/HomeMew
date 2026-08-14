interface Env {
  DB: D1Database;
  WECHAT_APP_ID: string;
  WECHAT_APP_SECRET: string;
  LIFESPACE_APPLICATION_CREDENTIAL: string;
  LIFESPACE_IDENTITY_URL: string;
  LIFESPACE_CORE_URL: string;
}

const USER_SCOPES = [
  'profile:read',
  'profile:write',
  'spaces:read',
  'spaces:write',
  'spaces:manage',
  'resources:read',
  'resources:write',
  'creation-drafts:read',
  'creation-drafts:write',
] as const;

type MappingRow = {
  openid: string;
  lifespace_user_id: string;
  created_at: string;
  updated_at: string;
};

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function json(data: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function baseUrl(value: string, name: string): string {
  if (!value) throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', `${name} is not configured`);
  return value.replace(/\/+$/u, '');
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json<unknown>().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

async function exchangeWechatCode(env: Env, code: string): Promise<string> {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', env.WECHAT_APP_ID);
  url.searchParams.set('secret', env.WECHAT_APP_SECRET);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const payload = await response.json<Record<string, unknown>>().catch(() => ({}));
  const openid = typeof payload.openid === 'string' ? payload.openid : '';
  if (!response.ok || !openid) {
    throw new HttpError(401, 'WECHAT_LOGIN_FAILED', '微信登录凭证校验失败');
  }
  return openid;
}

async function lifespaceRequest(
  env: Env,
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; payload: Record<string, unknown> }> {
  if (!env.LIFESPACE_APPLICATION_CREDENTIAL?.startsWith('lsa_')) {
    throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', 'LifeSpace application credential is not configured');
  }
  const response = await fetch(`${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${env.LIFESPACE_APPLICATION_CREDENTIAL}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json<Record<string, unknown>>().catch(() => ({}));
  return { status: response.status, payload };
}

function dataObject(payload: Record<string, unknown>): Record<string, unknown> {
  const value = payload.data;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function createLifeSpaceUser(env: Env, openid: string): Promise<string> {
  const result = await lifespaceRequest(env, '/internal/v1/users', {
    method: 'POST',
    body: {
      displayName: `微信用户${openid.slice(0, 6)}`,
    },
  });
  const userId = dataObject(result.payload).id;
  if (result.status !== 201 || typeof userId !== 'string' || !userId.startsWith('usr_')) {
    throw new HttpError(502, 'LIFESPACE_USER_CREATE_FAILED', 'LifeSpace 用户初始化失败');
  }
  return userId;
}

async function issueUserToken(env: Env, userId: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  const result = await lifespaceRequest(env, '/internal/v1/tokens', {
    method: 'POST',
    body: { subjectId: userId, scopes: [...USER_SCOPES] },
  });
  if (result.status === 404) return null;
  const data = dataObject(result.payload);
  const accessToken = data.accessToken;
  const expiresIn = data.expiresIn;
  if (result.status !== 200 || typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
    throw new HttpError(502, 'LIFESPACE_TOKEN_EXCHANGE_FAILED', 'LifeSpace 登录令牌签发失败');
  }
  return { accessToken, expiresIn };
}

async function login(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!code) throw new HttpError(400, 'INVALID_REQUEST', 'code is required');

  const openid = await exchangeWechatCode(env, code);
  const existing = await env.DB.prepare(
    'SELECT openid,lifespace_user_id,created_at,updated_at FROM wechat_identity_mappings WHERE openid=?',
  ).bind(openid).first<MappingRow>();

  let userId = existing?.lifespace_user_id ?? '';
  let isNewUser = false;
  let token = userId ? await issueUserToken(env, userId) : null;

  if (!userId || !token) {
    userId = await createLifeSpaceUser(env, openid);
    token = await issueUserToken(env, userId);
    if (!token) throw new HttpError(502, 'LIFESPACE_TOKEN_EXCHANGE_FAILED', 'LifeSpace 新用户令牌签发失败');
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO wechat_identity_mappings(openid,lifespace_user_id,created_at,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(openid) DO UPDATE SET lifespace_user_id=excluded.lifespace_user_id,updated_at=excluded.updated_at`)
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
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'homemew-backend' });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/login/wechat') {
        return await login(request, env);
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: { code: error.code, message: error.message } }, error.status);
      }
      console.error('[HomeMew backend] unhandled error', error instanceof Error ? error.message : 'unknown');
      return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
