import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMiniProgramBff, matchMiniProgramBffRoute } from './miniprogram-bff.mjs';
import { forwardLifeSpace } from './miniprogram-upstream.mjs';

const TOKEN = 'Bearer user-token-1234567890';

function request(path, { method = 'GET', body, token = TOKEN, contentType = 'application/json' } = {}) {
  const headers = new Headers({ 'x-request-id': 'req_mini' });
  if (token) headers.set('authorization', token);
  if (body !== undefined && contentType) headers.set('content-type', contentType);
  return new Request(`https://homemew.example.test${path}`, { method, headers, body });
}

function service(handler) {
  return { fetch: handler };
}

test('matches only fixed profile, access-link, and avatar routes', () => {
  assert.deepEqual(matchMiniProgramBffRoute('/api/v1/miniprogram/me'), { kind: 'me' });
  assert.deepEqual(matchMiniProgramBffRoute('/api/v1/miniprogram/media/users/usr_123/avatar'), {
    kind: 'user-avatar-read', userId: 'usr_123',
  });
  assert.equal(matchMiniProgramBffRoute('/api/v1/miniprogram/proxy'), null);
  assert.equal(matchMiniProgramBffRoute('/api/v1/miniprogram/media/users/https:%2F%2Fevil/avatar'), null);
  assert.equal(matchMiniProgramBffRoute('/api/v1/miniprogram/families/not-a-space/avatar'), null);
});

test('unknown Mini routes fail closed before the Web application', async () => {
  const response = await handleMiniProgramBff(request('/api/v1/miniprogram/models/task/records'), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'BFF_ROUTE_NOT_FOUND');
});

test('profile uses the Identity binding, preserves authority/request ID, and rewrites avatar URLs', async () => {
  let captured;
  const env = {
    LIFESPACE_IDENTITY: service(async incoming => {
      captured = incoming;
      return new Response(JSON.stringify({
        data: { id: 'usr_123', displayName: 'Mew', avatarUrl: 'https://auth.example/assets/users/usr_123/avatar' },
      }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_identity' } });
    }),
  };
  const response = await handleMiniProgramBff(request('/api/v1/miniprogram/me'), env);
  assert.equal(new URL(captured.url).pathname, '/api/v1/me');
  assert.equal(captured.headers.get('authorization'), TOKEN);
  assert.equal(captured.headers.get('x-request-id'), 'req_mini');
  assert.equal(response.headers.get('x-request-id'), 'req_identity');
  assert.equal(
    (await response.json()).data.avatarUrl,
    'https://homemew.example.test/api/v1/miniprogram/media/users/usr_123/avatar',
  );
});

test('upstream error status and envelope are preserved without avatar rewriting', async () => {
  const env = {
    LIFESPACE_IDENTITY: service(async () => new Response(
      JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'conflict', requestId: 'req_conflict' } }),
      { status: 409, headers: { 'content-type': 'application/json', 'x-request-id': 'req_conflict' } },
    )),
  };
  const response = await handleMiniProgramBff(request('/api/v1/miniprogram/me', { method: 'PATCH', body: '{}' }), env);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: 'VERSION_CONFLICT', message: 'conflict', requestId: 'req_conflict' } });
  assert.equal(response.headers.get('x-request-id'), 'req_conflict');
});

test('access-link confirmation accepts only the fixed challenge shape', async () => {
  const challengeId = `alc_${'a'.repeat(64)}`;
  let pathname;
  const env = { LIFESPACE_IDENTITY: service(async incoming => {
    pathname = new URL(incoming.url).pathname;
    return new Response(null, { status: 204 });
  }) };
  const response = await handleMiniProgramBff(
    request(`/api/v1/miniprogram/me/access-link-challenges/${challengeId}/confirm`, { method: 'POST' }), env,
  );
  assert.equal(response.status, 204);
  assert.equal(pathname, `/api/v1/me/access-link-challenges/${challengeId}/confirm`);
});

test('public avatar reads use a fixed binding path, omit bearer, and preserve cache headers', async () => {
  let captured;
  const env = { LIFESPACE_CORE: service(async incoming => {
    captured = incoming;
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=60', etag: 'avatar-v1' },
    });
  }) };
  const response = await handleMiniProgramBff(
    request('/api/v1/miniprogram/media/families/spc_family/avatar', { token: '' }), env,
  );
  assert.equal(new URL(captured.url).pathname, '/assets/spaces/spc_family/avatar');
  assert.equal(captured.headers.has('authorization'), false);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(response.headers.get('etag'), 'avatar-v1');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test('multipart family avatar upload is byte-preserving and version-aware', async () => {
  const bytes = new Uint8Array([0, 255, 12, 34]);
  let captured;
  const env = { LIFESPACE_CORE: service(async incoming => {
    captured = incoming;
    return new Response(JSON.stringify({
      data: { avatarUrl: 'https://core.example/assets/spaces/spc_family/avatar', version: 4 },
    }), { headers: { 'content-type': 'application/json' } });
  }) };
  const response = await handleMiniProgramBff(request('/api/v1/miniprogram/families/spc_family/avatar', {
    method: 'PUT', body: bytes, contentType: 'multipart/form-data; boundary=HomeMew',
  }), env);
  assert.equal(captured.headers.get('content-type'), 'multipart/form-data; boundary=HomeMew');
  assert.deepEqual([...new Uint8Array(await captured.arrayBuffer())], [...bytes]);
  assert.equal((await response.json()).data.avatarUrl,
    'https://homemew.example.test/api/v1/miniprogram/media/families/spc_family/avatar');
});

test('missing bearer and missing bindings fail closed', async () => {
  const unauthorized = await handleMiniProgramBff(request('/api/v1/miniprogram/me', { token: '' }), {});
  assert.equal(unauthorized.status, 401);
  const unconfigured = await handleMiniProgramBff(request('/api/v1/miniprogram/me'), {});
  assert.equal(unconfigured.status, 503);
});

test('shared adapter rejects unsafe target/path configuration', async () => {
  const badTarget = await forwardLifeSpace(request('/ignored'), {}, { target: 'arbitrary', upstreamPath: '/api/v1/me' });
  const badPath = await forwardLifeSpace(request('/ignored'), {}, { target: 'core', upstreamPath: 'https://evil.example' });
  assert.equal(badTarget.status, 500);
  assert.equal(badPath.status, 500);
});

test('mailbox settings use only the fixed Identity binding and preserve write errors',async()=>{
  const env={LIFESPACE_IDENTITY:service(async incoming=>{
    assert.equal(new URL(incoming.url).pathname,'/api/v1/me/web-login');
    assert.equal(incoming.headers.get('authorization'),TOKEN);
    assert.equal(incoming.method,'PATCH');
    assert.deepEqual(await incoming.json(),{email:'me@example.com',version:2});
    return new Response(JSON.stringify({error:{code:'EMAIL_VERSION_CONFLICT',message:'reload',requestId:'req_email'}}),{status:409,headers:{'content-type':'application/json','x-request-id':'req_email'}});
  })};
  const response=await handleMiniProgramBff(request('/api/v1/miniprogram/me/web-login',{method:'PATCH',body:JSON.stringify({email:'me@example.com',version:2})}),env);
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,'EMAIL_VERSION_CONFLICT');
});
