import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./src/pages/football-page.tsx');
const form = read('./src/pages/football-performance-sheet.tsx');
const domain = read('./src/pages/football-domain.ts');
const app = read('./src/app.tsx');
const picker = read('./src/pages/football-person-picker.tsx');
const referencePicker = read('./src/pages/football-reference-picker.tsx');
const manage = read('./src/pages/football-manage-page.tsx');
const dashboard = read('./src/pages/football-stats-dashboard.tsx');
const stats = read('./src/pages/football-stats.ts');

test('football module exposes only Record and Statistics as top-level navigation', () => {
  assert.match(page, /'record' \| 'stats'/);
  assert.match(page, /name: '记录'/);
  assert.match(page, /name: '统计'/);
  assert.doesNotMatch(page, /label:'球队与赛事'/);
  assert.match(page, /navigate\('\/football\/manage'\)/);
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
  assert.match(picker, /family, \.\.\.knownPeople, \.\.\.people/);
  assert.match(picker, /search.trim\(\)/);
  assert.match(page, /label="参赛球员（家庭成员优先）"/);
  assert.match(page, /playerPersonIds\.includes\(performanceForm\.playerPersonId\)/);
});

test('statistics use filtered LifeSpace records with a natural-month dashboard', () => {
  for (const criterion of ['year','matchType','competitionActivityId','representativeTeamId','opponentTeamId','playerPersonId'])
    assert.match(domain, new RegExp(criterion));
  assert.match(page, /<FootballStatsDashboard matches=\{statMatches\} events=\{statEvents\}/);
  assert.doesNotMatch(page, /label="统计指标"|>统计指标/);
  assert.doesNotMatch(page, /label="图表分组"|>图表分组/);
  assert.match(stats, /buildFootballStats/);
  assert.match(dashboard, /总体数据/);
  assert.match(dashboard, /label="胜率"/);
  assert.match(dashboard, /stats\.winRate/);
  assert.match(dashboard, /有比分 /);
  assert.match(stats, /scoredMatches/);
  assert.match(stats, /wins/);
  assert.match(dashboard, /专项趋势/);
  assert.match(dashboard, /场均进攻/);
  assert.match(dashboard, /进攻效率/);
  assert.match(dashboard, /场均防守/);
  assert.match(dashboard, /每月参赛场次/);
  assert.match(dashboard, /已记时长 /);
  assert.match(stats, /goalsInTimedMatches/);
  assert.match(stats, /assistsInTimedMatches/);
});

test('the eight confirmed shortcuts remain separate from the complete published enum picker', () => {
  const raw = page.match(/const quickTypes = \[([^\]]+)\];/)?.[1] ?? '';
  const types = Array.from(raw.matchAll(/'([^']+)'/g), match => match[1]);
  assert.deepEqual(types, ['goal','assist','shot','key_pass','successful_dribble','tackle','interception','clearance']);
  assert.match(page, /const moreTypes = types\.filter\(t => !quickTypes\.includes\(t\) && t !== 'appearance'\)/);
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

test('relationship filters use LifeSpace Canonical Query contains rather than unsupported eq', () => {
  assert.match(page, /field: 'matchId', op: 'contains'/);
  assert.match(page, /field: 'playerPersonId', op: 'contains'/);
  assert.doesNotMatch(page, /field: 'matchId', op: 'eq'/);
  assert.doesNotMatch(page, /field: 'playerPersonId', op: 'eq'/);
  assert.match(domain, /field === 'matchType' \? 'eq' : 'contains'/);
  // matchQueryFilter contains TypeScript annotations, so assert its source contract
  // rather than evaluating raw TypeScript in a JavaScript-only vm.
  assert.match(domain, /\['matchType','representativeTeamId','opponentTeamId','competitionActivityId'\]/);
  assert.match(domain, /field === 'matchType' \? 'eq' : 'contains'/);
  assert.match(domain, /field: 'playerPersonIds', op: 'contains'/);
  assert.match(page, /setEventsError\(message\(e\)\)/);
  assert.match(page, /!eventsError && !performances.length/);
});

test('quick-record cards match the confirmed icon and neutral visual design', () => {
  for (const icon of ['⚽', '👟', '🎯', '💡', '✨', '🛡️', '✂️', '🚀'])
    assert.ok(page.includes(icon), 'missing shortcut icon ' + icon);
  assert.match(page, /quickActionIcons\[t\]/);
  assert.doesNotMatch(page, /t === 'goal' \|\| t === 'assist' \? 'primary'/);
  assert.match(page, /border-stone-200 bg-white/);
  assert.match(page, /onClick=\{\(\)=>startPerformance\(t\)\}/);
  assert.match(page, /aria-expanded=\{moreOpen\}/);
  assert.match(page, /更多表现/);
  assert.match(page, /moreTypes\.map/);
  assert.match(domain, /appearance: '出场记录'/);
  assert.match(page, /出场记录/);
  assert.doesNotMatch(page, /出场片段/);
});

test('football filters reuse the Calendar/Tasks header standard and one global player selector', () => {
  assert.match(page, /aria-controls="football-search-filters"/);
  assert.match(page, /aria-expanded=\{filterOpen\}/);
  assert.match(page, /搜索与筛选/);
  assert.match(page, /新建比赛/);
  assert.match(page, /aria-label="按年份筛选"/);
  assert.match(page, /<option value="">全部年份<\/option>/);
  assert.match(page, /whitespace-nowrap text-sm text-stone-600">球员/);
  assert.doesNotMatch(page, /全部球员/);
  assert.match(page, /playerPersonId: personId/);
  assert.match(page, /重置筛选/);
});

test('football manager owns teams and unlinked players but never manages Activity list', () => {
  assert.match(app, /path="football\/manage" element=\{<FootballManagePage \/>}/);
  assert.match(page, /navigate\('\/football\/manage'\)/);
  assert.match(manage, /navigate\('\/activities'\)/);
  assert.match(manage, /赛事管理 → 活动/);
  assert.match(manage, /!p\.linkedUser && !familyPersonIds\.has\(p\.id\)/);
  assert.match(manage, /method: editingPerson \? 'PATCH' : 'POST'/);
  assert.match(manage, /method: editingTeam \? 'PATCH' : 'POST'/);
  assert.match(manage, /playerPersonIds', op: 'contains'/);
  assert.match(manage, /field: 'playerPersonId', op: 'contains'/);
  assert.doesNotMatch(manage, /queryModelRecords<FootballReference>\(spaceId, 'activity'/);
  assert.match(domain, /version: number; name: string; description/);
});

test('matches are a compact list, not full-height match cards', () => {
  assert.match(page, /matches\.map\(m => <div/);
  assert.match(page, /last:border-b-0/);
  assert.doesNotMatch(page, /matches\.map\(m => <Card/);
  assert.match(page, /加载更多比赛/);
});

test('football search uses the published FootballMatch notes searchable field', () => {
  assert.match(page, /placeholder="搜索比赛备注"/);
  assert.match(page, /role="search"/);
  assert.match(page, /search: \{ text: appliedSearch \}/);
  assert.match(page, /setAppliedSearch\(searchInput\.trim\(\)\)/);
  assert.match(page, /setAppliedSearch\(''\)/);
});

test('team and competition selectors support bounded debounced server autocomplete', () => {
  assert.match(page, /import \{ FootballReferencePicker \}/);
  assert.match(page, /model="person_group" label="代表球队"/);
  assert.match(page, /model="person_group" label="对手球队"/);
  assert.match(page, /model="activity" label="赛事"/);
  assert.match(referencePicker, /queryModelRecords<FootballReference>/);
  assert.match(referencePicker, /search: \{ text: term \}/);
  assert.match(referencePicker, /page: \{ limit: 20 \}/);
  assert.match(referencePicker, /window\.setTimeout/);
  assert.match(referencePicker, /320/);
  assert.match(referencePicker, /length >= 2/);
  assert.match(referencePicker, /modelUrl\(spaceId, model, value\)/);
  assert.match(referencePicker, /role="listbox"/);
  assert.match(referencePicker, /onChange\(id\)/);
  assert.match(referencePicker, /overlay\s*\?\s*'absolute right-0 top-full z-50 mt-2/);
  assert.match(referencePicker, /'relative z-30 mt-2 shadow-sm'/); // flow in modal, overlay in filter
  assert.match(page, /className="min-w-32 flex-1" overlay spaceId=\{spaceId\}/);
  assert.equal((page.match(/className="min-w-32 flex-1" overlay spaceId=\{spaceId\}/g) ?? []).length, 3);
});
test('reference lookup is bounded and Activity is never preloaded as a competition directory', () => {
  assert.doesNotMatch(page, /queryAllBounded<FootballReference>/);
  assert.match(page, /page: \{ limit: 30 \}/);
  assert.match(referencePicker, /page: \{ limit: 20 \}/);
  assert.match(manage, /readRecentFootballReferences/);
  assert.match(manage, /page: \{ limit: 50 \}/);
  assert.match(manage, /aria-label="搜索球队"/);
  assert.doesNotMatch(manage, /搜索定位球队|value=\{teamFocus\}/);
  assert.match(manage, /queryModelRecords<FootballReference>\(spaceId, 'person_group'/);
  assert.match(manage, /search: \{ text: term \}/);
  assert.match(manage, /page: \{ limit: 20 \}/);
  assert.doesNotMatch(page, /queryModelRecords<FootballReference>\(spaceId, 'activity'/);
});

test('quick creation only follows completed zero-result search and carries the typed name', () => {
  assert.match(referencePicker, /searchedTerm === search\.trim\(\)/);
  assert.match(referencePicker, /matches\.length === 0/);
  assert.match(referencePicker, /!busy && !error/);
  assert.match(referencePicker, /onCreate\(searchedTerm\)/);
  assert.match(page, /startReference\('competition', null, null, name\)/);
  assert.match(page, /startReference\('team', k, null, name\)/);
  assert.match(page, /setRefName\(record\?\.name \?\? initialName\)/);
  assert.doesNotMatch(page, /type="button" onClick=\{\(\)=>startReference\('competition'\)\}/);
  assert.match(picker, /searched === search\.trim\(\)/);
  assert.match(picker, /onCreate\(search\.trim\(\)\)/);
});
test('match form quick-creates other players without adding a create action to the global family selector', () => {
  assert.match(page, /async function saveNewPlayer/);
  assert.match(page, /method: 'POST'/);
  assert.match(page, /displayName: newPlayerName\.trim\(\)/);
  assert.match(page, /playerPersonIds: \[\.\.\.new Set/);
  assert.match(page, /onCreate=\{name => startPlayer\(name, 'match'\)\}/);
  assert.match(page, /\{familyPeople\.map\(p => <option/);
  assert.doesNotMatch(page, /playerSearchOpen|setPlayerSearchOpen/);
  assert.doesNotMatch(page, /onClick=\{\(\) => startPlayer\(\)\}/);
  assert.match(manage, /linkedUser/);
});

test('football rows show both team icons, one-line date and match-type icon', () => {
  assert.match(page, /teamRecords\.get\(m\.representativeTeamId\)\?\.presentation\?\.icon/);
  assert.match(page, /teamRecords\.get\(m\.opponentTeamId\)\?\.presentation\?\.icon/);
  assert.match(page, /recordId=\{m\.opponentTeamId\}/);
  assert.match(page, /recordId=\{m\.representativeTeamId\}/);
  assert.match(page, /whitespace-nowrap text-xs text-stone-700/);
  assert.match(page, /aria-label="正式比赛"/);
  assert.match(page, /aria-label="友谊赛"/);
  assert.doesNotMatch(page, /<p>\{m\.matchType === 'official' \? '正式'/);
});

test('competition labels resolve only page-referenced Activity IDs, with retry and visible fallback', () => {
  assert.match(page, /new Set\(referenceMatches\.map\(m => m\.competitionActivityId\)/);
  assert.match(page, /fetchUniqueFootballReferences\(competitionBatch/);
  assert.match(page, /modelUrl\(spaceId, 'activity', id\)/);
  assert.match(page, /competitionNames\.get\(m\.competitionActivityId\)/);
  assert.match(page, /'赛事暂不可查看'/);
  assert.match(page, /attemptedRefLookup\.current\.clear\(\)/);
  assert.doesNotMatch(page, /queryModelRecords<FootballReference>\(spaceId, 'activity'/);
});

test('match record button opens a standalone routable detail, not inline selection', () => {
  assert.match(app, /path="football\/:matchId" element=\{<FootballPage \/>\}/);
  assert.match(page, /useParams<'matchId'>\(\)/);
  assert.match(page, /navigate\('\/football\/' \+ encodeURIComponent\(record\.id\)\)/);
  assert.match(page, /onClick=\{\(\) => openMatchDetail\(m\)\}/);
  assert.match(page, /apiRequest<FootballMatch>\(modelUrl\(spaceId, 'football_match', matchId\)\)/);
  assert.match(page, /title=\{isDetail \? '比赛详情'/);
  assert.match(page, /isDetail \? <>/);
  assert.match(page, /onClick=\{returnToMatchList\}/);
  assert.match(page, /!isDetail && <div className="flex flex-wrap items-center justify-between/);
  assert.match(page, /!isDetail && !selected && filterOpen/);
  assert.match(page, /!isDetail && tab === 'record'/);
  assert.match(page, /isDetail && !detailLoading && selected && selected\.id === matchId/);
  assert.match(page, /!isDetail && tab === 'stats'/);
  assert.match(page, /detailError/);
  assert.match(page, /rememberFootballList\(spaceId/);
  assert.match(page, /consumeFootballList\(spaceId/);
});

test('competition labels stay on the match row beside the score, not below team names', () => {
  const row = page.slice(page.indexOf('{matches.map(m => <div key={m.id}'), page.indexOf('!loading && !matches.length'));
  assert.match(row, /flex min-w-0 flex-\[1_1_220px\] flex-wrap items-center/);
  assert.match(row, /max-w-44 min-w-0 shrink-0 truncate rounded-lg bg-stone-100/);
  assert.match(row, /competitionNames\.get\(m\.competitionActivityId\)/);
  assert.doesNotMatch(row, /<p className="truncate text-xs text-stone-500"/);
});

test('matches load forty at a time and only append pages while cursor exists', () => {
  assert.match(page, /page: \{ limit: 40, \.\.\.\(cursor \? \{ cursor \} : \{\}\) \}/);
  assert.match(page, /setMatches\(prev => append \? \[\.\.\.prev, \.\.\.result\.items\] : result\.items\)/);
  assert.match(page, /setNextCursor\(result\.nextCursor\)/);
  assert.match(page, /\{nextCursor && <Button className="w-full" variant="secondary"/);
  assert.match(page, /加载更多比赛/);
});

test('team editor adds and removes PersonGroup members without deleting Person records', () => {
  assert.match(domain, /memberPersonIds\?: string\[\]/);
  assert.match(manage, /memberPersonIds: \[\.\.\.new Set\(record\?\.memberPersonIds \?\? \[\]\)\]/);
  assert.match(manage, /memberPersonIds: teamDraft\.memberPersonIds, version: editingTeam\.version/);
  assert.match(manage, /memberPersonIds: teamDraft\.memberPersonIds, \.\.\.presentation/);
  assert.match(manage, /<FootballPersonPicker spaceId=\{spaceId\} members=\{members\} multiple/);
  assert.match(manage, /selected=\{teamDraft\.memberPersonIds\}/);
  assert.match(manage, /onChange=\{ids => setTeamDraft\(prev => prev \? \{\.\.\.prev,memberPersonIds:\[\.\.\.new Set\(ids\)\]\}/);
  assert.match(manage, /fetchUniqueFootballReferences\(missing/);
  assert.match(manage, /memberPersonIds\?\.length \?\? 0/);
  assert.match(manage, /管理球员/);
  assert.match(manage, /移出球队不会删除球员档案或比赛记录/);
  assert.match(manage, /onClick=\{closeTeam\}/);
  const membershipSave = manage.slice(manage.indexOf('const startTeam ='), manage.indexOf('const deleteTeam ='));
  assert.doesNotMatch(membershipSave, /method: 'DELETE'/);
});

test('team manager searches and renders a result list without choosing an active team', () => {
  assert.match(manage, /const \[teamSearch, setTeamSearch\] = useState\(''\)/);
  assert.match(manage, /teamTermSufficient/);
  assert.match(manage, /window\.setTimeout/);
  assert.match(manage, /queryModelRecords<FootballReference>\(spaceId, 'person_group'/);
  assert.match(manage, /sort: \[\{ field: 'name', direction: 'asc' \}\]/);
  assert.match(manage, /page: \{ limit: 20, cursor \}/);
  assert.match(manage, /visibleTeams\.map\(team =>/);
  assert.match(manage, /加载更多球队/);
  assert.match(manage, /搜索球队名称/);
  assert.doesNotMatch(manage, /teamFocus|setTeamFocus|<FootballReferencePicker/);
});

test('three match filters open a floating panel below the clicked input', () => {
  assert.equal((page.match(/className="min-w-32 flex-1" overlay spaceId=\{spaceId\}/g) ?? []).length, 3);
  assert.match(referencePicker, /overlay\?: boolean/);
  assert.match(referencePicker, /absolute right-0 top-full z-50/);
  assert.match(referencePicker, /overlay && open \? 'relative z-40 '/);
  assert.match(referencePicker, /max-h-\[min\(28rem,65vh\)\] overflow-y-auto/);
  assert.match(referencePicker, /'relative z-30 mt-2 shadow-sm'/);
  assert.match(referencePicker, /document\.addEventListener\('pointerdown', outside\)/);
  assert.match(referencePicker, /event\.key === 'Escape'/);
});
