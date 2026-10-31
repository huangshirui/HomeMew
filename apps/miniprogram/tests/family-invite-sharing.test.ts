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
  await page.onShareInvite();
  page.onCopyCode();
  assert.deepEqual(copied, []);
  assert.ok(errors.every(value => value.includes('已失效')));

  // A previously active invitation may expire while the page remains open.
  page.data.newInvite = inviteFixture(new Date(Date.now() - 1000).toISOString());
  page.data.newInviteAvailable = true;
  await page.onShareInvite();
  assert.equal(page.data.qrVisible, false);
  assert.equal(typeof page.onShareAppMessage, 'undefined');
});

test('mini-code image and copying a code are visually separate actions', () => {
  const template = readMini('pages/family/invites.wxml');
  assert.match(template, /bindtap="onShareInvite"/);
  assert.doesNotMatch(template, /open-type="share"/);
  assert.match(template, /bindtap="onShareMiniCode"/);
  assert.match(template, /bindtap="onSaveMiniCode"/);
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
  await page.onShareInvite();
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

test('blocked native image sharing offers fullscreen screenshot fallback', () => {
  const errors: string[] = [];
  const previews: string[] = [];
  const page = inviteHarness({
    showError: (message: string) => errors.push(message),
    wx: {
      showShareImageMenu: ({ fail }: { fail: (error: { errMsg: string }) => void }) =>
        fail({ errMsg: 'showShareImageMenu:fail account verification required' }),
      previewImage: ({ current }: { current: string }) => previews.push(current),
    },
  }).page;
  page.data.qrCodePath = '/user/data/invite.png';
  page.data.qrVisible = true;
  page.onShareMiniCode();
  assert.match(errors[0], /微信暂不允许直接分享/);
  page.onPreviewMiniCode();
  assert.deepEqual(previews, ['/user/data/invite.png']);
  assert.match(readMini('pages/family/invites.wxml'), /全屏截图/);
});

test('photo album permission is requested only when saving and successful grant saves the code', () => {
  const saves: string[] = [];
  const prompts: string[] = [];
  const successes: string[] = [];
  const page = inviteHarness({
    showSuccess: (message: string) => successes.push(message),
    wx: {
      getSetting: ({ success }: { success: (value: unknown) => void }) =>
        success({ authSetting: {} }),
      authorize: ({ scope, success }: { scope: string; success: () => void }) => {
        prompts.push(scope);
        success();
      },
      saveImageToPhotosAlbum: ({ filePath, success }: { filePath: string; success: () => void }) => {
        saves.push(filePath);
        success();
      },
    },
  }).page;
  page.data.qrCodePath = '/user/data/invite.png';
  page.onSaveMiniCode();
  assert.deepEqual(prompts, ['scope.writePhotosAlbum']);
  assert.deepEqual(saves, ['/user/data/invite.png']);
  assert.equal(page.data.savingAlbum, false);
  assert.equal(page.data.albumPermissionRequired, false);
  assert.match(successes[0], /已保存小程序码/);
});

test('previously denied photo permission reveals native settings button and saves after grant', () => {
  let granted = false;
  const errors: string[] = [];
  const saves: string[] = [];
  const page = inviteHarness({
    showError: (message: string) => errors.push(message),
    wx: {
      getSetting: ({ success }: { success: (value: unknown) => void }) => success({
        authSetting: { 'scope.writePhotosAlbum': granted },
      }),
      authorize: () => assert.fail('denied user must recover in native settings'),
      saveImageToPhotosAlbum: ({ filePath, success }: { filePath: string; success: () => void }) => {
        saves.push(filePath);
        success();
      },
    },
  }).page;
  page.data.qrCodePath = '/user/data/invite.png';
  page.data.qrVisible = true;
  page.onSaveMiniCode();
  assert.equal(page.data.albumPermissionRequired, true);
  assert.equal(page.data.savingAlbum, false);
  assert.equal(saves.length, 0);
  assert.match(errors[0], /开启相册权限/);
  const template = readMini('pages/family/invites.wxml');
  assert.match(template, /open-type="openSetting"/);
  assert.match(template, /bindopensetting="onAlbumSettingChanged"/);

  granted = true;
  page.onAlbumSettingChanged({
    detail: { authSetting: { 'scope.writePhotosAlbum': true } },
  });
  assert.deepEqual(saves, ['/user/data/invite.png']);
  assert.equal(page.data.albumPermissionRequired, false);
});

test('declining the first photo authorization keeps recoverable settings UI', () => {
  const errors: string[] = [];
  const page = inviteHarness({
    showError: (message: string) => errors.push(message),
    wx: {
      getSetting: ({ success }: { success: (value: unknown) => void }) => success({ authSetting: {} }),
      authorize: ({ fail }: { fail: (error: { errMsg: string }) => void }) =>
        fail({ errMsg: 'authorize:fail auth deny' }),
      saveImageToPhotosAlbum: () => assert.fail('must not save without authorization'),
    },
  }).page;
  page.data.qrCodePath = '/user/data/invite.png';
  page.onSaveMiniCode();
  assert.equal(page.data.savingAlbum, false);
  assert.equal(page.data.albumPermissionRequired, true);
  assert.match(errors[0], /相册授权未开启/);
});

test('device-level photo write denial is not misrepresented as a missing mini-program scope', () => {
  const errors: string[] = [];
  const page = inviteHarness({
    showError: (message: string) => errors.push(message),
    wx: {
      getSetting: ({ success }: { success: (value: unknown) => void }) =>
        success({ authSetting: { 'scope.writePhotosAlbum': true } }),
      saveImageToPhotosAlbum: ({ fail }: { fail: (error: { errMsg: string }) => void }) =>
        fail({ errMsg: 'saveImageToPhotosAlbum:fail permission denied' }),
    },
  }).page;
  page.data.qrCodePath = '/user/data/invite.png';
  page.onSaveMiniCode();
  assert.equal(page.data.savingAlbum, false);
  assert.equal(page.data.albumPermissionRequired, false);
  assert.match(errors[0], /微信或系统未允许写入照片/);
});
