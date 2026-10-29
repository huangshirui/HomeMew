import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function readMini(relative: string): string {
  return readFileSync(new URL(`../miniprogram/${relative}`, import.meta.url), 'utf8');
}

function invitePage() {
  let page: any;
  const copied: string[] = [];
  const source = readMini('pages/family/invites.ts');
  const executable = stripTypeScriptTypes(
    source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm, ''),
  );
  runInNewContext(executable, {
    Page: (definition: any) => { page = definition; },
    copyToClipboard: (value: string) => { copied.push(value); },
  });
  return { page, copied };
}

test('family invite shares the join page with the new invitation code', () => {
  const { page, copied } = invitePage();
  page.data.newInvite = {
    id: 'inv_test',
    code: 'LS-ABCD-EFGH-JKLM-NPQR',
    joinPath: '/pages/family/join?code=LS-ABCD-EFGH-JKLM-NPQR',
    expiresAt: '2026-11-01T00:00:00Z',
    maxUses: 2,
    usedCount: 0,
  };
  const shared = page.onShareAppMessage();
  assert.equal(shared.path, '/pages/family/join?code=LS-ABCD-EFGH-JKLM-NPQR');
  assert.match(shared.title, /邀请你加入/);

  page.onCopyCode();
  assert.deepEqual(copied, ['LS-ABCD-EFGH-JKLM-NPQR']);
  assert.equal(typeof page.onCopyPath, 'undefined');
});

test('without a newly generated code, menu sharing only opens the valid home page', () => {
  const { page, copied } = invitePage();
  assert.equal(page.onShareAppMessage().path, '/pages/home/home');
  page.onCopyCode();
  assert.deepEqual(copied, []);
});

test('invite UI uses WeChat share cards and never offers a copyable internal link', () => {
  const template = readMini('pages/family/invites.wxml');
  assert.match(template, /open-type="share"/);
  assert.match(template, /bindtap="onCopyCode"/);
  assert.doesNotMatch(template, /onCopyPath|复制邀请链接/);
  const pages = JSON.parse(readMini('app.json')).pages;
  assert.ok(pages.includes('pages/family/join'));
  assert.ok(pages.includes('pages/home/home'));
  const join = readMini('pages/family/join.ts');
  assert.match(join, /options\.code/);
  assert.match(join, /this\.onPreview\(\)/);
});
