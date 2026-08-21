import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relative: string): string {
  return readFileSync(new URL(`../miniprogram/services/${relative}`, import.meta.url), 'utf8');
}

test('LifeSpace resource base requires audit actors and maps them to HomeMew actors', () => {
  const lifespace = source('lifespace.ts');
  assert.match(lifespace, /createdBy:\s*LifeSpaceAuditActor/);
  assert.match(lifespace, /updatedBy:\s*LifeSpaceAuditActor/);
  assert.match(lifespace, /export function auditActor/);
  assert.match(lifespace, /actor\.type === 'user' \? 'user' : 'system'/);
  assert.doesNotMatch(lifespace, /function unavailableActor/);
});

test('all metadata-domain adapters consume real createdBy and updatedBy actors', () => {
  for (const file of ['events.ts', 'tasks.ts', 'day-records.ts', 'wishes.ts']) {
    const text = source(file);
    assert.match(text, /createdBy:\s*auditActor\(raw\.createdBy\)/, `${file} must map createdBy`);
    assert.match(text, /updatedBy:\s*auditActor\(raw\.updatedBy\)/, `${file} must map updatedBy`);
    assert.doesNotMatch(text, /unavailableActor/, `${file} must not restore an empty audit placeholder`);
  }
});
