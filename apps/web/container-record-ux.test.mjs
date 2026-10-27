import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const relations = read('./src/components/container-relations.tsx');
const domain = read('./src/pages/domain-page.tsx');
const actions = read('./src/components/record-lifecycle-menu.tsx');

test('Linked records show hydrated title/summary instead of internal record ID', () => {
  assert.match(relations, /hydrate: direction === 'source' \? 'target' : 'source'/);
  assert.match(relations, /sourceRecord\?: RelatedRecord; targetRecord\?: RelatedRecord/);
  assert.match(relations, /record\?\.name, record\?\.summary, record\?\.title/);
  assert.match(relations, /normalized !== id/);
  assert.match(relations, /!\/\^rec_/);
  assert.match(relations, /return '名称暂不可用'/);
  assert.match(relations, /outgoingDirection \? edge\.targetRecord : edge\.sourceRecord/);
  assert.match(relations, /\{title\}/);
  assert.doesNotMatch(relations, /\{title \|\| target\.recordId\}/);
  assert.match(relations, /\$\{model\.route\}\/\$\{encodeURIComponent\(target\.recordId\)\}/);
});

test('Goal and Habit lifecycle operations are only in a separate menu with confirmation', () => {
  assert.match(actions, /export function lifecycleOptions/);
  assert.match(actions, /export function RecordLifecycleMenu/);
  assert.match(actions, /<details ref=\{menu\}/);
  assert.match(actions, /window\.confirm/);
  assert.match(actions, /onAction\(action\.key\)/);
  assert.match(actions, /aria-label=\{\`更多操作：\$\{recordName\}\`\}/);
  assert.match(domain, /<RecordLifecycleMenu model=\{modelKey\}/);
  assert.match(relations, /<RecordLifecycleMenu model=\{modelKey\}/);
  assert.doesNotMatch(domain, /onClick=\{\(\) => void action\(record,'abandon'\)\}/);
  assert.doesNotMatch(domain, /onClick=\{\(\) => void action\(record,'achieve'\)\}/);
  assert.doesNotMatch(domain, /onClick=\{\(\) => void action\(record,'end'\)\}/);
  assert.match(domain, /今天打卡/);
  assert.match(relations, /当前状态：/);
});

test('No extra model data writes or unbounded queries for relation titles', () => {
  assert.match(relations, /sourceRecord\?: RelatedRecord; targetRecord\?: RelatedRecord/);
  assert.doesNotMatch(relations, /Promise\.all\(outgoing\.map\(/);
  assert.match(relations, /limit: '50'/);
});
test('candidate picker supports Wish title and does not expose raw IDs as labels', () => {
  assert.match(relations, /type Candidate = \{ id: string; name\?: string; summary\?: string; title\?: string \}/);
  assert.match(relations, /item\.name \|\| item\.summary \|\| item\.title \|\| '名称暂不可用'/);
  assert.match(relations, /const values = \[label, record\?\.name, record\?\.summary, record\?\.title/);
});
