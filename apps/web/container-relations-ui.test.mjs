import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./src/pages/domain-page.tsx', import.meta.url), 'utf8');
const container = readFileSync(new URL('./src/components/container-relations.tsx', import.meta.url), 'utf8');

test('Goal and Habit default to active without an all-status tab or full collection filtering', () => {
  assert.match(page, /useState<Status>\('active'\)/);
  assert.match(page, /setStatusFilter\('active'\)/);
  assert.match(page, /filter: \{ field: 'status' as const, op: 'eq' as const, value: statusFilter \}/);
  assert.doesNotMatch(page, /\['all','active','paused'/);
  assert.match(page, /requestGeneration\.current/);
});

test('Activity Goal and Habit share actual container-detail links, respecting Habit owner permissions', () => {
  assert.match(page, /<ContainerRelations/);
  assert.match(page, /modelKey !== 'anniversary' \? <Button variant="secondary" onClick=\{\(\) => setContainerFor\(record\)\}/);
  assert.match(page, /writable=\{canManage\(containerFor\)\}/);
  assert.match(page, /myPersonId === record\.subjectPersonId/);
  assert.match(container, /\/semantic-relations/);
  assert.match(container, /hydrate: direction === 'source' \? 'target' : 'source'/);
  assert.match(container, /method: 'POST', body: JSON\.stringify\(\{[\s\S]*predicate: 'relates_to'/);
  assert.match(container, /method: 'DELETE'/);
});

test('Activity countdown and related Task create source-owned links atomically', () => {
  assert.match(container, /新建关联倒计时/);
  assert.match(container, /kind: 'countdown', anchorDate: countdownDate/);
  assert.match(container, /modelKey: 'day_record', clientRef: 'countdown'/);
  assert.match(container, /modelKey: 'task', clientRef: 'task'/);
  assert.match(container, /operation: 'relation_create'/);
  assert.match(container, /source: ref\('activity', record\.id\)/);
  assert.match(container, /source: ref\(modelKey, record\.id\)/);
  assert.match(container, /atomicConsistency: true/);
  assert.match(container, /daysUntil\(day\.anchorDate, timezone\)/);
});
