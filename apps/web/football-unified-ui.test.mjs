import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./src/pages/football-page.tsx');
const form = read('./src/pages/football-performance-sheet.tsx');
const domain = read('./src/pages/football-domain.ts');
const picker = read('./src/pages/football-person-picker.tsx');

test('football module exposes only Record and Statistics as top-level navigation', () => {
  assert.match(page, /'record' \| 'stats'/);
  assert.match(page, /name: '记录'/);
  assert.match(page, /name: '统计'/);
  assert.doesNotMatch(page, /label:'球队与赛事'/);
  assert.match(page, /管理球队与赛事/);
});

test('quick actions only prepare a draft; explicit confirmation writes one performance', () => {
  assert.match(page, /onClick=\{\(\)=>startPerformance\(t\)\}/);
  assert.match(page, /setPerformanceForm\(record \? performanceDraft\(record\) : blankPerformance\(type, personId\)\)/);
  assert.match(page, /async function savePerformance\(e: FormEvent<HTMLFormElement>\)/);
  assert.match(page, /e\.preventDefault\(\)/);
  assert.match(page, /method: performanceEditing \? 'PATCH' : 'POST'/);
  assert.match(page, /setPerformanceForm\(null\); setPerformanceEditing\(null\)/);
  assert.match(form, /onSubmit=\{onSubmit\}/);
  assert.match(form, /确认保存/);
  assert.match(form, /saving \? '保存中…'/);
  assert.match(form, /底部|safe-area-inset-bottom/);
  assert.doesNotMatch(page, /async function saveGoal/u);
});

test('one source of truth: FootballPerformance replaces FootballGoal, with enum discovery', () => {
  assert.match(domain, /\/_discovery\/models\/football_performance/);
  assert.match(domain, /result\.fields/);
  assert.match(domain, /performanceType: draft\.performanceType/);
  assert.match(domain, /enumOptions\(schema, 'performanceType'\)/);
  assert.match(page, /enumOptions\(schema, 'performanceType'\)/);
  assert.match(form, /enumOptions\(schema, 'goalMethod'\)/);
  assert.match(form, /enumOptions\(schema, 'entryMode'\)/);
  assert.doesNotMatch(page, /'football_goal'/);
  assert.match(domain, /queryAllBounded/);
  assert.match(domain, /数据超过当前统计查询上限/);
});

test('match participants use bounded person directory search with household priority', () => {
  assert.match(picker, /\/people\?limit=50/);
  assert.match(picker, /family, \.\.\.people/);
  assert.match(picker, /search.trim\(\)/);
  assert.match(page, /label="参赛球员（家庭成员优先）"/);
  assert.match(page, /playerPersonIds\.includes\(performanceForm\.playerPersonId\)/);
});

test('analysis filters match scope before selecting a type-based metric', () => {
  for (const criterion of ['year','matchType','competitionActivityId','representativeTeamId','opponentTeamId','playerPersonId'])
    assert.match(domain, new RegExp(criterion));
  assert.match(page, /label="统计指标"|>统计指标/);
  assert.match(page, /label="图表分组"|>图表分组/);
  assert.match(domain, /draft\.performanceType === 'appearance'/);
  assert.match(domain, /goalsPerMatch/);
  assert.match(domain, /assistsPerMatch/);
  assert.match(domain, /countAppearances/);
  assert.match(domain, /new Set\(matches\.filter/);
});
