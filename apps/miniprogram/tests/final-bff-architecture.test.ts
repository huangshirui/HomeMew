import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../miniprogram/', import.meta.url));
const dormant = new Set([
  'services/canonical-query.ts',
  'services/lifespace.ts',
  'services/creation-drafts.ts',
  'pages/meow/meow.ts',
]);
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
test('active Mini production source cannot address LifeSpace wire contracts', () => {
  const sourceFiles = files(root);
  for (const file of sourceFiles) {
    const path = relative(root, file).replaceAll('\\', '/');
    if (dormant.has(path)) continue;
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /https?:\/\/(?:[^/'"\s]*\.)?(?:auth|core|identity|lifespace)[^/'"\s]*\//i, path);
    assert.doesNotMatch(source, /\/api\/v1\/spaces\b|\/models\//, path);
    assert.doesNotMatch(source, /target\s*:\s*['"](?:core|identity|backend)['"]|target\?\s*:/, path);
    assert.doesNotMatch(source, /from\s*['"][^'"]*(?:canonical-query|lifespace|creation-drafts)['"]|require\(['"][^'"]*(?:canonical-query|lifespace|creation-drafts)['"]\)/, path);
  }
  assert.match(readFileSync(join(root, 'app.json'), 'utf8'), /pages\/home\/home/);
  assert.doesNotMatch(readFileSync(join(root, 'app.json'), 'utf8'), /pages\/meow\//);
});
