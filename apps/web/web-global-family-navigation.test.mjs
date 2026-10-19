import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

test('desktop family selector replaces duplicated branding and family card', () => {
  const shell = source('./src/components/app-shell.tsx');
  assert.doesNotMatch(shell, /function Brand\(/u);
  assert.doesNotMatch(shell, /<Brand\s*\/>/u);
  assert.equal((shell.match(/aria-label="切换家庭"/gu) || []).length, 1);
  assert.match(shell, /aria-label="移动端切换家庭"/u);
  assert.match(shell, /members\.length/u);
});

test('only mobile has a persistent shell header; desktop keeps page-owned headers', () => {
  const shell = source('./src/components/app-shell.tsx');
  assert.match(shell, /<header className="[^"]*lg:hidden"/u);
  assert.doesNotMatch(shell, /家庭空间/u);
  assert.match(shell, /<Outlet key=\{currentFamily\?\.id \?\? 'no-family'\} \/>/u);
  const home = source('./src/pages/home-page.tsx');
  assert.match(home, /\{dateLabel\}/u);
  assert.doesNotMatch(home, /\{dateLabel\} · \{currentFamily\.name\}/u);
});

test('family administration uses the shared navigation selection, not a local selector', () => {
  const family = source('./src/pages/family-page.tsx');
  assert.doesNotMatch(family, /setCurrentFamilyId/u);
  assert.doesNotMatch(family, /当前家庭\s*<select/u);
});

test('rapid switching cannot overwrite new family members with a stale response', () => {
  const provider = source('./src/components/household-provider.tsx');
  assert.match(provider, /const membersRequestId = useRef\(0\)/u);
  assert.match(provider, /if \(requestId === membersRequestId\.current\) setMembers\(result\)/u);
  assert.match(provider, /setCurrentFamilyIdState\(familyId\);\s*setMembers\(\[\]\);/u);
});
