import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./src/pages/tasks-page.tsx', import.meta.url)), 'utf8');

test('task filtering composes status, person reference, due-date and keyword in one canonical query', () => {
  assert.match(source, /const filters: CanonicalQueryFilter\[\] = \[/u);
  assert.match(source, /field: 'status', op: 'eq', value: tab/u);
  assert.match(source, /field: 'assigneePersonIds', op: 'contains', value: assigneeFilter/u);
  assert.match(source, /field: 'dueDate', op: 'lt', value: today/u);
  assert.match(source, /field: 'dueDate', op: 'eq', value: today/u);
  assert.match(source, /field: 'dueDate',\s*op: 'within',\s*value:/u);
  assert.match(source, /kind: 'local_date_window'/u);
  assert.match(source, /endDateExclusive: addDateDays\(today, 7\)/u);
  assert.match(source, /timezone: currentFamily\.timezone/u);
  assert.match(source, /field: 'dueDate', op: 'isNull'/u);
  assert.match(source, /search: \{ text: query \}/u);
  assert.match(source, /filter: \{ and: filters \}/u);
  assert.match(source, /queryModelRecords<TaskRecord>\(currentFamily\.id, 'task'/u);
  assert.match(source, /cursor = page.nextCursor/u);
});

test('task filter toolbar is mobile friendly and follows calendar search and filter language', () => {
  assert.match(source, /role="search"/u);
  assert.match(source, /aria-label="按负责人筛选"/u);
  assert.match(source, /aria-label="按截止日期筛选"/u);
  assert.match(source, /value=\{assigneeFilter\}/u);
  assert.match(source, /value=\{dueFilter\}/u);
  assert.match(source, /flex flex-wrap items-center gap-2/u);
  assert.match(source, /全部负责人/u);
  assert.match(source, /已逾期/u);
  assert.match(source, /今天截止/u);
  assert.match(source, /未来 7 天/u);
  assert.match(source, /无截止日期/u);
  assert.match(source, /重置筛选/u);
});

test('overdue only applies to pending tasks and is not shown in completed tab', () => {
  assert.match(source, /dueFilter === 'overdue' && tab === 'pending'/u);
  assert.match(source, /tab === 'pending' \? <option value="overdue">已逾期<\/option> : null/u);
  assert.match(source, /setTab\('completed'\); if \(dueFilter === 'overdue'\) setDueFilter\('all'\)/u);
});

test('switching family and changing filters reject late task responses', () => {
  assert.match(source, /requestGeneration = useRef\(0\)/u);
  assert.match(source, /generation !== requestGeneration\.current/u);
  assert.match(source, /return \(\) => \{ requestGeneration\.current \+= 1; \}/u);
  assert.match(source, /setAssigneeFilter\(''\)/u);
  assert.match(source, /setDueFilter\('all'\)/u);
  assert.match(source, /query \|\| assigneeFilter \|\| dueFilter !== 'all'/u);
});
