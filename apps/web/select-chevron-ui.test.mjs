import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8');
const football = readFileSync(new URL('./src/pages/football-page.tsx', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('./src/pages/calendar-page.tsx', import.meta.url), 'utf8');
const tasks = readFileSync(new URL('./src/pages/tasks-page.tsx', import.meta.url), 'utf8');

test('all single native selects use one standard chevron inset instead of native edge-aligned arrow', () => {
  assert.match(styles, /select:not\(\[multiple\]\):not\(\[size\]\)/);
  assert.match(styles, /-webkit-appearance:\s*none/);
  assert.match(styles, /appearance:\s*none/);
  assert.match(styles, /padding-right:\s*2\.75rem/);
  assert.match(styles, /background-position:\s*right 0\.875rem center/);
  assert.match(styles, /background-repeat:\s*no-repeat/);
  assert.match(styles, /background-size:\s*1rem 1rem/);
  for (const source of [football, calendar, tasks]) assert.match(source, /<select/);
});

test('calendar and task dropdowns inherit the global single-select spacing without per-page overrides', () => {
  assert.doesNotMatch(calendar, /-webkit-appearance\s*:/);
  assert.doesNotMatch(tasks, /-webkit-appearance\s*:/);
});
