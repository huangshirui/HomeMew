import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function readMini(relative: string): string {
  return readFileSync(new URL(`../miniprogram/${relative}`, import.meta.url), 'utf8');
}

function loadPage(path: string, globals: Record<string, unknown>) {
  let page: any;
  const source = readMini(`pages/family/${path}.ts`);
  const executable = stripTypeScriptTypes(
    source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm, ''),
  );
  runInNewContext(executable, {
    console: { error() {}, warn() {} },
    ...globals,
    Page: (definition: any) => { page = definition; },
  });
  page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch);
  return page;
}

function inviteFixture(expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()) {
  return {
    id: 'inv_test',
    code: 'LS-ABCD-EFGH-JKLM-NPQR',
    joinPath: '/pages/family/join?code=LS-ABCD-EFGH-JKLM-NPQR',
    expiresAt,
    maxUses: 3,
    usedCount: 0,
  };
}

function inviteHarness(overrides: Record<string, unknown> = {}) {
  const copied: string[] = [];
  const errors: string[] = [];
  const page = loadPage('invites', {
    copyToClipboard: async (value: string) => { copied.push(value); },
    showError: (message: string) => errors.push(message),
    formatDate: (value: string) => value,
    ...overrides,
  });
  return { page, copied, errors };
}

test('share card points to the HomeMew family join page; copy yields the bare code', async () => {
  const { page, copied } = inviteHarness();
  page.data.newInvite = inviteFixture();
  page.data.newInviteAvailable = true;
  const shared = page.onShareAppMessage();
  assert.equal(shared.path, '/pages/family/join?code=LS-ABCD-EFGH-JKLM-NPQR');
  assert.match(shared.title, /邀请你加入/);
  page.onCopyCode();
  await Promise.resolve();
  assert.deepEqual(copied, ['LS-ABCD-EFGH-JKLM-NPQR']);
  assert.equal(typeof page.onCopyPath, 'undefined');
});

test('no new invitation, expiry and revoked invitations cannot be copied or sent as invite cards', async () => {
  const { page, copied, errors } = inviteHarness({
    listInvites: async () => [{
      ...inviteFixture(),
      status: 'revoked',
      createdBy: 'usr_owner',
      createdAt: new Date().toISOString(),
    }],
  });
  assert.equal(page.onShareAppMessage().path, '/pages/home/home');
  page.onCopyCode();
  page.data.newInvite = inviteFixture();
  page.data.newInviteAvailable = true;
  page.data.familyId = 'spc_home';
  await page.loadInvites();
  assert.equal(page.data.newInviteAvailable, false);
  assert.equal(page.onShareAppMessage().path, '/pages/home/home');
  page.onCopyCode();
  assert.deepEqual(copied, []);
  assert.ok(errors.every(value => value.includes('已失效')));

  // A previously active invitation may expire while the page remains open.
  page.data.newInvite = inviteFixture(new Date(Date.now() - 1000).toISOString());
  page.data.newInviteAvailable = true;
  assert.equal(page.onShareAppMessage().path, '/pages/home/home');
});

test('sending a share card and copying a code are visually separate actions', () => {
  const template = readMini('pages/family/invites.wxml');
  assert.match(template, /open-type="share"/);
  assert.match(template, /bindtap="onCopyCode"/);
  assert.match(template, /好友点击分享卡片/);
  assert.match(template, /家庭管理 → 加入家庭/);
  assert.match(template, /disabled="\{\{creating \|\| !newInviteAvailable\}\}"/);
  assert.doesNotMatch(template, /onCopyPath|复制邀请链接/);

  const pages = JSON.parse(readMini('app.json')).pages;
  assert.ok(pages.includes('pages/family/join'));
  assert.ok(pages.includes('pages/home/home'));
});

function joinHarness(overrides: Record<string, unknown> = {}) {
  const errors: string[] = [];
  const successes: string[] = [];
  const destinations: string[] = [];
  const family = { id: 'spc_home', name: '测试家庭' };
  let joins = 0;
  const page = loadPage('join', {
    previewInvite: async () => ({
      family: { ...family, avatarUrl: null, memberCount: 2 },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      canJoin: true,
    }),
    joinFamilyByCode: async () => { joins++; return { familyId: family.id }; },
    loadFamilies: async () => [family],
    setCurrentFamily: () => {},
    refreshFamilyState: () => {},
    showError: (value: string) => errors.push(value),
    showSuccess: (value: string) => successes.push(value),
    showLoading: () => {},
    hideLoading: () => {},
    getErrorMessage: (_code: string, message: string) => message || '邀请校验失败',
    setTimeout: (fn: () => void) => fn(),
    wx: { switchTab: ({ url }: { url: string }) => destinations.push(url) },
    ...overrides,
  });
  return { page, errors, successes, destinations, get joins() { return joins; } };
}

test('share-card entry automatically previews the invitation without a second tap', async () => {
  const { page } = joinHarness();
  page.onLoad({ code: 'LS-ABCD-EFGH-JKLM-NPQR' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.fromShare, true);
  assert.equal(page.data.preview.family.id, 'spc_home');
  assert.equal(page.data.previewCode, 'LS-ABCD-EFGH-JKLM-NPQR');
  assert.equal(page.data.previewing, false);
  assert.match(readMini('pages/family/join.wxml'), /wx:if="\{\{!joined && !preview\}\}"/);
  assert.match(readMini('pages/family/join.wxml'), /换一个邀请码/);
  page.onUseAnotherCode();
  assert.equal(page.data.fromShare, false);
  assert.equal(page.data.code, '');
});

test('join success stays successful when subsequent family refresh fails, avoiding duplicate writes', async () => {
  const { page, successes, destinations, joins } = joinHarness({
    loadFamilies: async () => { throw new Error('network unavailable'); },
  });
  page.onLoad({ code: 'LS-ABCD-EFGH-JKLM-NPQR' });
  await new Promise(resolve => setImmediate(resolve));
  await page.onJoin();
  assert.equal(page.data.joined, true);
  assert.equal(page.data.submitting, false);
  assert.deepEqual(successes, ['已加入家庭']);
  assert.deepEqual(destinations, ['/pages/home/home']);
  await page.onJoin();
  assert.equal(page.data.joined, true);
});

test('unjoinable invitation blocks the write and shows the appropriate state', async () => {
  const harness = joinHarness({
    previewInvite: async () => ({ family: { id: 'spc_home', name: '测试家庭', memberCount: 8 }, canJoin: false }),
  });
  harness.page.onLoad({ code: 'LS-FULL' });
  await new Promise(resolve => setImmediate(resolve));
  await harness.page.onJoin();
  assert.deepEqual(harness.errors, ['当前邀请暂不可加入']);
  assert.equal(harness.joins, 0);
  const template = readMini('pages/family/join.wxml');
  assert.match(template, /wx:if="\{\{preview.canJoin\}\}"/);
});
