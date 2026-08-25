import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const shell = readFileSync(fileURLToPath(new URL('./src/components/app-shell.tsx', import.meta.url)), 'utf8');

function ordered(source, labels) {
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${label} should appear after the previous navigation item`);
    cursor = next;
  }
}

test('desktop navigation prioritizes daily household work', () => {
  const block = shell.match(/const dailyNavigation = \[([\s\S]*?)\n\];/u)?.[1];
  assert.ok(block, 'dailyNavigation block must exist');
  ordered(block, ["label: '今天'", "label: '日程'", "label: '待办'", "label: '日子'", "label: '许愿'"]);
});

test('family administration stays in a separate low-frequency group', () => {
  const block = shell.match(/const managementNavigation = \[([\s\S]*?)\n\];/u)?.[1];
  assert.ok(block, 'managementNavigation block must exist');
  ordered(block, ["label: '家庭与成员'", "label: '设置'"]);
  assert.match(shell, />家庭管理</u);
  assert.match(shell, /to: '\/more', label: '更多'/u, 'mobile navigation should keep the More hub');
});
