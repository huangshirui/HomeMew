// @ts-nocheck
/**
 * HomeMew 登录云函数
 *
 * 默认生产路径保持现状：
 *   trusted openid -> homemewUserId -> HomeMew HS256 JWT -> HomeMew Core
 *
 * Phase 4 staging-only 路径必须显式启用：
 *   AUTH_BACKEND=lifespace-staging
 *   trusted openid -> lifespaceUserId -> LifeSpace Identity lsa_* exchange
 *   -> short-lived RS256 app-scoped user token -> LifeSpace Core staging
 *
 * 微信 openid 始终由 HomeMew 云函数拥有和解析；LifeSpace Identity 不存储 provider identity。
 * legacy homemewUserId 与 staging lifespaceUserId 并存在同一 identity_mappings 文档中，
 * staging 试迁不会覆盖当前 HomeMew 生产身份映射。
 *
 * Legacy 环境变量：
 * - CORE_API_URL: HomeMew Core API 基础地址
 * - JWT_SECRET: HomeMew HS256 签名密钥
 *
 * LifeSpace staging 环境变量：
 * - AUTH_BACKEND=lifespace-staging
 * - LIFESPACE_APPLICATION_CREDENTIAL: server-only lsa_*，绝不返回给小程序
 * - LIFESPACE_IDENTITY_URL=https://auth-staging.aisr.online（可省略）
 * - LIFESPACE_CORE_URL=https://core-staging.aisr.online（可省略）
 */

const cloud = require('wx-server-sdk');
const jwt = require('jsonwebtoken');
const https = require('https');
const { resolveIdentity } = require('./identity');
const {
  DEFAULT_IDENTITY_URL,
  DEFAULT_CORE_URL,
  createLifeSpaceIdentityClient,
} = require('./lifespace');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const AUTH_BACKEND = process.env.AUTH_BACKEND || 'homemew';
/** Legacy HomeMew Core API 基础地址（默认路径仍使用，并回传给前端） */
const CORE_API_URL = process.env.CORE_API_URL || 'https://homemew.aisr.online';

const db = cloud.database();

/** JWT 有效期（小时） */
const TOKEN_EXPIRE_HOURS = 1;

/** 内部服务 Token 有效期（分钟），用于调用 legacy HomeMew Core 内部接口 */
const INTERNAL_TOKEN_EXPIRE_MINUTES = 5;

/** 身份映射集合名称 */
const MAPPING_COLLECTION = 'identity_mappings';

function lifeSpaceStagingConfig() {
  const identityBaseUrl = process.env.LIFESPACE_IDENTITY_URL || DEFAULT_IDENTITY_URL;
  const coreBaseUrl = process.env.LIFESPACE_CORE_URL || DEFAULT_CORE_URL;
  const identityHost = new URL(identityBaseUrl).hostname;
  const coreHost = new URL(coreBaseUrl).hostname;
  if (identityHost !== 'auth-staging.aisr.online' || coreHost !== 'core-staging.aisr.online') {
    throw new Error('lifespace-staging 模式只允许连接 LifeSpace staging 域名');
  }
  return {
    applicationCredential: process.env.LIFESPACE_APPLICATION_CREDENTIAL,
    identityBaseUrl,
    coreBaseUrl,
  };
}

/**
 * 确保身份映射集合存在。
 * 云开发数据库不会自动建表，首次调用时若集合不存在会报
 * -502005 DATABASE_COLLECTION_NOT_EXIST。这里在查询前尝试创建，
 * 已存在时忽略冲突错误，保证首次部署也能直接用。
 */
async function ensureMappingCollection() {
  if (typeof db.createCollection !== 'function') {
    return;
  }
  try {
    await db.createCollection(MAPPING_COLLECTION);
    console.log('[Login] Created collection:', MAPPING_COLLECTION);
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/already|exist|conflict|ResourceExist/i.test(msg)) {
      return;
    }
    console.warn('[Login] ensureMappingCollection warning:', msg);
  }
}

exports.main = async (event, context) => {
  try {
    if (!['homemew', 'lifespace-staging'].includes(AUTH_BACKEND)) {
      throw new Error(`不支持的 AUTH_BACKEND: ${AUTH_BACKEND}`);
    }

    // Step 1: 从云函数调用上下文直接获取可信 openid。
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;

    if (!openid) {
      console.error('[Login] Failed to get openid from WX context:', wxContext);
      return { error: { code: 'WECHAT_LOGIN_FAILED', message: '无法获取微信身份' } };
    }

    console.log('[Login] Got trusted WeChat identity');

    // Step 2: 查询/复用同一个 openid mapping 文档。
    const mappingCollection = db.collection(MAPPING_COLLECTION);
    await ensureMappingCollection();
    const mappingRes = await mappingCollection.where({ openid }).limit(1).get();
    const existingMapping = mappingRes.data.length > 0 ? mappingRes.data[0] : null;

    if (AUTH_BACKEND === 'lifespace-staging') {
      return loginWithLifeSpaceStaging({ openid, existingMapping, mappingCollection });
    }

    return loginWithHomeMew({ openid, existingMapping, mappingCollection });
  } catch (error) {
    console.error('[Login] Error:', {
      code: error?.code,
      statusCode: error?.statusCode,
      message: error?.message,
    });
    return {
      error: {
        code: 'LOGIN_ERROR',
        message: error.message || '登录过程出错',
      },
    };
  }
};

async function loginWithLifeSpaceStaging({ openid, existingMapping, mappingCollection }) {
  const client = createLifeSpaceIdentityClient(lifeSpaceStagingConfig());
  let issuedToken = null;

  const identity = await resolveIdentity({
    openid,
    existingMapping,
    mappingField: 'lifespaceUserId',
    verifyUser: async userId => {
      // Any Identity denial is authoritative. Never interpret disabled/denied users as
      // "missing" and silently create a replacement LifeSpace identity.
      issuedToken = await client.issueUserToken(userId);
      return true;
    },
    createUser: userOpenid => client.createUser(userOpenid),
    addMapping: data => mappingCollection.add({ data }),
    updateMapping: ({ mappingId, data }) => mappingCollection.doc(mappingId).update({ data }),
  });

  if (!issuedToken) issuedToken = await client.issueUserToken(identity.userId);
  const expiresAt = new Date(Date.now() + issuedToken.expiresIn * 1000).toISOString();

  console.log('[Login] LifeSpace staging login success:', {
    userId: identity.userId,
    isNewUser: identity.isNewUser,
  });

  return {
    accessToken: issuedToken.accessToken,
    expiresAt,
    isNewUser: identity.isNewUser,
    coreApiUrl: client.coreBaseUrl,
  };
}

async function loginWithHomeMew({ openid, existingMapping, mappingCollection }) {
  const identity = await resolveIdentity({
    openid,
    existingMapping,
    verifyUser: verifyCoreUser,
    createUser: createCoreUser,
    addMapping: data => mappingCollection.add({ data }),
    updateMapping: ({ mappingId, data }) => mappingCollection.doc(mappingId).update({ data }),
  });
  const { userId, isNewUser } = identity;

  const token = signJwt(userId);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();

  console.log('[Login] HomeMew login success:', { userId, isNewUser });

  return {
    accessToken: token,
    expiresAt,
    isNewUser,
    coreApiUrl: CORE_API_URL,
  };
}

/** Legacy HomeMew user verification. */
async function verifyCoreUser(userId) {
  const { statusCode, data } = await requestCore({
    method: 'GET',
    path: '/api/v1/me',
    token: signJwt(userId),
  });
  if (statusCode === 200) return true;
  if (statusCode === 404 && data?.error?.code === 'USER_NOT_FOUND') return false;

  const error = new Error(data?.error?.message || `Core user verification failed (${statusCode})`);
  error.code = data?.error?.code || 'CORE_USER_VERIFICATION_FAILED';
  error.statusCode = statusCode;
  throw error;
}

/** Legacy HomeMew Core user creation. */
async function createCoreUser(openid) {
  const internalToken = signInternalJwt();
  const defaultDisplayName = `微信用户${openid.substring(0, 6)}`;

  const { statusCode, data } = await requestCore({
    method: 'POST',
    path: '/api/v1/internal/users',
    token: internalToken,
    body: {
      displayName: defaultDisplayName,
      createdFrom: 'wechat_miniprogram',
    },
  });

  if (statusCode === 201 && data?.data?.id) {
    return data.data.id;
  }

  console.error('[Login] Create legacy HomeMew user failed:', statusCode, data?.error?.code);
  throw new Error(`创建用户失败: ${data?.error?.message || '未知错误'}`);
}

/** Node 原生 https 调用 legacy HomeMew Core。 */
function requestCore({ method, path, token, body }) {
  const url = new URL(`${CORE_API_URL}${path}`);
  const payload = body ? JSON.stringify(body) : null;

  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 10000,
  };

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }
  if (payload) {
    options.headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (e) {
          parsed = raw;
        }
        resolve({ statusCode: res.statusCode, data: parsed });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Core API 请求超时'));
    });
    req.on('error', (err) => reject(err));

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/** 签发 legacy HomeMew 用户 JWT。 */
function signJwt(userId) {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('未配置 JWT_SECRET');
  }

  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      sub: userId,
      type: 'user',
      client_id: 'wechat-miniprogram',
      iss: 'homemew-identity',
      aud: 'homemew-core',
      iat: now,
      exp: now + TOKEN_EXPIRE_HOURS * 60 * 60,
      jti: `tok_${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
    },
    jwtSecret,
    { algorithm: 'HS256' },
  );
}

/**
 * 签发短期 legacy HomeMew internal JWT，仅服务端使用。
 */
function signInternalJwt() {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('未配置 JWT_SECRET');
  }

  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      sub: 'identity-service',
      scope: 'internal',
      type: 'service',
      iss: 'homemew-identity',
      aud: 'homemew-core-internal',
      iat: now,
      exp: now + INTERNAL_TOKEN_EXPIRE_MINUTES * 60,
      jti: `int_${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
    },
    jwtSecret,
    { algorithm: 'HS256' },
  );
}
