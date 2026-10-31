/**
 * HomeMew-owned WeChat Mini Program code provider.
 *
 * Only the internal Service Binding can call this operation; the caller BFF
 * must already authorize the LifeSpace invitation and issuing user.
 * No household facts, plaintext invitation or generated images are persisted.
 */
const SCENE = /^[A-Za-z0-9!#$&'()*+,\/:;=?@._~-]{1,32}$/u;
const ENV_VERSIONS = new Set(['develop', 'trial', 'release']);
const JOIN_PAGE = 'pages/family/join';
const MAX_IMAGE_BYTES = 512 * 1024;
const TOKEN_SAFETY_SECONDS = 180;

let cachedToken = '';
let validUntil = 0;
let pendingToken = null;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function fail(status, code, message) {
  return json({ error: { code, message } }, status);
}

function bytesToBase64(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 16384) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  }
  return btoa(chunks.join(''));
}

async function accessToken(env, fetcher, force = false) {
  const appId = env.WECHAT_APP_ID?.trim();
  const appSecret = env.WECHAT_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error('WECHAT_NOT_CONFIGURED');
  if (!force && cachedToken && Date.now() < validUntil) return cachedToken;
  if (pendingToken) return pendingToken;

  pendingToken = (async () => {
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);
    const response = await fetcher(url.toString(), { method: 'GET' });
    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.access_token !== 'string' || !result.access_token
      || !Number.isFinite(result.expires_in) || result.expires_in <= TOKEN_SAFETY_SECONDS) {
      throw new Error('WECHAT_ACCESS_TOKEN_FAILED');
    }
    cachedToken = result.access_token;
    validUntil = Date.now() + (result.expires_in - TOKEN_SAFETY_SECONDS) * 1000;
    return cachedToken;
  })().finally(() => { pendingToken = null; });
  return pendingToken;
}

async function imageFromWechat(scene, version, env, fetcher, retry = true) {
  const token = await accessToken(env, fetcher);
  const url = new URL('https://api.weixin.qq.com/wxa/getwxacodeunlimit');
  url.searchParams.set('access_token', token);
  const response = await fetcher(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'image/png, image/jpeg, application/json' },
    body: JSON.stringify({
      scene,
      page: JOIN_PAGE,
      check_path: false,
      env_version: version,
      width: 430,
      is_hyaline: false,
    }),
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (contentType.includes('json')) {
    const error = await response.json().catch(() => null);
    if (retry && [40001, 40014, 42001].includes(error?.errcode)) {
      cachedToken = '';
      validUntil = 0;
      await accessToken(env, fetcher, true);
      return imageFromWechat(scene, version, env, fetcher, false);
    }
    const errcode = error?.errcode;
    if (errcode === 41030 || errcode === 40129) throw new Error('WECHAT_MINI_CODE_PATH_REJECTED');
    throw new Error('WECHAT_MINI_CODE_FAILED');
  }
  if (!response.ok || (!contentType.includes('image/png') && !contentType.includes('image/jpeg'))) {
    throw new Error('WECHAT_MINI_CODE_FAILED');
  }
  // A bounded image prevents malicious/invalid upstream bodies from filling memory.
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error('WECHAT_MINI_CODE_FAILED');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('WECHAT_MINI_CODE_FAILED');
  }
  const mimeType = contentType.includes('image/jpeg') ? 'image/jpeg' : 'image/png';
  const looksPng = data.length > 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71;
  const looksJpeg = data.length > 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!(mimeType === 'image/png' ? looksPng : looksJpeg)) throw new Error('WECHAT_MINI_CODE_FAILED');
  return { mimeType, imageBase64: bytesToBase64(data), envVersion: version };
}

export async function handleInternalWechatInviteCode(request, env, { fetcher = fetch } = {}) {
  if (request.method !== 'POST' || new URL(request.url).hostname !== 'homemew-backend.internal') {
    return fail(404, 'NOT_FOUND', 'Not found');
  }
  let input;
  try { input = await request.json(); } catch { return fail(400, 'INVALID_REQUEST', 'Invalid JSON body'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['scene', 'envVersion'].includes(key))) {
    return fail(400, 'INVALID_REQUEST', 'Unsupported mini-code input');
  }
  if (typeof input.scene !== 'string' || !SCENE.test(input.scene)
    || !ENV_VERSIONS.has(input.envVersion)) {
    return fail(422, 'VALIDATION_ERROR', 'Invalid scene or mini-program version');
  }
  try {
    return json({ data: await imageFromWechat(input.scene, input.envVersion, env, fetcher) }, 200);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'WECHAT_NOT_CONFIGURED') {
      return fail(503, 'WECHAT_NOT_CONFIGURED', '微信小程序凭证尚未配置');
    }
    if (reason === 'WECHAT_MINI_CODE_PATH_REJECTED') {
      return fail(422, 'WECHAT_MINI_CODE_UNAVAILABLE', '微信拒绝此版本的小程序码，请检查发布状态和体验资格');
    }
    return fail(502, 'WECHAT_MINI_CODE_FAILED', '微信小程序码生成失败，请稍后重试');
  }
}
