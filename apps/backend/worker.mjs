import { DurableObject } from 'cloudflare:workers';

const USER_SCOPES = [
  'profile:read', 'profile:write', 'spaces:read', 'spaces:write', 'spaces:manage',
  'resources:read', 'resources:write',
];

const ACTIVITY_CHANNEL_FIELDS = {
  miniprogram: 'miniProgramLastSeenAt',
  web: 'webLastSeenAt',
  wecom: 'wecomLastSeenAt',
};
const FIRST_PARTY_ACTIVITY_CHANNELS = new Set(['miniprogram', 'web']);
const MAX_ACTIVITY_QUERY_USERS = 50;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_FAMILY_CATALOG_BATCH = 200;
const FAMILY_MEMBER_LIMIT = 8;
const FAMILY_SPACE_ID = /^spc_[A-Za-z0-9_-]+$/u;

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
function isActivityReady(env) {
  return Boolean(env.MEMBER_ACTIVITIES && typeof env.MEMBER_ACTIVITIES.getByName === 'function');
}
function isFamilyCatalogReady(env) {
  return Boolean(env.FAMILY_CATALOG && typeof env.FAMILY_CATALOG.getByName === 'function');
}

function familyCatalogStub(env) {
  if (!isFamilyCatalogReady(env)) {
    throw new HttpError(503, 'FAMILY_CATALOG_NOT_CONFIGURED', 'Family catalog is not configured');
  }
  return env.FAMILY_CATALOG.getByName('catalog:v1');
}

function familyJoinCoordinatorStub(env, familyId) {
  if (!env.FAMILY_JOIN_COORDINATORS || typeof env.FAMILY_JOIN_COORDINATORS.getByName !== 'function') {
    throw new HttpError(503, 'FAMILY_JOIN_NOT_CONFIGURED', 'Family join coordination is not configured');
  }
  return env.FAMILY_JOIN_COORDINATORS.getByName(`family-join:${familyId}`);
}


function validateFamilySpaceId(value) {
  const spaceId = typeof value === 'string' ? value.trim() : '';
  if (!FAMILY_SPACE_ID.test(spaceId)) {
    throw new HttpError(422, 'INVALID_FAMILY_SPACE_ID', 'spaceId must be a LifeSpace spc_* ID');
  }
  return spaceId;
}

function validateFamilySpaceIds(value) {
  if (!Array.isArray(value) || value.length > MAX_FAMILY_CATALOG_BATCH) {
    throw new HttpError(422, 'INVALID_FAMILY_SPACE_IDS', `spaceIds must contain at most ${MAX_FAMILY_CATALOG_BATCH} entries`);
  }
  return [...new Set(value.map(validateFamilySpaceId))];
}

function requireInternalFamilyCatalogRequest(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'homemew-backend.internal') {
    throw new HttpError(404, 'NOT_FOUND', 'Not found');
  }
}

function isExternalActivityReady(env) {
  return isActivityReady(env)
    && typeof env.ACTIVITY_API_SECRET === 'string'
    && env.ACTIVITY_API_SECRET.trim().length >= 32;
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
    method: 'POST', body: { displayName: `微信用户${openid.slice(-6)}` },
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

export class FamilyCatalog extends DurableObject {
  async register(spaceId, source = 'runtime') {
    if (!FAMILY_SPACE_ID.test(spaceId)) throw new Error('Invalid family Space ID');
    const key = `family:${spaceId}`;
    const existing = await this.ctx.storage.get(key);
    if (!existing) {
      await this.ctx.storage.put(key, {
        spaceId,
        source,
        registeredAt: new Date().toISOString(),
      });
    }
    return existing ?? await this.ctx.storage.get(key);
  }

  async registerMany(spaceIds, source = 'migration') {
    const unique = [...new Set(spaceIds)];
    if (unique.length > MAX_FAMILY_CATALOG_BATCH) throw new Error('Family catalog batch is too large');
    for (const spaceId of unique) await this.register(spaceId, source);
    return { registered: unique.length };
  }

  async filter(spaceIds) {
    const unique = [...new Set(spaceIds)];
    if (unique.length > MAX_FAMILY_CATALOG_BATCH) throw new Error('Family catalog batch is too large');
    const result = [];
    for (const spaceId of unique) {
      if (await this.ctx.storage.get(`family:${spaceId}`)) result.push(spaceId);
    }
    return result;
  }

  async status() {
    const entries = await this.ctx.storage.list({ prefix: 'family:' });
    return { count: entries.size };
  }
}

export class FamilyJoinCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.joinTail = Promise.resolve();
  }

  async commit(input) {
    const previous = this.joinTail;
    let release;
    this.joinTail = new Promise(resolve => { release = resolve(); });
    await previous;
    try {
      return await this.commitSerial(input);
    } finally {
      release();
    }
  }

  async commitSerial({ familyId, token, authorization, displayName }) {
    const coreBase = baseUrl(this.env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL');
    const core = async (path, { method = 'GET', body } = {}) => {
      const response = await fetch(`${coreBase}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      return { status: response.status, payload };
    };

    const preview = await core('/api/v1/space-invites/preview', {
      method: 'POST',
      body: { token },
    });
    if (preview.status !== 200) return preview;
    if (preview.payload?.data?.space?.id !== familyId) {
      return {
        status: 409,
        payload: { error: { code: 'FAMILY_INVITE_SPACE_MISMATCH', message: 'Family invite Space changed during join' } },
      };
    }

    const [me, members] = await Promise.all([
      core('/api/v1/me'),
      core(`/api/v1/spaces/${encodeURIComponent(familyId)}/members`),
    ]);
    if (me.status !== 200) return me;
    if (members.status !== 200) return members;

    const userId = me.payload?.data?.principal?.id;
    const list = Array.isArray(members.payload?.data) ? members.payload.data : [];
    const alreadyMember = typeof userId === 'string' && list.some(member => member?.userId === userId);
    if (!alreadyMember && list.length >= FAMILY_MEMBER_LIMIT) {
      return {
        status: 409,
        payload: { error: { code: 'FAMILY_MEMBER_LIMIT_REACHED', message: '家庭成员已达到 8 人上限' } },
      };
    }

    return core('/api/v1/space-invites/join', {
      method: 'POST',
      body: { token, displayName },
    });
  }
}

export class MemberActivity extends DurableObject {
  async report(channel, occurredAt) {
    const field = ACTIVITY_CHANNEL_FIELDS[channel];
    if (!field) throw new Error(`Unsupported activity channel: ${channel}`);

    const existing = await this.ctx.storage.get('activity');
    const state = existing && typeof existing === 'object' ? existing : {};
    const previous = typeof state[field] === 'string' ? state[field] : null;
    const previousMs = previous ? Date.parse(previous) : Number.NaN;
    const candidateMs = Date.parse(occurredAt);

    if (!previous || Number.isNaN(previousMs) || candidateMs > previousMs) {
      state[field] = occurredAt;
      await this.ctx.storage.put('activity', state);
    }

    return activityDto(null, state);
  }

  async getActivity() {
    const existing = await this.ctx.storage.get('activity');
    return activityDto(null, existing && typeof existing === 'object' ? existing : {});
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

function validateUserId(value) {
  const userId = typeof value === 'string' ? value.trim() : '';
  if (!userId.startsWith('usr_') || userId.length <= 4 || userId.length > 100) {
    throw new HttpError(422, 'INVALID_ACTIVITY_USER', 'userId must be a LifeSpace usr_* ID');
  }
  return userId;
}

function validateActivityChannel(value, allowed = null) {
  const channel = typeof value === 'string' ? value.trim() : '';
  if (!ACTIVITY_CHANNEL_FIELDS[channel] || (allowed && !allowed.has(channel))) {
    throw new HttpError(422, 'INVALID_ACTIVITY_CHANNEL', 'Unsupported activity channel');
  }
  return channel;
}

function normalizeOccurredAt(value, nowMs = Date.now()) {
  if (value === undefined || value === null || value === '') return new Date(nowMs).toISOString();
  if (typeof value !== 'string') {
    throw new HttpError(422, 'INVALID_ACTIVITY_TIME', 'occurredAt must be an RFC 3339 timestamp');
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || parsed > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new HttpError(422, 'INVALID_ACTIVITY_TIME', 'occurredAt must be a valid timestamp not materially in the future');
  }
  return new Date(parsed).toISOString();
}

function activityDto(userId, state) {
  const miniProgramLastSeenAt = typeof state?.miniProgramLastSeenAt === 'string' ? state.miniProgramLastSeenAt : null;
  const webLastSeenAt = typeof state?.webLastSeenAt === 'string' ? state.webLastSeenAt : null;
  const wecomLastSeenAt = typeof state?.wecomLastSeenAt === 'string' ? state.wecomLastSeenAt : null;
  const candidates = [miniProgramLastSeenAt, webLastSeenAt, wecomLastSeenAt].filter(Boolean);
  const lastSeenAt = candidates.length
    ? candidates.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest)
    : null;
  return {
    ...(userId ? { userId } : {}),
    miniProgramLastSeenAt,
    webLastSeenAt,
    wecomLastSeenAt,
    lastSeenAt,
  };
}

function activityStub(env, userId) {
  if (!isActivityReady(env)) {
    throw new HttpError(503, 'ACTIVITY_NOT_CONFIGURED', 'Activity storage is not configured');
  }
  return env.MEMBER_ACTIVITIES.getByName(`activity:${userId}`);
}

async function reportActivity(env, userId, channel, occurredAt) {
  const result = await activityStub(env, userId).report(channel, occurredAt);
  return activityDto(userId, result);
}

async function resolveCurrentLifeSpaceUser(request, env) {
  const authorization = request.headers.get('authorization')?.trim();
  if (!authorization?.startsWith('Bearer ') || authorization.slice(7).trim().length < 10) {
    throw new HttpError(401, 'UNAUTHORIZED', 'LifeSpace user bearer is required');
  }
  const response = await fetch(`${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}/api/v1/me`, {
    headers: {
      accept: 'application/json',
      authorization,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(response.status, payload?.error?.code || 'UNAUTHORIZED', payload?.error?.message || 'LifeSpace user bearer is not accepted');
    }
    throw new HttpError(502, 'LIFESPACE_PROFILE_FAILED', 'LifeSpace 身份服务暂时不可用');
  }
  return validateUserId(payload?.data?.id);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function constantTimeSecretEqual(left, right) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function requireActivitySecret(request, env) {
  const expected = typeof env.ACTIVITY_API_SECRET === 'string' ? env.ACTIVITY_API_SECRET.trim() : '';
  if (expected.length < 32) {
    throw new HttpError(503, 'ACTIVITY_API_NOT_CONFIGURED', 'External Activity API is not configured');
  }
  const authorization = request.headers.get('authorization')?.trim() || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!supplied || !(await constantTimeSecretEqual(supplied, expected))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Activity API bearer is required');
  }
}

async function reportOwnActivity(request, env) {
  const input = await readJson(request);
  if (Object.keys(input).some(key => key !== 'channel')) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request must contain only channel');
  }
  const channel = validateActivityChannel(input.channel, FIRST_PARTY_ACTIVITY_CHANNELS);
  const userId = await resolveCurrentLifeSpaceUser(request, env);
  await reportActivity(env, userId, channel, new Date().toISOString());
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

async function reportExternalActivity(request, env) {
  await requireActivitySecret(request, env);
  const input = await readJson(request);
  if (Object.keys(input).some(key => !['userId', 'channel', 'occurredAt'].includes(key))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  }
  const userId = validateUserId(input.userId);
  const channel = validateActivityChannel(input.channel);
  const occurredAt = normalizeOccurredAt(input.occurredAt);
  const activity = await reportActivity(env, userId, channel, occurredAt);
  return json({ data: activity });
}

async function queryActivity(request, env, url) {
  await requireActivitySecret(request, env);
  const raw = url.searchParams.get('userIds') || '';
  const requested = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (requested.length === 0 || requested.length > MAX_ACTIVITY_QUERY_USERS) {
    throw new HttpError(400, 'INVALID_REQUEST', `userIds must contain 1-${MAX_ACTIVITY_QUERY_USERS} user IDs`);
  }
  const userIds = [...new Set(requested.map(validateUserId))];
  const activities = await Promise.all(userIds.map(async (userId) => {
    const state = await activityStub(env, userId).getActivity();
    return activityDto(userId, state);
  }));
  return json({ data: { activities } });
}

async function registerFamilyCatalog(request, env) {
  requireInternalFamilyCatalogRequest(request);
  const input = await readJson(request);
  if (Object.keys(input).some(key => !['spaceId', 'source'].includes(key))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  }
  const spaceId = validateFamilySpaceId(input.spaceId);
  const source = typeof input.source === 'string' && input.source.trim() ? input.source.trim().slice(0, 80) : 'runtime';
  const entry = await familyCatalogStub(env).register(spaceId, source);
  return json({ data: entry });
}

async function reconcileFamilyCatalog(request, env) {
  requireInternalFamilyCatalogRequest(request);
  const input = await readJson(request);
  if (Object.keys(input).some(key => key !== 'spaceIds')) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  }
  const spaceIds = validateFamilySpaceIds(input.spaceIds);
  const familySpaceIds = await familyCatalogStub(env).filter(spaceIds);
  return json({ data: { familySpaceIds } });
}

async function importFamilyCatalog(request, env) {
  requireInternalFamilyCatalogRequest(request);
  const input = await readJson(request);
  if (Object.keys(input).some(key => !['spaceIds'].includes(key))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  }
  const spaceIds = validateFamilySpaceIds(input.spaceIds);
  const result = await familyCatalogStub(env).registerMany(spaceIds, 'operator-import');
  return json({ data: result });
}

async function familyCatalogStatus(request, env) {
  requireInternalFamilyCatalogRequest(request);
  return json({ data: await familyCatalogStub(env).status() });
}

async function commitFamilyJoin(request, env) {
  requireInternalFamilyCatalogRequest(request);
  const authorization = request.headers.get('authorization')?.trim() || '';
  if (!authorization.startsWith('Bearer ') || authorization.slice(7).trim().length < 10) {
    throw new HttpError(401, 'UNAUTHORIZED', 'LifeSpace user bearer is required');
  }
  const input = await readJson(request);
  if (Object.keys(input).some(key => !['familyId', 'token', 'displayName'].includes(key))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  }
  const familyId = validateFamilySpaceId(input.familyId);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (!token || token.length > 200 || !displayName || displayName.length > 100) {
    throw new HttpError(422, 'INVALID_REQUEST', 'Family join input is invalid');
  }
  const result = await familyJoinCoordinatorStub(env, familyId).commit({
    familyId,
    token,
    authorization,
    displayName,
  });
  return json(result.payload, result.status);
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
          activityReady: isActivityReady(env),
          externalActivityReady: isExternalActivityReady(env),
          familyCatalogReady: isFamilyCatalogReady(env),
          identityBootstrapConfigured: Boolean(env.WECHAT_IDENTITY_BOOTSTRAP_MAP),
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/login/wechat') return await login(request, env);
      if (request.method === 'POST' && url.pathname === '/api/v1/activity/me') return await reportOwnActivity(request, env);
      if (request.method === 'POST' && url.pathname === '/api/v1/activity/report') return await reportExternalActivity(request, env);
      if (request.method === 'GET' && url.pathname === '/api/v1/activity') return await queryActivity(request, env, url);
      if (request.method === 'POST' && url.pathname === '/internal/v1/family-catalog/register') return await registerFamilyCatalog(request, env);
      if (request.method === 'POST' && url.pathname === '/internal/v1/family-catalog/reconcile') return await reconcileFamilyCatalog(request, env);
      if (request.method === 'POST' && url.pathname === '/internal/v1/family-catalog/import') return await importFamilyCatalog(request, env);
      if (request.method === 'GET' && url.pathname === '/internal/v1/family-catalog/status') return await familyCatalogStatus(request, env);
      if (request.method === 'POST' && url.pathname === '/internal/v1/family-joins/commit') return await commitFamilyJoin(request, env);
      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
      console.error('[HomeMew backend] unhandled error', error instanceof Error ? error.message : 'unknown');
      return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }, 500);
    }
  },
};
