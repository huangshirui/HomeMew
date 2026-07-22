// @ts-nocheck
/**
 * HomeMew 登录云函数
 *
 * 流程：
 * 1. 从云函数上下文获取可信 openid（OPENID，由 wx.cloud.callFunction 自动注入）
 * 2. 查询云数据库中的身份映射 (openid → homemew_user_id)
 * 3. 如果不存在映射，调用 Core POST /api/v1/internal/users 创建用户
 * 4. 保存/更新身份映射
 * 5. 使用 JWT_SECRET 签发短期用户 JWT（有效期 1 小时）
 * 6. 返回 { accessToken, expiresAt, isNewUser, coreApiUrl }
 *
 * 环境变量（在云开发控制台配置）：
 * - CORE_API_URL: Core API 基础地址（同时回传给前端，避免客户端硬编码）
 * - JWT_SECRET: JWT 签名密钥（与 Cloudflare Worker 中配置完全一致，HS256 共用）
 *
 * 注意：不再需要配置 INTERNAL_TOKEN。登录云函数持有 JWT_SECRET，
 * 会在首次创建 HomeMew 用户时动态签发一个短期 internal JWT
 *（5 分钟有效，用完即丢弃，绝不返回给小程序）。
 */

const cloud = require('wx-server-sdk');
const jwt = require('jsonwebtoken');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

/** Core API 基础地址（服务端使用，并回传给前端） */
const CORE_API_URL = process.env.CORE_API_URL || 'https://homemew.aisr.online';

const db = cloud.database();
const _ = db.command;

/** JWT 有效期（小时） */
const TOKEN_EXPIRE_HOURS = 1;

/** 内部服务 Token 有效期（分钟），用于调用 Core 内部接口，用完即丢弃 */
const INTERNAL_TOKEN_EXPIRE_MINUTES = 5;

/** 身份映射集合名称 */
const MAPPING_COLLECTION = 'identity_mappings';

/**
 * 确保身份映射集合存在。
 * 云开发数据库不会自动建表，首次调用时若集合不存在会报
 * -502005 DATABASE_COLLECTION_NOT_EXIST。这里在查询前尝试创建，
 * 已存在时忽略冲突错误，保证首次部署也能直接用。
 */
async function ensureMappingCollection() {
  if (typeof db.createCollection !== 'function') {
    // 当前 wx-server-sdk 版本未暴露 createCollection，跳过自动建表
    return;
  }
  try {
    await db.createCollection(MAPPING_COLLECTION);
    console.log('[Login] Created collection:', MAPPING_COLLECTION);
  } catch (e) {
    const msg = (e && e.message) || '';
    // 集合已存在或已被创建属于正常情况，忽略
    if (/already|exist|conflict|ResourceExist/i.test(msg)) {
      return;
    }
    // 其它错误（如权限不足）仅告警，交由后续查询再暴露明确错误
    console.warn('[Login] ensureMappingCollection warning:', msg);
  }
}

exports.main = async (event, context) => {
  try {
    // Step 1: 从云函数调用上下文直接获取可信 openid
    // 小程序端 wx.cloud.callFunction 调用时会自动注入调用者 OPENID，
    // 无需再用 wx.login 的 code 去调 cloud.openapi.jscode2Session 换取，
    // 因此也不会触发 errCode: -604100（API not found / 未声明 openapi 权限）。
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;

    if (!openid) {
      console.error('[Login] Failed to get openid from WX context:', wxContext);
      return { error: { code: 'WECHAT_LOGIN_FAILED', message: '无法获取微信身份' } };
    }

    console.log('[Login] Got openid:', openid.substring(0, 10) + '...');

    // Step 2: 确保身份映射集合存在（首次部署时云数据库可能还没有建表）
    const mappingCollection = db.collection(MAPPING_COLLECTION);
    await ensureMappingCollection();

    // Step 2: 查询身份映射
    const mappingRes = await mappingCollection.where({ openid }).limit(1).get();
    const existingMapping = mappingRes.data.length > 0 ? mappingRes.data[0] : null;

    let userId = existingMapping?.homemewUserId;
    let isNewUser = false;

    // Step 3: 如果没有映射，创建 Core 用户
    if (!userId) {
      console.log('[Login] No existing mapping, creating new user...');
      userId = await createCoreUser(openid);
      isNewUser = true;

      // Step 4: 保存身份映射
      await mappingCollection.add({
        data: {
          openid,
          homemewUserId: userId,
          provider: 'wechat_miniprogram',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      console.log('[Login] New user created and mapped:', userId);
    } else {
      console.log('[Login] Existing user found:', userId);

      // 更新最后登录时间
      await mappingCollection.doc(existingMapping._id).update({
        data: {
          updatedAt: new Date().toISOString(),
        },
      });
    }

    // Step 5: 签发 JWT
    const token = signJwt(userId);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();

    console.log('[Login] Login success for user:', userId, 'isNewUser:', isNewUser);

    return {
      accessToken: token,
      expiresAt,
      isNewUser,
      coreApiUrl: CORE_API_URL,
    };

  } catch (error) {
    console.error('[Login] Error:', error);
    return {
      error: {
        code: 'LOGIN_ERROR',
        message: error.message || '登录过程出错',
      },
    };
  }
};

/**
 * 调用 Core API 创建内部用户
 */
async function createCoreUser(openid) {
  // 动态签发短期 internal JWT，不再依赖静态 INTERNAL_TOKEN 环境变量
  const internalToken = signInternalJwt();

  // 生成默认显示名：微信用户 + openid 前 6 位
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

  // 如果返回冲突（可能已存在），尝试通过其他方式查找
  console.error('[Login] Create user failed:', statusCode, data);
  throw new Error(`创建用户失败: ${data?.error?.message || '未知错误'}`);
}

/**
 * 以 Node 原生 https 模块调用 Core API。
 *
 * wx.request 是小程序端 API，在云函数运行环境不可用；
 * 这里使用云函数环境原生支持的 https 模块，无需额外依赖。
 *
 * @param {object} opts
 * @param {string} opts.method HTTP 方法
 * @param {string} opts.path  Core 相对路径，例如 /api/v1/internal/users
 * @param {string} [opts.token] Bearer 令牌（内部接口用短期 internal JWT，普通接口用用户 JWT）
 * @param {object} [opts.body] JSON 请求体
 * @returns {Promise<{ statusCode: number, data: any }>}
 */
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
    options.headers['Authorization'] = `Bearer ${token}`;
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

/**
 * 签发 HomeMew 用户 JWT
 */
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
 * 签发短期 internal JWT，用于调用 Core 内部接口（如创建用户）。
 * 该 Token 仅服务端使用，绝不返回给小程序。
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
      type: 'internal',
      iss: 'homemew-identity',
      aud: 'homemew-core',
      iat: now,
      exp: now + INTERNAL_TOKEN_EXPIRE_MINUTES * 60,
      jti: `int_${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
    },
    jwtSecret,
    { algorithm: 'HS256' },
  );
}
