import assert from 'node:assert/strict';
import test from 'node:test';
import { handleInternalWechatInviteCode } from './wechat-mini-code.mjs';

const TARGET = 'https://homemew-backend.internal/internal/v1/wechat/invite-mini-code';
const valid = { scene: 'LS-QPFJ-XH5V-EYRS-TNUC', envVersion: 'trial' };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
function req(body = valid, url = TARGET) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('mini-code route rejects public host, invalid scene and arbitrary pages before contacting WeChat', async () => {
  const env = { WECHAT_APP_ID: 'appid', WECHAT_APP_SECRET: 'secret' };
  const fetcher = async () => assert.fail('must not contact WeChat');
  assert.equal((await handleInternalWechatInviteCode(req(valid, 'https://attacker.test/internal/v1/wechat/invite-mini-code'), env, { fetcher })).status, 404);
  assert.equal((await handleInternalWechatInviteCode(req({ scene: '../evil', envVersion: 'trial' }), env, { fetcher })).status, 422);
  assert.equal((await handleInternalWechatInviteCode(req({ ...valid, page: 'pages/admin' }), env, { fetcher })).status, 400);
  assert.equal((await handleInternalWechatInviteCode(req({ ...valid, envVersion: 'unknown' }), env, { fetcher })).status, 422);
  assert.equal((await handleInternalWechatInviteCode(req({ scene: 'x'.repeat(33), envVersion: 'trial' }), env, { fetcher })).status, 422);
});

test('mini-code exchanges server-side credentials and generates fixed join-page image', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/cgi-bin/token')) return Response.json({ access_token: 'test_token', expires_in: 7200 });
    if (String(url).includes('/getwxacodeunlimit')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    return assert.fail('unexpected WeChat API');
  };
  const response = await handleInternalWechatInviteCode(req(), { WECHAT_APP_ID: 'appid', WECHAT_APP_SECRET: 'secret' }, { fetcher });
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.imageBase64, Buffer.from(png).toString('base64'));
  assert.equal(result.envVersion, 'trial');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /appid=appid/u);
  assert.match(calls[0].url, /secret=secret/u);
  const payload = JSON.parse(calls[1].init.body);
  assert.deepEqual(payload, {
    scene: 'LS-QPFJ-XH5V-EYRS-TNUC',
    page: 'pages/family/join',
    check_path: false,
    env_version: 'trial',
    width: 430,
    is_hyaline: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /test_token|secret/u);
});

test('WeChat errors never leak provider access token or credentials', async () => {
  const fetcher = async url => {
    if (String(url).includes('/cgi-bin/token')) return Response.json({ access_token: 'test_token', expires_in: 7200 });
    return Response.json({ errcode: 41030, errmsg: 'invalid page info' });
  };
  const response = await handleInternalWechatInviteCode(req(), { WECHAT_APP_ID: 'appid', WECHAT_APP_SECRET: 'secret' }, { fetcher });
  assert.equal(response.status, 422);
  const result = await response.text();
  assert.match(result, /WECHAT_MINI_CODE_UNAVAILABLE/u);
  assert.doesNotMatch(result, /test_token|secret|invalid page info/u);
});
