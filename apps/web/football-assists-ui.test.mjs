import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./src/pages/football-page.tsx', import.meta.url), 'utf8');

test('football goal supports optional assister without fabricating unassisted facts', () => {
  assert.match(source, /assisterPersonId\?: string \| null/u);
  assert.match(source, /type GoalDraft = \{ scorerPersonId: string; assisterPersonId: string;/u);
  assert.match(source, /助攻球员（可选）/u);
  assert.match(source, /<option value="">未登记助攻<\/option>/u);
  assert.match(source, /goalDraft\.assisterPersonId && goalDraft\.assisterPersonId === goalDraft\.scorerPersonId/u);
  assert.match(source, /\.\.\.\(goalDraft\.assisterPersonId \? \{ assisterPersonId: goalDraft\.assisterPersonId \} : \{\}\)/u);
  assert.match(source, /g\.assisterPersonId \?/u);
});

test('per-player goals and assists use explicit appearances as denominator', () => {
  assert.match(source, /function calculatePlayerPerformance\(/u);
  assert.match(source, /new Set\(match\.playerPersonIds \?\? \[\]\)/u);
  assert.match(source, /householdPersonIds\.has\(personId\)/u);
  assert.match(source, /householdPersonIds\.has\(goal\.scorerPersonId\)/u);
  assert.match(source, /householdPersonIds\.has\(goal\.assisterPersonId\)/u);
  assert.match(source, /goalsPerMatch: total\.played \? total\.scored \/ total\.played : null/u);
  assert.match(source, /assistsPerMatch: total\.played \? total\.assisted \/ total\.played : null/u);
  assert.match(source, /场均进球 \{v\.goalsPerMatch === null \? '—'/u);
  assert.match(source, /场均助攻 \{v\.assistsPerMatch === null \? '—'/u);
  assert.match(source, /id:'stats',label:'球员统计'/u);
});

test('absence of a known goal assist cannot become a team statistic', () => {
  assert.doesNotMatch(source, /totalAssistsFromTeamScore/u);
  assert.doesNotMatch(source, /assists\s*=\s*stats\.scored/u);
  assert.match(source, /未登记助攻不等于确定无人助攻/u);
});
