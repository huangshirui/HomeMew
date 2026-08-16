import { DurableObject } from 'cloudflare:workers';

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
function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', `${name} is not configured`);
  }
  return value.trim();
}
function baseUrl(value, name) {
  return requiredString(value, name).replace(/\/+$/u, '');
}
function isLoginReady(env) {
  return Boolean(
    env.WECHAT_APP_ID
      && env.WECHAT_APP_SECRET
      && env.LIFESPACE_APPLICATION_CREDENTIAL?.startsWith('lsa_')
      && env.LIFESPACE_IDENTITY_URL
      && env.LIFESPACE_CORE_URL
      && env.WECHAT_IDENTITIES,
  );
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
  url.searchParams.set('appid', requiredString(env.WECHAT_APP_ID, 'WECHAT_APP_ID'));
  url.searchParams.set('secret', requiredString(env.WECHAT_APP_SECRET, 'WECHAT_APP_SECRET'));
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
  const data = dataObject(result.payload);
  if (result.status !== 200 || typeof data.accessToken !== 'string' || typeof data.expiresIn !== 'number') {
    throw new HttpError(502, 'LIFESPACE_TOKEN_EXCHANGE_FAILED', 'LifeSpace 登录令牌签发失败');
  }
  return { accessToken: data.accessToken, expiresIn: data.expiresIn };
}

function migratedLifeSpaceUserId(env, openid) {
  const raw = typeof env.WECHAT_IDENTITY_BOOTSTRAP_MAP === 'string'
    ? env.WECHAT_IDENTITY_BOOTSTRAP_MAP.trim()
    : '';
  if (!raw) return null;

  let mappings;
  try {
    mappings = JSON.parse(raw);
  } catch {
    throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', '微信身份迁移映射配置无效');
  }
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
    throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', '微信身份迁移映射配置无效');
  }
  const userId = mappings[openid];
  if (userId === undefined) return null;
  if (typeof userId !== 'string' || !userId.startsWith('usr_')) {
    throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', '微信身份迁移映射包含无效用户');
  }
  return userId;
}

export class WechatIdentity extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pendingResolution = null;
  }

  async resolveUser(openid) {
    const mapping = await this.ctx.storage.get('mapping');
    if (mapping?.lifespaceUserId?.startsWith('usr_')) {
      return { userId: mapping.lifespaceUserId, isNewUser: false };
    }

    const migratedUserId = migratedLifeSpaceUserId(this.env, openid);
    if (migratedUserId) {
      const now = new Date().toISOString();
      await this.ctx.storage.put('mapping', {
        lifespaceUserId: migratedUserId,
        createdAt: now,
        migratedAt: now,
      });
      return { userId: migratedUserId, isNewUser: false };
    }

    // The object is keyed by WeChat appid + openid. A shared in-memory promise
    // collapses concurrent first-login requests while the external LifeSpace call
    // is in flight. Persistent storage remains authoritative after completion.
    if (!this.pendingResolution) {
      this.pendingResolution = this.createAndPersist(openid).finally(() => {
        this.pendingResolution = null;
      });
    }
    return await this.pendingResolution;
  }

  async createAndPersist(openid) {
    const userId = await createLifeSpaceUser(this.env, openid);
    const now = new Date().toISOString();
    await this.ctx.storage.put('mapping', {
      lifespaceUserId: userId,
      createdAt: now,
    });
    return { userId, isNewUser: true };
  }
}

async function resolveWechatIdentity(env, openid) {
  if (!env.WECHAT_IDENTITIES || typeof env.WECHAT_IDENTITIES.getByName !== 'function') {
    throw new HttpError(500, 'BACKEND_NOT_CONFIGURED', 'WECHAT_IDENTITIES Durable Object is not configured');
  }
  const appId = requiredString(env.WECHAT_APP_ID, 'WECHAT_APP_ID');
  const stub = env.WECHAT_IDENTITIES.getByName(`wechat:${appId}:${openid}`);
  const result = await stub.resolveUser(openid);
  if (!result || typeof result.userId !== 'string' || !result.userId.startsWith('usr_')) {
    throw new HttpError(502, 'IDENTITY_MAPPING_FAILED', '微信身份映射失败');
  }
  return result;
}

async function login(request, env) {
  const input = await readJson(request);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!code) throw new HttpError(400, 'INVALID_REQUEST', 'code is required');

  const openid = await exchangeWechatCode(env, code);
  const { userId, isNewUser } = await resolveWechatIdentity(env, openid);
  const token = await issueUserToken(env, userId);

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
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({
          ok: true,
          service: 'homemew-backend',
          environment: env.ENVIRONMENT ?? 'unknown',
          loginReady: isLoginReady(env),
          identityBootstrapConfigured: Boolean(env.WECHAT_IDENTITY_BOOTSTRAP_MAP),
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/login/wechat') return await login(request, env);
      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
      console.error('[HomeMew backend] unhandled error', error instanceof Error ? error.message : 'unknown');
      return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }, 500);
    }
  },
};
