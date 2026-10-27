import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { candidateDisplayName, relationDisplayName } from '../miniprogram/utils/relation-display.ts';

test('relation label uses the authoritative LifeSpace referenceLabel', () => {
  assert.equal(relationDisplayName('rec_one', '正式显示名称', { name: '旧名称' }), '正式显示名称');
  assert.equal(relationDisplayName('rec_one', 'rec_one', { summary: '足球训练' }), '足球训练');
  assert.equal(relationDisplayName('rec_one', undefined, { title: '我的愿望' }), '我的愿望');
  assert.equal(relationDisplayName('rec_one', '', undefined), '名称暂不可用');
  assert.equal(relationDisplayName('rec_one', 'rec_other', undefined), '名称暂不可用');
});

test('linked candidates display the actual model-owned field, not a guessed name', () => {
  assert.equal(candidateDisplayName('task', { id: 'rec_a', name: '提交作业' }), '提交作业');
  assert.equal(candidateDisplayName('event', { id: 'rec_b', summary: '足球训练' }), '足球训练');
  assert.equal(candidateDisplayName('wish', { id: 'rec_c', title: '去露营' }), '去露营');
  assert.equal(candidateDisplayName('day_record', { id: 'rec_d', name: '生日倒计时' }), '生日倒计时');
  assert.equal(candidateDisplayName('goal', { id: 'rec_e', name: '学会游泳' }), '学会游泳');
  assert.equal(candidateDisplayName('event', { id: 'rec_b', name: '错误的字段' }), '名称暂不可用');
});

test('Mini relation view and candidate search both consume the shared display helper', () => {
  const services = readFileSync(new URL('../miniprogram/services/domains.ts', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../miniprogram/pages/domains/detail.ts', import.meta.url), 'utf8');
  assert.match(services, /relationDisplayName\(refId, label, obj\)/);
  assert.match(detail, /readableCandidateTitle\(d\.linkType,x\)/);
  assert.match(detail, /readableRelationTitle\(edge,direction\)/);
});
