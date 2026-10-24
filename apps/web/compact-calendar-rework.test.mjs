import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutTimedRanges, minutesOnDay } from './src/lib/calendar-week-layout.ts';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('week layout separates simultaneous events and reuses lanes after endpoints touch', () => {
  const positions = layoutTimedRanges([
    { id: 'a', startMinute: 540, endMinute: 660 },
    { id: 'b', startMinute: 555, endMinute: 615 },
    { id: 'c', startMinute: 615, endMinute: 660 },
    { id: 'd', startMinute: 660, endMinute: 720 },
  ]);
  assert.equal(positions.length, 4);
  const result = Object.fromEntries(positions.map((item) => [item.id, item]));
  assert.equal(result.a.columns, 2);
  assert.equal(result.b.columns, 2);
  assert.notEqual(result.a.column, result.b.column);
  assert.equal(result.b.column, result.c.column);
  assert.equal(result.d.columns, 1);
});

test('week event ranges clip overnight occurrences to each calendar day', () => {
  const start = { date: '2026-10-02', time: '23:30' };
  const end = { date: '2026-10-03', time: '01:30' };
  assert.deepEqual(minutesOnDay(start, end, '2026-10-02'), { startMinute: 1410, endMinute: 1440 });
  assert.deepEqual(minutesOnDay(start, end, '2026-10-03'), { startMinute: 0, endMinute: 90 });
});

test('week has time axis, all-day lane, deterministic member palette, and mobile day focus', () => {
  const grid = source('./src/components/week-time-grid.tsx');
  const calendar = source('./src/pages/calendar-page.tsx');
  assert.match(grid, /const HOUR_HEIGHT = 56/u);
  assert.match(grid, /length: 24/u);
  assert.match(grid, /layoutTimedRanges\(ranges\)/u);
  assert.match(grid, /getPalette\(event\)/u);
  assert.match(grid, /attendeePersonIds/u);
  assert.match(grid, /未指定/u);
  assert.match(grid, /kind === 'date'/u);
  assert.match(grid, /lg:hidden/u);
  assert.match(grid, /onCreate\(day,/u);
  assert.match(calendar, /<WeekTimeGrid/u);
  assert.match(calendar, /onCreate=\{openCreateAt\}/u);
});

test('month blank cells create a date-specific draft, while events keep their own click handlers', () => {
  const calendar = source('./src/pages/calendar-page.tsx');
  assert.match(calendar, /aria-label=\{`\$\{day\}，在空白处新建日程`\}/u);
  assert.match(calendar, /onClick=\{\(\) => openCreate\(day\)\}/u);
  assert.match(calendar, /relative z-10 mt-1.5 hidden space-y-1/u);
  assert.match(calendar, /onClick=\{\(\) => openEdit\(event\)\}/u);
});

test('main pages share compact headers and optional search/filter panel next to creation', () => {
  const calendar = source('./src/pages/calendar-page.tsx');
  const tasks = source('./src/pages/tasks-page.tsx');
  assert.match(calendar, /<PageHeader title="家庭日程" mobileTitle="日程" compactMobile mobileActions=/u);
  assert.match(tasks, /<PageHeader title="家庭待办" mobileTitle="待办" mobileActions=/u);
  assert.match(calendar, /aria-expanded=\{filtersExpanded\}/u);
  assert.match(tasks, /aria-expanded=\{filterOpen\}/u);
  assert.match(calendar, /\{filterOpen \? <div id="calendar-search-filters"/u);
  assert.match(tasks, /\{filterOpen \? <div id="task-search-filters"/u);
});

test('dialog surfaces prevent backdrop scrolling and use auto-hidden thin scrollbars', () => {
  const hook = source('./src/lib/modal-scroll.ts');
  const behavior = source('./src/components/ui/modal-behavior.tsx');
  const css = source('./src/styles.css');
  const calendar = source('./src/pages/calendar-page.tsx');
  const tasks = source('./src/pages/tasks-page.tsx');
  assert.match(hook, /body\.style\.position = 'fixed'/u);
  assert.match(hook, /window\.scrollTo\(0, scrollY\)/u);
  assert.match(behavior, /setTimeout/u);
  assert.match(css, /\.scrollbar-overlay\.is-scrolling/u);
  assert.match(calendar, /useModalScrollLock\(Boolean\(draft \|\| expandedDay\)\)/u);
  assert.match(tasks, /<ModalScrollLock \/>/u);
});
