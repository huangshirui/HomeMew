import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const miniRoot = path.resolve(import.meta.dirname, '../miniprogram');
const appJson = JSON.parse(readFileSync(path.join(miniRoot, 'app.json'), 'utf-8'));
const customTabSource = readFileSync(
  path.join(miniRoot, 'custom-tab-bar/index.ts'),
  'utf-8',
);

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const fullPath = path.join(root, name);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|js)$/u.test(name) ? [fullPath] : [];
  });
}

test('Meow is offline: the page is not registered in the Mini package', () => {
  assert.ok(!appJson.pages.includes('pages/meow/meow'));
  assert.equal(existsSync(path.join(miniRoot, 'pages/meow/meow.ts')), false);
});

test('Meow is offline: the create sheet exposes no Meow route', () => {
  assert.doesNotMatch(customTabSource, /pages\/meow\/meow/);
  assert.doesNotMatch(customTabSource, /key:\s*['"]meow['"]/);
});

test('retired LifeSpace Creation Draft runtime is absent from the Mini source tree', () => {
  assert.equal(existsSync(path.join(miniRoot, 'services/creation-drafts.ts')), false);
  assert.equal(existsSync(path.join(miniRoot, 'services/creation-draft-adapter.ts')), false);
  assert.equal(existsSync(path.join(miniRoot, 'types/creation-draft-jobs.ts')), false);
  assert.equal(existsSync(path.join(miniRoot, 'stores/draft-buffer.ts')), false);

  for (const file of sourceFiles(miniRoot)) {
    const source = readFileSync(file, 'utf-8');
    assert.doesNotMatch(source, /CreationDraft/u, `retired CreationDraft symbol found in ${file}`);
    assert.doesNotMatch(source, /creation-drafts/u, `retired creation-drafts route found in ${file}`);
    assert.doesNotMatch(source, /draft-buffer/u, `retired draft-buffer reference found in ${file}`);
  }
});
