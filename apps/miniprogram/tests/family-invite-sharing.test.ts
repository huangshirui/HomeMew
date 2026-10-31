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

test('copy yields only the bare code, not unsupported native share cards', async () => {
  const { page, copied } = inviteHarness();
  page.data.newInvite = inviteFixture();
  page.data.newInviteAvailable = true;
  assert.equal(typeof page.onShareAppMessage, 'undefined');
  page.onCopyCode();
  await Promise.resolve();
  assert.deepEqual(copied, ['LS-ABCD-EFGH-JKLM-NPQR']);
  assert.equal(typeof page.onCopyPath, 'undefined');
});

test('no invite, expiry and revoke prevent code copying or QR generation', async () => {
  const { page, copied, errors } = inviteHarness({
    listInvites: async () => [{
      ...inviteFixture(),
      status: 'revoked',
      createdBy: 'usr_owner',
      createdAt: new Date().toISOString(),
    }],
  });
  assert.equal(page.data.newInvite, null);
  page.onCopyCode();
  page.data.newInvite = inviteFixture();
  page.data.newInviteAvailable = true;
  page.data.familyId = 'spc_home';
  await page.loadInvites();
  assert.equal(page.data.newInviteAvailable, false);
  await page.onGenerateMiniCode();
  page.onCopyCode();
  assert.deepEqual(copied, []);
  assert.ok(errors.every(value => value.includes('已失效')));

  // A previously active invitation may expire while the page remains open.
  page.data.newInvite = inviteFixture(new Date(Date.now() - 1000).toISOString());
  page.data.newInviteAvailable = true;
  await page.onGenerateMiniCode();
  assert.equal(page.data.qrVisible, false);
  assert.equal(typeof page.onShareAppMessage, 'undefined');
});

test('mini-code image and copying a code are visually separate actions', () => {
  const template = readMini('pages/family/invites.wxml');
  assert.match(template, /bindtap="onGenerateMiniCode"/);
  assert.doesNotMatch(template, /open-type="share"/);
  assert.doesNotMatch(template, /bindtap="onShareMiniCode"|分享二维码图片|发送给微信好友<\/button>/);
  assert.match(template, /show-menu-by-longpress="\{\{true\}\}"/);
  assert.match(template, /bindtap="onPreviewMiniCode"/);
  assert.doesNotMatch(template, /onSaveMiniCode|openSetting|相册授权/);
  assert.match(template, /bindtap="onCopyCode"/);
  assert.match(template, /生成小程序码图片/);
  assert.match(template, /家庭管理 → 加入家庭/);
  assert.match(template, /disabled="\{\{creating \|\| sharing \|\| !newInviteAvailable\}\}"/);
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

test('mini-code scene entry automatically previews the invitation without a second tap', async () => {
  const { page } = joinHarness();
  page.onLoad({ scene: encodeURIComponent('LS-ABCD-EFGH-JKLM-NPQR') });
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
  const { page, successes, destinations } = joinHarness({
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

test('an existing member can open a full family instead of being blocked by invite capacity', async () => {
  const selected: string[] = [];
  const harness = joinHarness({
    previewInvite: async () => ({
      family: { id: 'spc_home', name: '测试家庭', memberCount: 8 },
      canJoin: false,
    }),
    setCurrentFamily: (family: { id: string }) => { selected.push(family.id); },
  });
  harness.page.onLoad({ code: 'LS-FULL' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.page.data.alreadyMember, true);
  await harness.page.onEnterExistingFamily();
  assert.deepEqual(selected, ['spc_home']);
  assert.equal(harness.page.data.joined, true);
  assert.deepEqual(harness.destinations, ['/pages/home/home']);
  assert.equal(harness.joins, 0);
  assert.match(readMini('pages/family/join.wxml'), /bindtap="onEnterExistingFamily"/);
});

test('generating a QR image uses the stable BFF, writes only a local file, and opens fallback actions', async () => {
  const requested: unknown[] = [];
  const files: unknown[] = [];
  const page = inviteHarness({
    generateFamilyInviteMiniCode: async (familyId: string, code: string, version: string) => {
      requested.push({ familyId, code, version });
      return { imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png', envVersion: version };
    },
    wx: {
      env: { USER_DATA_PATH: '/user/data' },
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      getFileSystemManager: () => ({
        writeFileSync: (...args: unknown[]) => files.push(args),
      }),
    },
  }).page;
  page.data.newInvite = inviteFixture();
  page.data.newInviteAvailable = true;
  page.data.familyId = 'spc_home';
  await page.onGenerateMiniCode();
  assert.equal(page.data.qrVisible, true);
  assert.equal(page.data.qrCodeVersion, 'trial');
  assert.deepEqual(requested, [{
    familyId: 'spc_home', code: 'LS-ABCD-EFGH-JKLM-NPQR', version: 'trial',
  }]);
  assert.deepEqual(files, [['/user/data/homemew-invite-inv_test.png', 'iVBORw0KGgo=', 'base64']]);
  assert.equal(page.data.qrCodePath, '/user/data/homemew-invite-inv_test.png');
  page.onCloseMiniCode();
  assert.equal(page.data.qrVisible, false);
});

test('native WeChat long-press menu replaces app-level photo permissions and unsafe share calls', () => {
  const previews: Array<{ current: string; urls: string[]; showmenu: boolean }> = [];
  const page = inviteHarness({
    wx: {
      previewImage: (args: { current: string; urls: string[]; showmenu: boolean }) =>
        previews.push(args),
      authorize: () => assert.fail('Native long-press menu must not ask for app scope'),
      getSetting: () => assert.fail('Native long-press menu must not read app scope'),
      saveImageToPhotosAlbum: () => assert.fail('Native menu must own save behavior'),
      showShareImageMenu: () => assert.fail('Account-restricted image share must remain removed'),
    },
  }).page;
  page.data.qrCodePath = '/user/data/invite.png';
  page.data.qrVisible = true;
  assert.equal(typeof page.onSaveMiniCode, 'undefined');
  assert.equal(typeof page.onAlbumSettingChanged, 'undefined');
  assert.equal(typeof page.onShareMiniCode, 'undefined');
  page.onPreviewMiniCode();
  assert.deepEqual(previews, [{
    current: '/user/data/invite.png',
    urls: ['/user/data/invite.png'],
    showmenu: true,
  }]);
  const template = readMini('pages/family/invites.wxml');
  assert.match(template, /show-menu-by-longpress="\{\{true\}\}"/);
  assert.match(template, /bindtap="onPreviewMiniCode"/);
  assert.match(template, /长按二维码/);
  assert.match(template, /全屏查看二维码/);
  assert.match(template, /全屏截图|截图发送/);
  assert.doesNotMatch(template, /onSaveMiniCode|saveImageToPhotosAlbum|openSetting|开启相册权限|分享二维码图片/);
  const source = readMini('pages/family/invites.ts');
  assert.doesNotMatch(source, /saveImageToPhotosAlbum|scope\.writePhotosAlbum|wx\.authorize|wx\.getSetting|showShareImageMenu/);
});

test('native image preview failure still shows the copy-code fallback', () => {
  const errors: string[] = [];
  const { page } = inviteHarness({
    showError: (message: string) => errors.push(message),
    wx: {
      previewImage: ({ fail }: { fail: (error: { errMsg: string }) => void }) =>
        fail({ errMsg: 'previewImage:fail unavailable' }),
    },
  });
  page.data.qrCodePath = '/user/data/invite.png';
  page.onPreviewMiniCode();
  assert.deepEqual(errors, ['无法预览图片，请使用邀请码']);
});
