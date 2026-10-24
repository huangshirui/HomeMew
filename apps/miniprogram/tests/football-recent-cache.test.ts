import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFootballRecent, rememberFootballRecent, removeFootballRecent } from '../miniprogram/utils/football-recent-cache.ts';
import { readFileSync } from 'node:fs';

const store = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync(key: string) { return store.get(key) ?? ''; },
  setStorageSync(key: string, value: unknown) { store.set(key, value); },
};
beforeEach(() => store.clear());

test('Mini recent team and competition choices stay scoped to user and Space', () => {
  rememberFootballRecent('usr_A','spc_A','team', { id:'rec_t1', name:'中国队' });
  rememberFootballRecent('usr_A','spc_A','competition', { id:'rec_a1', name:'联赛' });
  assert.deepEqual(readFootballRecent('usr_A','spc_A','team').map(x=>x.name),['中国队']);
  assert.deepEqual(readFootballRecent('usr_A','spc_A','competition').map(x=>x.name),['联赛']);
  assert.deepEqual(readFootballRecent('usr_B','spc_A','team'),[]);
  assert.deepEqual(readFootballRecent('usr_A','spc_B','team'),[]);
});

test('Mini recents deduplicate and stay at 12 most recently chosen', () => {
  for (let i=0;i<15;i++) rememberFootballRecent('u','s','team', {id:'t'+i,name:'球'+i});
  const rows = rememberFootballRecent('u','s','team',{id:'t9',name:'九队'});
  assert.equal(rows.length,12);
  assert.equal(rows[0].name,'九队');
  assert.equal(rows.filter(x=>x.id==='t9').length,1);
});

test('Mini cross removes the cache entry without deleting the platform record', () => {
  rememberFootballRecent('u','s','competition',{id:'a',name:'甲'},Date.now());
  rememberFootballRecent('u','s','competition',{id:'b',name:'乙'},Date.now());
  assert.deepEqual(removeFootballRecent('u','s','competition','a').map(x=>x.id),['b']);
  assert.deepEqual(readFootballRecent('u','s','competition').map(x=>x.id),['b']);
});

test('Mini recents expire and tolerate blocked storage', () => {
  const now=Date.now();
  rememberFootballRecent('u','s','team',{id:'old',name:'旧球队'},now-91*24*3600*1000);
  assert.deepEqual(readFootballRecent('u','s','team',now),[]);
  (globalThis as any).wx.getStorageSync = () => { throw Error('blocked'); };
  assert.deepEqual(readFootballRecent('u','s','team'),[]);
  (globalThis as any).wx.setStorageSync = () => { throw Error('blocked'); };
  assert.deepEqual(rememberFootballRecent('u','s','team',{id:'x',name:'X'}),[]);
});

test('Mini reusable picker includes distinct select and cache-remove controls', () => {
  const template = readFileSync(new URL('../miniprogram/components/football-recent-picker/index.wxml', import.meta.url),'utf8');
  assert.match(template,/catchtap="onForget"/);
  assert.match(template,/bindtap="onPick"/);
  assert.match(template,/从本机缓存移除/);
  const logic = readFileSync(new URL('../miniprogram/components/football-recent-picker/index.ts', import.meta.url),'utf8');
  assert.match(logic,/rememberVerifiedSelection/);
  assert.match(logic,/this.triggerEvent\('select'/);
});
