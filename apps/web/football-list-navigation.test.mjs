import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberFootballList, consumeFootballList } from './src/pages/football-list-navigation.ts';

const storage = new Map();
globalThis.sessionStorage = {
  setItem: (key, value) => storage.set(key, value),
  getItem: key => storage.get(key) ?? null,
  removeItem: key => storage.delete(key),
};
const state = {
  tab: 'record', filters: {year:'2026',matchType:'official',representativeTeamId:'team_a',
    opponentTeamId:'',competitionActivityId:'',playerPersonId:'p1'},
  searchInput:'天气',appliedSearch:'天气',filterOpen:true,scrollY:850,
};

test('a match detail roundtrip restores filters, search and scroll once', () => {
  rememberFootballList('space_1','user_a',state);
  assert.deepEqual(consumeFootballList('space_1','user_a'),state);
  assert.equal(consumeFootballList('space_1','user_a'),null);
});

test('a different family or user never consumes another list state', () => {
  rememberFootballList('space_1','user_a',state);
  assert.equal(consumeFootballList('space_2','user_a'),null);
  assert.equal(consumeFootballList('space_1','user_b'),null);
  assert.deepEqual(consumeFootballList('space_1','user_a'),state);
});

test('malformed or expired list snapshots do not restore state', () => {
  rememberFootballList('space_1','user_a',state);
  const key=[...storage.keys()][0];
  const old=JSON.parse(storage.get(key));
  storage.set(key,JSON.stringify({...old,savedAt:Date.now()-31*60*1000}));
  assert.equal(consumeFootballList('space_1','user_a'),null);
  rememberFootballList('space_1','user_a',state);
  storage.set(key,'broken-json');
  assert.equal(consumeFootballList('space_1','user_a'),null);
});

test('state preservation is optional when browser storage is unavailable', () => {
  const original=globalThis.sessionStorage;
  Object.defineProperty(globalThis,'sessionStorage',{get:()=>{throw Error('blocked');},configurable:true});
  assert.doesNotThrow(()=>rememberFootballList('space','user',state));
  assert.equal(consumeFootballList('space','user'),null);
  Object.defineProperty(globalThis,'sessionStorage',{value:original,configurable:true,writable:true});
});
