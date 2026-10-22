import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./src/pages/calendar-page.tsx', import.meta.url)), 'utf8');

test('calendar searches all family events through canonical search with pagination', () => {
  assert.match(source, /search: \{ text: appliedSearch \}/u);
  assert.match(source, /searchActive \? \[\] : \[\{/u, 'search removes the visible-period restriction');
  assert.match(source, /field: 'status', op: 'eq' as const, value: 'active'/u);
  assert.match(source, /nextSearchCursor/u);
  assert.match(source, /queryEvents\(nextSearchCursor\)/u);
  assert.match(source, /加载更多结果/u);
  assert.match(source, /setAppliedSearch\(searchInput\.trim\(\)\)/u);
  assert.match(source, /清除/u);
});

test('calendar filters by LifeSpace person reference and temporal kind without frontend-only omissions', () => {
  assert.match(source, /field: 'attendeePersonIds', op: 'contains' as const/u);
  assert.match(source, /field: 'when', op: 'kindIs' as const/u);
  assert.match(source, /value=\{attendeeFilter\}/u);
  assert.match(source, /value=\{kindFilter\}/u);
  assert.match(source, /重置筛选/u);
});

test('month and week views query different half-open local date windows', () => {
  assert.match(source, /view === 'month' \? monthGrid\(month\) : Array\.from\(\{ length: 7 \}/u);
  assert.match(source, /const gridEndExclusive = addDays\(gridDays\[gridDays\.length - 1\], 1\)/u);
  assert.match(source, /kind: 'local_date_window'/u);
  assert.match(source, /context: \{ viewingTimezone: currentFamily\.timezone \}/u);
  assert.match(source, /startOfWeek\(/u);
  assert.match(source, /navigatePeriod\(-1\)/u);
  assert.match(source, /navigatePeriod\(1\)/u);
  assert.match(source, /switchView\('week'\)/u);
  assert.match(source, /aria-pressed=\{view === 'week'\}/u);
  assert.match(source, /<WeekTimeGrid/u);
});

test('month overflow opens a complete daily list and phone uses touch-friendly agenda', () => {
  assert.match(source, /dayAnniversaries\.slice/u);
  assert.match(source, /dayEvents\.length \+ dayAnniversaries\.length > 4/u);
  assert.match(source, /onClick=\{\(\) => setExpandedDay\(day\)\}/u);
  assert.match(source, /events=\{eventsByDay\.get\(expandedDay\) \?\? \[\]\}/u);
  assert.match(source, /aria-modal="true"/u);
  assert.match(source, /<CalendarAgenda events=\{activeEvents\}/u);
  assert.match(source, /aria-pressed=\{isSelected\}/u);
});

test('view transitions ignore stale page responses', () => {
  assert.match(source, /requestGeneration = useRef\(0\)/u);
  assert.match(source, /generation !== requestGeneration\.current/u);
  assert.match(source, /return \(\) => \{ requestGeneration\.current \+= 1; \}/u);
});
