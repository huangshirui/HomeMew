import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readRecentFootballReferences, rememberFootballReference, forgetFootballReference,
} from './src/pages/football-recent-references.ts';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    keys: () => [...map.keys()],
    corrupt: (key, value) => map.set(key, value),
  };
}

test('football recents isolate authenticated user, Space and model', () => {
  const s = fakeStorage();
  rememberFootballReference('usr_1', 'spc_a', 'person_group', {id:'team_1',name:'中国队'}, s);
  rememberFootballReference('usr_1', 'spc_a', 'activity', {id:'act_1',name:'赛事A'}, s);
  assert.deepEqual(readRecentFootballReferences('usr_1','spc_a','person_group',s).map(x=>x.name), ['中国队']);
  assert.deepEqual(readRecentFootballReferences('usr_1','spc_a','activity',s).map(x=>x.name), ['赛事A']);
  assert.equal(readRecentFootballReferences('usr_2','spc_a','person_group',s).length, 0);
  assert.equal(readRecentFootballReferences('usr_1','spc_b','person_group',s).length, 0);
});

test('recent football choices deduplicate, order newest first and cap at 12', () => {
  const s = fakeStorage();
  for (let i = 0; i < 18; i++) rememberFootballReference('u', 's', 'person_group', {id:'t'+i,name:'球队'+i}, s);
  let rows = readRecentFootballReferences('u','s','person_group',s);
  assert.equal(rows.length, 12);
  assert.equal(rows[0].id, 't17');
  rows = rememberFootballReference('u','s','person_group', {id:'t10',name:'更新球队名'}, s);
  assert.equal(rows.length, 12);
  assert.equal(rows[0].name, '更新球队名');
  assert.equal(rows.filter(x=>x.id==='t10').length, 1);
});

test('cross button forgets only local history; no business record is touched', () => {
  const s = fakeStorage();
  rememberFootballReference('u','s','activity', {id:'a1',name:'校园联赛'}, s);
  rememberFootballReference('u','s','activity', {id:'a2',name:'友谊杯'}, s);
  const remaining = forgetFootballReference('u','s','activity','a1',s);
  assert.deepEqual(remaining.map(x=>x.id),['a2']);
  assert.equal(readRecentFootballReferences('u','s','activity',s).length,1);
});

test('expires stale suggestions and ignores malformed or disabled local storage', () => {
  const s = fakeStorage();
  const now = Date.now();
  rememberFootballReference('u','s','person_group',{id:'a',name:'球队'},s,now-91*24*3600*1000);
  assert.deepEqual(readRecentFootballReferences('u','s','person_group',s,now),[]);
  const storage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.deepEqual(readRecentFootballReferences('u','s','activity',storage),[]);
  assert.deepEqual(rememberFootballReference('u','s','activity',{id:'x',name:'Y'},storage),[]);
  assert.deepEqual(forgetFootballReference('u','s','activity','x',storage),[]);
});
