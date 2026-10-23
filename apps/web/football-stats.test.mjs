import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFootballStats } from './src/pages/football-stats.ts';

const match = (id, date, players = ['p1']) => ({ id, matchDate: date, playerPersonIds: players });
const event = (id, matchId, performanceType, minutesPlayed = null, playerPersonId = 'p1') =>
  ({id, matchId, playerPersonId, performanceType, minutesPlayed});

test('overall stats and monthly per-match rates use roster participation, not 90-minute normalization', () => {
  const matches = [match('m1','2026-05-03'),match('m2','2026-05-12'),match('m3','2026-05-28')];
  const events = [
    event('a1','m1','appearance',20),event('a2','m1','appearance',15),
    event('a3','m2','appearance',25),
    event('a4','m3','appearance',null),
    event('g1','m1','goal'),event('g2','m1','goal'),event('g3','m3','goal'),
    event('s1','m3','assist'),event('s2','m3','assist'),
    event('t1','m1','tackle'),event('t2','m2','tackle'),event('i1','m3','interception'),
  ];
  const result = buildFootballStats(matches,events,'p1');
  assert.deepEqual([result.matches,result.goals,result.assists,result.knownMinutes,result.completeMinutesMatches],[3,3,2,60,2]);
  const may = result.months[0];
  assert.equal(may.month,'2026-05');
  assert.equal(may.goalsPerMatch,1);
  assert.equal(may.assistsPerMatch,2/3);
  assert.equal(may.tacklesPerMatch,2/3);
  assert.equal(may.interceptionsPerMatch,1/3);
  assert.equal(may.minutesPerGoal,30); // 60 min / 2 goals in covered m1+m2; m3 goal excluded.
  assert.equal(may.minutesPerAssist,null); // No assists in the covered matches.
  assert.equal(may.goalsInTimedMatches,2);
  assert.equal(may.assistsInTimedMatches,0);
});

test('partially recorded appearance segments exclude their entire match from time metrics', () => {
  const matches=[match('a','2026-10-02'),match('b','2026-10-15')];
  const events=[
    event('a1','a','appearance',30),event('a2','a','appearance',null),
    event('b1','b','appearance',42),
    event('goal1','a','goal'),event('goal2','b','goal'),event('assist','a','assist'),
  ];
  const result=buildFootballStats(matches,events,'p1');
  assert.equal(result.months[0].completeMinutesMatches,1);
  assert.equal(result.months[0].knownMinutes,42);
  assert.equal(result.months[0].minutesPerGoal,42);
  assert.equal(result.months[0].minutesPerAssist,null);
  assert.equal(result.months[0].goalsPerMatch,1);
  assert.equal(result.goals,2);
});

test('monthly chart includes empty calendar months with 0 games and undefined averages', () => {
  const result=buildFootballStats([match('a','2026-05-10'),match('b','2026-07-25')], [], 'p1');
  assert.deepEqual(result.months.map(x=>x.month),['2026-05','2026-06','2026-07']);
  assert.equal(result.months[1].matches,0);
  assert.equal(result.months[1].goalsPerMatch,null);
  assert.equal(result.months[1].tacklesPerMatch,null);
  assert.equal(result.months[0].minutesPerGoal,null);
  assert.equal(result.completeMinutesMatches,0);
  assert.equal(result.knownMinutes,0);
});

test('event filtering excludes non-player records, other matches, and non-roster appearances', () => {
  const matches=[match('yes','2026-07-01'),match('not-on-roster','2026-07-02',['p2'])];
  const events=[
    event('a','yes','appearance',40),event('x','yes','goal'),
    event('b','not-on-roster','goal'),event('c','other','goal'),
    event('d','yes','goal',null,'p2'),
  ];
  const result=buildFootballStats(matches,events,'p1');
  assert.equal(result.matches,1);
  assert.equal(result.goals,1);
  assert.equal(result.months[0].minutesPerGoal,40);
});

test('month-only totals and time-cohort rates are never mixed', () => {
  const matches=[match('a','2026-06-01'),match('b','2026-06-20')];
  const events=[
    event('a0','a','appearance',50),event('b0','b','appearance',null),
    event('g','b','goal'),event('u','b','assist'),
  ];
  const june=buildFootballStats(matches,events,'p1').months[0];
  assert.equal(june.goalsPerMatch,.5);
  assert.equal(june.assistsPerMatch,.5);
  assert.equal(june.minutesPerGoal,null);
  assert.equal(june.minutesPerAssist,null);
  assert.equal(june.knownMinutes,50);
  assert.equal(june.completeMinutesMatches,1);
});

test('duplicate match rows do not inflate game counts and stats are null when no matches', () => {
  const m=match('m','2026-05-01');
  const dup=buildFootballStats([m,m],[], 'p1');
  assert.equal(dup.matches,1);
  assert.equal(dup.months[0].matches,1);
  const empty=buildFootballStats([],[], 'p1');
  assert.deepEqual(empty.months,[]);
  assert.equal(empty.matches,0);
  assert.equal(empty.knownMinutes,0);
});
