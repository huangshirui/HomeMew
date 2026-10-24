import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUniqueFootballReferences } from './src/pages/football-reference-hydration.ts';

test('same activity referenced by multiple matches is loaded once', async () => {
  const calls = [];
  const result = await fetchUniqueFootballReferences(['act_1','act_1','act_2','act_1'],
    async id => { calls.push(id); return {id, name: id === 'act_1' ? '校园足球联赛' : '秋季杯赛'}; });
  assert.deepEqual(calls, ['act_1','act_2']);
  assert.deepEqual(result.found.map(x=>x.name), ['校园足球联赛','秋季杯赛']);
  assert.deepEqual(result.failedIds, []);
});

test('reference lookups keep bounded parallel requests independent of activity directory size', async () => {
  let active = 0;
  let max = 0;
  const ids = Array.from({length:35},(_,i)=>'act_'+i);
  const result = await fetchUniqueFootballReferences(ids, async id => {
    active++; max=Math.max(max,active);
    await Promise.resolve();await Promise.resolve();
    active--;
    return {id};
  }, 4);
  assert.equal(result.found.length, ids.length);
  assert.ok(max<=4);
  assert.ok(max>=1);
});

test('one invalid activity does not hide valid competition names', async () => {
  const result = await fetchUniqueFootballReferences(['act_ok','act_gone','act_ok'],
    async id => {
      if(id==='act_gone') throw Error('not found');
      return {id, name:'少年联赛'};
    });
  assert.deepEqual(result.found.map(x=>x.name), ['少年联赛']);
  assert.deepEqual(result.failedIds, ['act_gone']);
});
