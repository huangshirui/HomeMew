/**
 * HomeMew 小程序纯函数单元测试。
 *
 * 运行方式（不修改 monorepo 根配置，零依赖）：
 *   cd apps/miniprogram
 *   node --experimental-strip-types tests/unit.test.ts
 *
 * 这些模块都是自包含的（无 wx / 无相对扩展名导入），可在 Node 直接运行。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { evaluateToken, normalizeBaseUrl, generateRequestId } from '../miniprogram/services/config.ts';
import { shouldAutoRetry, extractData } from '../miniprogram/services/request-utils.ts';
import { getErrorMessage, ERROR_MESSAGES } from '../miniprogram/utils/errors.ts';
import { resolveCurrentFamily } from '../miniprogram/stores/family-state.ts';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const SOON = new Date(Date.now() + 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

// ============ 1. 204 响应处理 ============
test('extractData: 204 返回 undefined', () => {
  assert.equal(extractData(204, ''), undefined);
  assert.equal(extractData(204, '{}'), undefined);
});

test('extractData: 2xx 解析 data 信封', () => {
  assert.deepEqual(extractData(200, { data: { id: 1 } }), { id: 1 });
});

// ============ 2. GET 401 后重试一次 ============
test('shouldAutoRetry: GET 允许重试', () => {
  assert.equal(shouldAutoRetry('GET', false), true);
});

test('shouldAutoRetry: 写请求不重试', () => {
  assert.equal(shouldAutoRetry('POST', false), false);
  assert.equal(shouldAutoRetry('PATCH', false), false);
  assert.equal(shouldAutoRetry('DELETE', false), false);
});

test('shouldAutoRetry: 显式 skipRetry 不重试', () => {
  assert.equal(shouldAutoRetry('GET', true), false);
});

// ============ 3. 缺少 expiresAt 时 Token 无效 ============
test('evaluateToken: 无 token 无效', () => {
  assert.equal(evaluateToken(null, FUTURE), false);
  assert.equal(evaluateToken('', FUTURE), false);
});

test('evaluateToken: 无 expiresAt 无效', () => {
  assert.equal(evaluateToken('t', undefined), false);
  assert.equal(evaluateToken('t', null), false);
  assert.equal(evaluateToken('t', ''), false);
});

test('evaluateToken: 无法解析的 expiresAt 无效', () => {
  assert.equal(evaluateToken('t', 'not-a-date'), false);
});

test('evaluateToken: 已过期无效', () => {
  assert.equal(evaluateToken('t', PAST), false);
});

test('evaluateToken: 距过期不足 5 分钟无效（缓冲）', () => {
  assert.equal(evaluateToken('t', SOON), false);
});

test('evaluateToken: 充足有效期有效', () => {
  assert.equal(evaluateToken('t', FUTURE), true);
});

// ============ 4. 当前家庭恢复规则 ============
const famA = { id: 'a', name: 'A', avatarUrl: null, role: 'admin' as const, memberCount: 1 };
const famB = { id: 'b', name: 'B', avatarUrl: null, role: 'member' as const, memberCount: 2 };

test('resolveCurrentFamily: 空列表返回 null 且需清除缓存', () => {
  const r = resolveCurrentFamily([], 'a');
  assert.equal(r.family, null);
  assert.equal(r.clearSaved, true);
});

test('resolveCurrentFamily: 缓存有效则恢复', () => {
  const r = resolveCurrentFamily([famA, famB], 'b');
  assert.equal(r.family?.id, 'b');
  assert.equal(r.clearSaved, false);
});

test('resolveCurrentFamily: 缓存失效选第一个并清除', () => {
  const r = resolveCurrentFamily([famA, famB], 'zzz');
  assert.equal(r.family?.id, 'a');
  assert.equal(r.clearSaved, true);
});

test('resolveCurrentFamily: 无缓存选第一个', () => {
  const r = resolveCurrentFamily([famA, famB], undefined);
  assert.equal(r.family?.id, 'a');
  assert.equal(r.clearSaved, true);
});

// ============ 5. 错误码中文映射 ============
const REQUIRED_CODES = [
  'UNAUTHORIZED', 'FORBIDDEN', 'USER_NOT_FOUND', 'USER_DISABLED',
  'FAMILY_NOT_FOUND', 'FAMILY_CREATE_LIMIT_REACHED', 'FAMILY_MEMBER_LIMIT_REACHED',
  'ALREADY_FAMILY_MEMBER', 'LAST_ADMIN_CANNOT_BE_REMOVED', 'CANNOT_REMOVE_SELF',
  'INVITE_NOT_FOUND', 'INVITE_REVOKED', 'INVITE_EXPIRED', 'INVITE_EXHAUSTED',
  'INVALID_REQUEST', 'NETWORK_ERROR', 'TIMEOUT',
];

test('ERROR_MESSAGES 覆盖全部必需错误码', () => {
  for (const code of REQUIRED_CODES) {
    assert.ok(ERROR_MESSAGES[code], `缺少错误码映射: ${code}`);
  }
});

test('getErrorMessage: 已知 code 返回映射文案', () => {
  assert.equal(getErrorMessage('USER_DISABLED', 'disabled'), ERROR_MESSAGES['USER_DISABLED']);
  assert.equal(
    getErrorMessage('FAMILY_MEMBER_LIMIT_REACHED', ''),
    ERROR_MESSAGES['FAMILY_MEMBER_LIMIT_REACHED'],
  );
});

test('getErrorMessage: 未知 code 回退到 Core message（ASCII 入参避免编码歧义）', () => {
  assert.equal(getErrorMessage('STRANGE_CODE', 'RAW_MESSAGE'), 'RAW_MESSAGE');
});

test('getErrorMessage: 未知 code 且无 message 返回非空通用文案', () => {
  const msg = getErrorMessage('STRANGE_CODE', undefined);
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
  assert.notEqual(msg, 'STRANGE_CODE');
});

// ============ 6. URL / requestId 工具 ============
test('normalizeBaseUrl: 去除末尾斜杠', () => {
  assert.equal(normalizeBaseUrl('https://x.com/'), 'https://x.com');
  assert.equal(normalizeBaseUrl('https://x.com///'), 'https://x.com');
  assert.equal(normalizeBaseUrl('https://x.com'), 'https://x.com');
});

test('generateRequestId: 返回非空字符串', () => {
  assert.equal(typeof generateRequestId(), 'string');
  assert.ok(generateRequestId().length > 0);
});

// ============ 7. 所有跳转页面已在 app.json 注册且文件存在 ============
const appJsonPath = path.resolve(import.meta.dirname, '../miniprogram/app.json');
const appJson = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
const REQUIRED_PAGES = [
  'pages/launch/launch',
  'pages/launch/disabled',
  'pages/profile-setup/profile-setup',
  'pages/home/home',
  'pages/profile/profile',
  'pages/family/join',
  'pages/family/detail',
  'pages/family/members',
  'pages/family/invites',
];

test('app.json 注册了所有必需页面', () => {
  for (const p of REQUIRED_PAGES) {
    assert.ok(appJson.pages.includes(p), `app.json 缺少页面: ${p}`);
  }
});

test('已注册页面文件（.ts / .wxml）均存在', () => {
  for (const p of appJson.pages) {
    const tsFile = path.resolve(import.meta.dirname, '../miniprogram', `${p}.ts`);
    const wxmlFile = path.resolve(import.meta.dirname, '../miniprogram', `${p}.wxml`);
    assert.ok(existsSync(tsFile), `缺失页面脚本: ${p}.ts`);
    assert.ok(existsSync(wxmlFile), `缺失页面模板: ${p}.wxml`);
  }
});
