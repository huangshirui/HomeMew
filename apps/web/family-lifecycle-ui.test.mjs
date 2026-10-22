import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function requireAll(text, patterns, label) {
  for (const pattern of patterns) assert.match(text, pattern, `${label} must retain ${pattern}`);
}

test('family page exposes owner close and non-owner leave through LifeSpace', () => {
  const family = source('./src/pages/family-page.tsx');

  requireAll(family, [
    /currentFamily\?\.role === 'owner'/u,
    /家庭数据不会立即物理删除/u,
    /所有成员和外部系统会立即失去访问权限/u,
    /当前版本也不能自行恢复/u,
    /再次确认：注销/u,
    /apiRequest<SpaceDetail>\(`\/api\/lifespace\/core\/v1\/spaces\/\$\{encodeURIComponent\(family\.id\)\}`\)/u,
    /\/spaces\/\$\{encodeURIComponent\(family\.id\)\}\/close/u,
    /JSON\.stringify\(\{ version: latest\.version \}\)/u,
    /SPACE_OWNER_REQUIRED/u,
    /SPACE_VERSION_CONFLICT/u,
  ], 'owner close flow');

  requireAll(family, [
    /family\.role === 'owner'/u,
    /\/spaces\/\$\{encodeURIComponent\(family\.id\)\}\/leave/u,
    /只结束你自己的家庭成员关系/u,
    /LAST_SPACE_MANAGER/u,
  ], 'member leave flow');

  requireAll(family, [
    /await refresh\(\);\s*navigate\(withRuntimeEnvironment\('\/'\), \{ replace: true \}\);/u,
    /variant="destructive"/u,
  ], 'post-lifecycle UX');
});

test('shared button primitive has an explicit destructive treatment', () => {
  const button = source('./src/components/ui/button.tsx');
  assert.match(button, /'destructive'/u);
  assert.match(button, /variant === 'destructive'/u);
  assert.match(button, /bg-red-600/u);
});
