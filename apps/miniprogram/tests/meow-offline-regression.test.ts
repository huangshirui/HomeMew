import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const miniRoot = path.resolve(import.meta.dirname, '../miniprogram');
const appJson = JSON.parse(readFileSync(path.join(miniRoot, 'app.json'), 'utf-8'));
const customTabSource = readFileSync(
  path.join(miniRoot, 'custom-tab-bar/index.ts'),
  'utf-8',
);

test('Meow is offline: the page is not registered in the Mini package', () => {
  assert.ok(!appJson.pages.includes('pages/meow/meow'));
});

test('Meow is offline: the create sheet exposes no Meow route', () => {
  assert.doesNotMatch(customTabSource, /pages\/meow\/meow/);
  assert.doesNotMatch(customTabSource, /key:\s*['"]meow['"]/);
});
