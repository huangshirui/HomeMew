import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

test('mobile shell exposes household context and real avatars', () => {
  const shell = source('./src/components/app-shell.tsx');

  assert.match(shell, /aria-label="移动端切换家庭"/u);
  assert.match(shell, /currentFamily\?\.avatarUrl/u);
  assert.match(shell, /user\?\.avatarUrl/u);
  assert.match(shell, /safe-area-inset-bottom/u);
});

test('household load failures are visible and recoverable', () => {
  const shell = source('./src/components/app-shell.tsx');

  assert.match(shell, /role="alert"/u);
  assert.match(shell, /家庭数据暂时没有同步完整/u);
  assert.match(shell, /void refresh\(\)/u);
  assert.match(shell, />\s*重试\s*</u);
});

test('Web README reflects the accepted production front door', () => {
  const readme = source('./README.md');

  assert.match(readme, /homemew\.aisr\.online.*homemew-web-production/su);
  assert.match(readme, /HOMEMEW_BACKEND/u);
  assert.doesNotMatch(readme, /Do not move the production domain to the Web Worker/u);
  assert.doesNotMatch(readme, /Production configuration intentionally contains no Web custom-domain route yet/u);
});
