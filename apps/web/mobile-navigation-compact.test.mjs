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

test('mobile family selector shares page header, truncates long names and preserves native switching', () => {
  const shell = source('./src/components/app-shell.tsx');
  const header = source('./src/components/ui/page-header.tsx');
  const home = source('./src/pages/home-page.tsx');
  assert.match(header, /<FamilyIdentity mobile \/>/u);
  assert.match(header, /w-\[min\(7rem,35vw\)\]/u);
  assert.match(shell, /max-w-28 gap-1\.5/u);
  assert.match(shell, /truncate font-semibold tracking-tight/u);
  assert.match(shell, /absolute inset-0 h-full w-full cursor-pointer opacity-0/u);
  assert.match(shell, /setCurrentFamilyId\(event\.target\.value\)/u);
  assert.match(home, /<FamilyIdentity mobile \/>/u);
  assert.doesNotMatch(shell, /<div className="mx-auto flex h-16 max-w-7xl/u);
});

test('calendar uses one-line icon actions and responsive, accessible period controls', () => {
  const calendar = source('./src/pages/calendar-page.tsx');
  assert.match(calendar, /<PageHeader title="家庭日程" mobileTitle="日程" compactMobile>/u);
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
