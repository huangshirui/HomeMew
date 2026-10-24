import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const shell = readFileSync(fileURLToPath(new URL('./src/components/app-shell.tsx', import.meta.url)), 'utf8');
const more = readFileSync(fileURLToPath(new URL('./src/pages/more-page.tsx', import.meta.url)), 'utf8');

function ordered(source, labels) {
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${label} should appear after the previous navigation item`);
    cursor = next;
  }
}

test('desktop navigation follows the four approved groups and model placement', () => {
  ordered(shell, [
    'title="日常" entries={dailyNavigation}',
    'title="计划与成长" entries={growthNavigation}',
    'title="生活与回忆" entries={memoriesNavigation}',
    'title="家庭管理" entries={managementNavigation}',
  ]);
  const daily = shell.match(/const dailyNavigation = \[([\s\S]*?)\n\];/u)?.[1];
  assert.ok(daily, 'dailyNavigation must exist');
  ordered(daily, ["label: '今天'", "label: '日程'", "label: '待办'"]);
  assert.doesNotMatch(daily, /label: '日子'|label: '许愿池'/u);

  const growth = shell.match(/const growthNavigation = \[([\s\S]*?)\n\];/u)?.[1];
  assert.ok(growth);
  ordered(growth, ["label: '活动'", "label: '目标'", "label: '习惯'"]);

  const memories = shell.match(/const memoriesNavigation = \[([\s\S]*?)\n\];/u)?.[1];
  assert.ok(memories);
  ordered(memories, ["label: '日子'", "label: '纪念日'", "label: '许愿池'", "label: '足球比赛'"]);
});

test('family management is visible to all roles while actions remain server-authorized', () => {
  const block = shell.match(/const managementNavigation = \[([\s\S]*?)\n\];/u)?.[1];
  assert.ok(block);
  ordered(block, ["label: '家庭与成员'", "label: '设置'"]);
  assert.match(shell, /title="家庭管理" entries=\{managementNavigation\}/u);
  assert.match(shell, /to: '\/more', label: '更多'/u);
  assert.match(shell, /<SidebarSection title="家庭管理" entries=\{managementNavigation\}/u);
  assert.match(shell, /min-h-0 flex-1 overflow-y-auto overscroll-contain/u,
    'Sidebar needs its own scroll area so small laptop heights do not clip admin menus');
  assert.match(shell, /mt-3 flex shrink-0 items-center/u, 'Profile footer must not overlap scrollable menus');
});

test('More uses compact grouped icon tiles and shows the staging family role', () => {
  ordered(more, ["title: '计划与成长'", "title: '生活与回忆'", "title: '家庭管理'"]);
  assert.match(more, /grid grid-cols-3 gap-2\.5 sm:grid-cols-4/u);
  assert.match(more, /min-h-28 flex-col items-center/u);
  assert.match(more, /当前身份：\{roleLabels\[currentFamily\.role\]\}/u);
  assert.doesNotMatch(more, /h-full p-5/u, 'Do not use old full-width descriptive cards on mobile');
  assert.match(more, /to: '\/days', title: '日子'/u);
  assert.match(more, /to: '\/family', title: '家庭与成员'/u);
  assert.match(more, /to: '\/settings', title: '设置'/u);
});
