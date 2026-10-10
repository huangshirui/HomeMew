import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relative: string): string {
  return readFileSync(new URL(`../../web/${relative}`, import.meta.url), 'utf8');
}

function miniSource(relative: string): string {
  return readFileSync(new URL(`../miniprogram/${relative}`, import.meta.url), 'utf8');
}

test('BFF maps LifeSpace audit actors into every stable domain DTO', () => {
  for (const file of ['miniprogram-final-event-bff.mjs', 'miniprogram-task-wish-bff.mjs', 'miniprogram-day-diagnostic-bff.mjs']) {
    const text = source(file);
    assert.match(text, /createdBy:\s*actor\(raw\.createdBy\)/, file);
    assert.match(text, /updatedBy:\s*actor\(raw\.updatedBy\)/, file);
  }
});

test('event detail audit timestamps use one absolute datetime without relative-time duplication', () => {
  const text = miniSource('pages/events/detail.ts');
  assert.doesNotMatch(text, /\btimeAgo\b/);
  assert.match(text, /createdAtText:\s*formatDate\(event\.createdAt,\s*'datetime'\)/);
  assert.match(text, /updatedAtText:\s*formatDate\(event\.updatedAt,\s*'datetime'\)/);
});
