import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

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

test('the eight confirmed shortcuts remain separate from the complete published enum picker', () => {
  const raw = page.match(/const quickTypes = \[([^\]]+)\];/)?.[1] ?? '';
  const types = Array.from(raw.matchAll(/'([^']+)'/g), match => match[1]);
  assert.deepEqual(types, ['goal','assist','shot','key_pass','successful_dribble','tackle','interception','clearance']);
  assert.match(page, /types\.filter\(t => !quickTypes\.includes\(t\) && t !== 'appearance'\)/);
  assert.match(domain, /shot: '射门'/);
  assert.match(domain, /key_pass: '关键传球'/);
  assert.match(domain, /successful_dribble: '成功过人'/);
  assert.match(domain, /clearance: '解围'/);
});

function runFootballFunction(name, params) {
  const match = domain.match(new RegExp('export function ' + name + '\\([^]*?\\n}\\n'));
  assert.ok(match, 'Missing source function ' + name);
  const body = match[0].slice(match[0].indexOf('{'));
  return runInNewContext('(function ' + name + '(' + params + ') ' + body + ')', {
    enumOptions: (schema, field) => schema.fields.find(item => item.key === field)?.values ?? [],
  });
}

test('shot outcome follows published schema and never leaks to older definitions', () => {
  const build = runFootballFunction('performancePayload', 'draft, matchId, schema');
  const draft = {
    playerPersonId: 'person_1', performanceType: 'shot', goalMethod: '',
    shotOutcome: 'on_target', minutesPlayed: '', position: '', entryMode: '', notes: '',
  };
  const schema = { fields: [
    { key: 'performanceType', values: ['goal','shot','tackle'] },
    { key: 'goalMethod', values: ['header'] },
    { key: 'shotOutcome', values: ['on_target','off_target','blocked','woodwork','unknown'] },
  ] };
  const shot = build(draft, 'match_1', schema);
  assert.equal(shot.shotOutcome, 'on_target');
  assert.equal(shot.goalMethod, null);
  assert.equal(shot.minutesPlayed, null);
  assert.throws(() => build({ ...draft, shotOutcome: 'invalid' }, 'match_1', schema), /射门结果不在已发布模型中/);
  const tackle = build({ ...draft, performanceType: 'tackle' }, 'match_1', schema);
  assert.equal(tackle.shotOutcome, null);
  assert.equal(tackle.goalMethod, null);
  const oldSchema = { fields: [
    { key: 'performanceType', values: ['goal'] }, { key: 'goalMethod', values: ['header'] },
  ] };
  const oldGoal = build({ ...draft, performanceType: 'goal', goalMethod: 'header' }, 'match_1', oldSchema);
  assert.equal(oldGoal.goalMethod, 'header');
  assert.equal(Object.hasOwn(oldGoal, 'shotOutcome'), false);
  assert.throws(() => build(draft, 'match_1', oldSchema), /表现类型未在 LifeSpace 发布模型中声明/);
  assert.match(form, /enumOptions\(schema, 'shotOutcome'\)/);
  assert.match(form, /shotOutcomes\[key\] \?\? key/);
  assert.match(form, /shotOutcome: ''/);
});

test('overlapping shot, key-pass and goalkeeper-save totals are derived once', () => {
  const count = runFootballFunction('performanceEventCount', 'events, type');
  const events = [
    { performanceType: 'goal' }, { performanceType: 'shot' },
    { performanceType: 'assist' }, { performanceType: 'key_pass' },
    { performanceType: 'one_on_one_save' }, { performanceType: 'save' },
  ];
  assert.equal(count(events, 'shot'), 2);
  assert.equal(count(events, 'key_pass'), 2);
  assert.equal(count(events, 'save'), 2);
  assert.equal(count(events, 'goal'), 1);
  assert.equal(count(events, 'assist'), 1);
  assert.match(domain, /return performanceEventCount\(relevant, type\)/);
});
