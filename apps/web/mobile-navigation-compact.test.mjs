import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('mobile bottom tabs are full-width, docked, and account for the device safe area', () => {
  const shell = source('./src/components/app-shell.tsx');
  assert.match(shell, /fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t/u);
  assert.match(shell, /pb-\[env\(safe-area-inset-bottom\)\]/u);
  assert.doesNotMatch(shell, /bottom-\[max\(0\.75rem/u);
  assert.match(shell, /min-h-14 flex-col/u);
  assert.match(shell, /!nestedPage \? <MobileBottomNav \/>/u);
  assert.match(shell, /'pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\]'/u);
  for (const label of ['首页', '日程', '待办', '更多']) {
    assert.match(shell, new RegExp(`label: '${label}'`, 'u'));
  }
});

test('mobile family logo selector opens accessible family and member panel without disrupting centered titles', () => {
  const shell = source('./src/components/app-shell.tsx');
  const header = source('./src/components/ui/page-header.tsx');
  const home = source('./src/pages/home-page.tsx');
  assert.match(header, /<FamilyIdentity mobile \/>/u);
  assert.ok(header.includes('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'));
  assert.ok(header.includes('text-center text-[20px] font-semibold'));
  assert.ok(shell.includes('familyAvatarSource(currentFamily.id, currentFamily.avatarUrl)'));
  assert.ok(shell.includes('aria-expanded={open}'));
  assert.ok(shell.includes('setCurrentFamilyId(family.id)'));
  assert.ok(shell.includes('<MemberAvatar key={member.id}'));
  assert.match(home, /<PageHeader title="首页" mobileActions=/u);
  assert.doesNotMatch(shell, /<div className="mx-auto flex h-16 max-w-7xl/u);
});

test('calendar uses one-line icon actions and responsive, accessible period controls', () => {
  const calendar = source('./src/pages/calendar-page.tsx');
  assert.match(calendar, /<PageHeader title="家庭日程" mobileTitle="日程" compactMobile mobileActions=/u);
  assert.match(calendar, /aria-label="新建日程" title="新建日程"/u);
  assert.match(calendar, /aria-controls="calendar-search-filters"/u);
  assert.match(calendar, /<span className="hidden sm:inline">搜索与筛选/u);
  assert.match(calendar, /<span className="hidden sm:inline">新建日程/u);
  assert.match(calendar, /aria-label="日历视图" value=\{view\}/u);
  assert.match(calendar, /onChange=\{\(event\) => switchView\(event\.target\.value as 'month' \| 'week'\)\}/u);
  assert.match(calendar, /hidden text-xs text-stone-500 sm:block">\{currentFamily\.timezone\}/u);
  assert.match(calendar, /onClick=\{jumpToday\}/u);
  assert.match(calendar, /navigatePeriod\(-1\)/u);
  assert.match(calendar, /navigatePeriod\(1\)/u);
});

test('all main mobile modules use centered title and compact creation controls', () => {
  const header = source('./src/components/ui/page-header.tsx');
  const calendar = source('./src/pages/calendar-page.tsx');
  const tasks = source('./src/pages/tasks-page.tsx');
  const domain = source('./src/pages/domain-page.tsx');
  const more = source('./src/pages/more-page.tsx');
  const family = source('./src/pages/family-page.tsx');
  assert.ok(header.includes('text-center text-[20px] font-semibold'));
  assert.match(calendar, /mobileTitle="日程" compactMobile mobileActions=/u);
  assert.match(tasks, /mobileTitle="待办" mobileActions=/u);
  assert.match(domain, /mobileActions=\\{<>/u);
  assert.match(more, /<PageHeader title="更多" \\/>/u);
  assert.match(family, /<MemberAvatar member=\\{member\\}/u);
  assert.match(family, /currentFamily.avatarUrl/u); // uploaded family logo
  for (const name of ['days', 'wishes', 'integrations']) {
    assert.match(source(`./src/pages/${name}-page.tsx`), /mobileActions=/u);
  }
});

test('member avatars use the Mini public media routes and graceful fallbacks', () => {
  const shell = source('./src/components/app-shell.tsx');
  const mini = source('./miniprogram-bff.mjs');
  assert.match(shell, /miniprogram\\/media\\/users\\//u);
  assert.match(shell, /miniprogram\\/media\\/families\\//u);
  assert.match(shell, /onError=\\{\\(event\\) =>/u);
  assert.match(mini, /kind: 'user-avatar-read'/u);
  assert.match(mini, /kind: 'family-avatar-read'/u);
});
