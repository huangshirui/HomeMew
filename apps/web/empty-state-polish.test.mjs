import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

test('shared empty state supports optional next action', () => {
  const emptyState = source('./src/components/ui/empty-state.tsx');

  assert.match(emptyState, /export function EmptyState/u);
  assert.match(emptyState, /actionLabel && onAction/u);
  assert.match(emptyState, /onClick=\{onAction\}/u);
});

test('Tasks empty states offer the useful next step', () => {
  const tasks = source('./src/pages/tasks-page.tsx');

  assert.match(tasks, /<EmptyState/u);
  assert.match(tasks, /actionLabel=\{query \? '清除搜索'/u);
  assert.match(tasks, /setQueryInput\(''\); setQuery\(''\);/u);
  assert.match(tasks, /'新建待办'/u);
});

test('Days and Wishes active empty states can create directly', () => {
  const days = source('./src/pages/days-page.tsx');
  const wishes = source('./src/pages/wishes-page.tsx');

  assert.match(days, /actionLabel=\{status === 'active' && canWrite \? '新建日子'/u);
  assert.match(days, /onAction=\{status === 'active' && canWrite \? openCreate/u);
  assert.match(wishes, /actionLabel=\{tab === 'active' && canWrite \? '写下第一个愿望'/u);
  assert.match(wishes, /onAction=\{tab === 'active' && canWrite \? openCreate/u);
});
