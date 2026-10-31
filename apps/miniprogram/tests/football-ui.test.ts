import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { AutoRefreshGate, getRefreshRevision, markRefreshDirty } from '../miniprogram/services/refresh-policy.ts';
const read=(path:string)=>readFileSync(new URL('../miniprogram/'+path,import.meta.url),'utf8');
function executable(path:string){return stripTypeScriptTypes(read(path).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,'')).replace(/\bexport /g,'');}
function page(name:string,globals:Record<string,unknown>={}){
  let result:any;runInNewContext(executable('pages/football/'+name+'.ts'),{Error,AutoRefreshGate,getRefreshRevision,markRefreshDirty,userStore:{value:{id:'u'}},...globals,Page:(p:any)=>{result=p;}});
  result.setData=(patch:any)=>Object.assign(result.data,patch);return result;
}
const people=[{personId:'per_a',displayName:'甲'},{personId:'per_kk',displayName:'KK'}];
const quickTypes=[{key:'goal',name:'进球',icon:'⚽'},{key:'assist',name:'助攻',icon:'👟'}];
function scopeTools(wx:unknown){return runInNewContext(executable('utils/football-scope.ts')+';({parseFootballScope,preferredFootballPerson,rememberFootballPerson})',{wx});}

test('player preference is revalidated against family people and scoped by user and family',()=>{
  const storage=new Map();const utils=scopeTools({getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:unknown)=>storage.set(key,value)});
  assert.equal(utils.preferredFootballPerson(people,'','u','s'),'per_kk');
  utils.rememberFootballPerson('u','s','per_a');
  assert.equal(utils.preferredFootballPerson(people,'','u','s'),'per_a');
  assert.equal(utils.preferredFootballPerson(people,'','other','s'),'per_kk');
  assert.equal(utils.preferredFootballPerson(people,'','u','other'),'per_kk');
  assert.equal(utils.preferredFootballPerson(people.slice(1),'','u','s'),'per_kk');
  assert.equal(utils.preferredFootballPerson([],'per_stale','u','s'),'');
});

test('statistics scope accepts only bounded product filters and tolerates malformed deep links',()=>{
  const utils=scopeTools({});
  assert.deepEqual(JSON.parse(JSON.stringify(utils.parseFootballScope('{"year":"2025","playerPersonId":"per_a","url":"https://invalid","q":"test"}'))),{year:'2025',q:'test',playerPersonId:'per_a'});
  for(const raw of ['bad','[]','null','{"q":123}'])assert.equal(Object.keys(utils.parseFootballScope(raw)).length,0);
});

function component(name:string,globals:Record<string,unknown>={},props:Record<string,unknown>={}){
  let config:any;runInNewContext(executable('components/'+name+'/index.ts'),{Error,setTimeout,clearTimeout,...globals,Component:(c:any)=>{config=c;}});
  const instance:any={data:config.data,properties:Object.fromEntries(Object.entries(config.properties||{}).map(([key,prop]:[string,any])=>[key,prop.value]))};
  Object.assign(instance.properties,props);Object.assign(instance,config.methods);instance.setData=(patch:any)=>Object.assign(instance.data,patch);instance.triggerEvent=()=>{};return instance;
}

test('Record and Statistics switch in place and keep exactly the same active scope',()=>{
  let navigated=false;const p=page('list',{wx:{navigateTo:()=>{navigated=true;}}});
  p.setData({familyId:'spc_one',year:'2024',matchType:'friendly',appliedSearch:'决赛',personId:'per_kk',representativeTeamId:'rec_a',opponentTeamId:'rec_b',competitionActivityId:'rec_c'});
  p.onStats();assert.equal(navigated,false);assert.equal(p.data.mode,'stats');
  assert.deepEqual(JSON.parse(JSON.stringify(p.data.activeScope)),{year:'2024',matchType:'friendly',q:'决赛',playerPersonId:'per_kk',representativeTeamId:'rec_a',opponentTeamId:'rec_b',competitionActivityId:'rec_c'});
  p.load=async()=>{};p.onMode({detail:{mode:'record'}});assert.equal(p.data.personId,'per_kk');assert.equal(p.data.year,'2024');p.onReset();assert.equal(p.data.personId,'per_kk');assert.equal(p.data.competitionActivityId,'');
});

test('statistics component forwards the current product scope and never changes the selected player',async()=>{
  const calls:any[]=[];const c=component('football-dashboard',{
    listMatches:async(_f:string,scope:any)=>{calls.push(scope);return{items:[],nextCursor:null};},
    listPerformances:async()=>({items:[],nextCursor:null}),
  },{familyId:'s',scope:{year:'2025',competitionActivityId:'rec_comp',representativeTeamId:'rec_team',q:'备注',playerPersonId:'per_kk'}});
  c.renderStats=()=>{};await c.load();assert.equal(calls[0].year,'2025');assert.equal(calls[0].competitionActivityId,'rec_comp');assert.equal(calls[0].q,'备注');assert.equal(calls[0].playerPersonId,'per_kk');
});

test('quick action opens full form without writing; failed save stays visible in the form',async()=>{
  let writes=0;const p=page('detail',{quickTypes,goalMethods:[],shotOutcomes:[],entryModes:[],
    availableTypes:()=>['goal','shot'],validatePerformance:()=>({performanceType:'goal'}),
    savePerformance:async()=>{writes++;throw Error('版本冲突，请刷新');},wx:{showToast:()=>{}}});
  p.setData({schema:{fields:[]},selectedPersonId:'per_a',people:[{id:'per_a',displayName:'甲'}],allTypes:[{key:'goal',name:'进球'},{key:'shot',name:'射门'}]});
  p.openPerformance('goal');assert.equal(writes,0);assert.equal(p.data.formOpen,true);
  await p.onFormSave();assert.equal(writes,1);assert.equal(p.data.formOpen,true);assert.match(p.data.formError,/版本冲突/);
  p.setData({busy:true});p.onFormClose();assert.equal(p.data.formOpen,true);
  p.setData({busy:false});p.onFormType({detail:{value:'1'}});assert.equal(p.data.goalMethod,'');assert.equal(p.data.performanceType,'shot');
});

test('performance counts wait for complete selected-player pagination and reject partial totals',async()=>{
  const calls:any[]=[];const p=page('detail',{quickTypes,goalMethods:[],shotOutcomes:[],entryModes:[],typeLabels:{goal:'进球'},
    listPerformances:async(...args:any[])=>{calls.push(args);return{items:[{id:'r'+calls.length,matchId:'m',playerPersonId:'p',performanceType:'goal'}],nextCursor:calls.length===1?'next':null};}});
  p.setData({familyId:'s',matchId:'m',selectedPersonId:'p',people:[{id:'p',displayName:'甲'}]});
  await p.loadPerformances(true);assert.equal(calls.length,2);assert.equal(calls[1][2],'next');assert.equal(calls[1][3],'p');assert.equal(p.data.quickTypes[0].count,2);assert.equal(p.data.eventsError,'');
  const overflow=page('detail',{quickTypes,goalMethods:[],shotOutcomes:[],entryModes:[],listPerformances:async()=>({items:[],nextCursor:'more'})});
  overflow.setData({familyId:'s',matchId:'m',selectedPersonId:'p'});await overflow.loadPerformances(true);assert.match(overflow.data.eventsError,/800/);
});

test('manager excludes family and linked users and refuses deleting a referenced player',async()=>{
  let deleted=false;const p=page('manage',{
    listDomainPeople:async()=>[{personId:'family'}],listFootballPeople:async()=>({items:[{id:'family'},{id:'linked',linkedUser:true},{id:'other',displayName:'其他',version:3}],nextCursor:null}),
    wx:{showModal:async(o:any)=>{await o.success({confirm:true});}},
    listMatches:async()=>({items:[{id:'m'}]}),listPerformances:async()=>({items:[]}),removeFootballPerson:async()=>{deleted=true;},
  });
  p.setData({familyId:'s',tab:'players'});await p.load(true);assert.equal(p.data.players.length,1);assert.equal(p.data.players[0].id,'other');
  p.onDeletePlayer({currentTarget:{dataset:{id:'other'}}});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(deleted,false);assert.match(p.data.error,/引用/);
});

test('Mini statistics match Web natural-month and incomplete-time semantics',()=>{
  const utils=runInNewContext(executable('utils/football-stats.ts')+';({aggregateFootball,metricPair})');
  const matches=[{id:'a',matchDate:'2025-01-01',playerPersonIds:['p'],representativeTeamScore:2,opponentTeamScore:1},{id:'b',matchDate:'2025-03-01',playerPersonIds:['p'],representativeTeamScore:-1,opponentTeamScore:0}];
  const events=[{matchId:'a',playerPersonId:'p',performanceType:'appearance',minutesPlayed:10},{matchId:'a',playerPersonId:'p',performanceType:'goal'},{matchId:'b',playerPersonId:'p',performanceType:'appearance',minutesPlayed:8},{matchId:'b',playerPersonId:'p',performanceType:'appearance',minutesPlayed:null}];
  const stats=utils.aggregateFootball([...matches,matches[0]],events,'p');assert.equal(stats.matches,2);assert.equal(stats.scoredMatches,1);assert.equal(stats.winRate,1);assert.equal(stats.knownMinutes,10);assert.equal(stats.months.length,3);assert.equal(stats.months[1].matches,0);assert.equal(utils.metricPair(stats.months[1],'attack')[0],null);
});

test('football controls follow the capsule-aware nav and never occupy its right slot',()=>{
  for(const name of ['list','manage','stats','detail','edit']){
    const wxml=read('pages/football/'+name+'.wxml');assert.match(wxml,/<nav-bar/);assert.doesNotMatch(wxml,/slot="right"/);
  }
  const nav=read('components/nav-bar/index.wxml');assert.match(nav,/padding-right: {{capsuleRight}}px/);
  for(const [width,left,top,status,height] of [[375,278,50,44,32],[320,223,30,24,32],[430,333,65,59,32]]){
    const metrics=runInNewContext(executable('utils/nav-metrics.ts')+';getNavMetrics()',{wx:{getSystemInfoSync:()=>({screenWidth:width,statusBarHeight:status}),getMenuButtonBoundingClientRect:()=>({left,top,height})}});
    assert.equal(metrics.capsuleRight,width-left);assert.equal(metrics.navBarHeight,(top-status)*2+height);
  }
});

test('editing hydrates selected teams, competition and roster beyond the first page without default replacement',async()=>{
  const p=page('edit',{
    ensureRuntimeReady:async()=>{},getMatch:async()=>({id:'match',version:4,matchDate:'2025-03-01',representativeTeamId:'old_a',opponentTeamId:'old_b',competitionActivityId:'old_comp',playerPersonIds:['old_player']}),
    listFootballPeople:async()=>({items:[],nextCursor:null}),listTeams:async()=>({items:[{id:'first',name:'首屏球队'}],nextCursor:'next'}),listDomainPeople:async()=>[],
    getFootballPerson:async(id:string,personId:string)=>({id:personId,version:2,displayName:'历史球员'}),
    getTeam:async(_f:string,id:string)=>({id,name:'历史球队 '+id}),getDomainRecord:async()=>({id:'old_comp',name:'历史赛事'}),originalIconState:()=>({}),
  });
  await p.onLoad({familyId:'s',id:'match'});assert.equal(p.data.error,'');assert.equal(p.data.representativeTeamId,'old_a');assert.equal(p.data.opponentTeamId,'old_b');assert.equal(p.data.competitionActivityId,'old_comp');assert.equal(p.data.people[0].selected,true);
});

test('failed and obsolete reference searches never offer quick creation',async()=>{
  const p=component('football-reference-field',{listDomainRecords:async()=>{throw Error('离线');}},{familyId:'s',allowCreate:true,kind:'team'});p.setData({search:'球队'});
  await p.searchRecords(true);assert.equal(p.data.canCreate,false);assert.match(p.data.error,/离线/);
  let release:any;const stale=component('football-reference-field',{listDomainRecords:()=>new Promise(resolve=>{release=resolve;})},{familyId:'s',allowCreate:true,kind:'team'});stale.setData({search:'旧词'});const load=stale.searchRecords(true);stale.onInput({detail:{value:'新'}});release({items:[],nextCursor:null});await load;assert.equal(stale.data.canCreate,false);
});

test('reference recents are verified before selection and zero-result creation is explicit',async()=>{
  let writes=0,verified=false,remembered=false,selected=false;
  const c=component('football-reference-field',{listDomainRecords:async()=>({items:[],nextCursor:null}),getDomainRecord:async()=>{verified=true;return{id:'rec_a',name:'甲队'};},rememberFootballRecent:()=>{assert.equal(verified,true);remembered=true;},saveTeam:async()=>{writes++;return{id:'rec_new'};},wx:{showModal:()=>{}}},{familyId:'s',userId:'u',kind:'team',allowCreate:true});
  c.triggerEvent=()=>{selected=true;};c.setData({search:'新球队'});await c.searchRecords(true);assert.equal(c.data.canCreate,true);assert.equal(writes,0);
  await c.onPick({currentTarget:{dataset:{id:'rec_a'}}});assert.equal(remembered,true);assert.equal(selected,true);
});

test('trend chart keeps missing-month line gaps separate from match count bars',()=>{
  const {metricPair}=runInNewContext(executable('utils/football-stats.ts')+';({metricPair})');
  const {footballChart}=runInNewContext(executable('utils/football-chart.ts')+';({footballChart})',{metricPair});
  const months=[{month:'2025-01',matches:1,goals:1,assists:0},{month:'2025-02',matches:0,goals:0,assists:0},{month:'2025-03',matches:2,goals:2,assists:1}];
  const chart=footballChart(months,'attack');const svg=decodeURIComponent(chart.background);assert.match(svg,/每月参赛场次/);assert.match(svg,/2025-02/);assert.match(svg,/M[\d.]+,[\d.]+M/);assert.doesNotMatch(svg,/NaN|Infinity/);
});


test('closing a pending reference selection prevents late selection and cache writes',async()=>{
  let release:any,writes=0;
  const c=component('football-reference-field',{getDomainRecord:()=>new Promise(resolve=>{release=resolve;}),rememberFootballRecent:()=>{writes++;}},{familyId:'s',kind:'team'});
  c.setData({open:true});const picking=c.onPick({currentTarget:{dataset:{id:'rec_a'}}});c.onClose();release({id:'rec_a',name:'甲队'});await picking;assert.equal(c.data.open,false);assert.equal(writes,0);
});

test('legacy stats links return to the shared workspace with the same decoded scope',()=>{
  let url='';const {parseFootballScope}=scopeTools({});const p=page('stats',{parseFootballScope,wx:{redirectTo:(o:any)=>{url=o.url;}}});
  const scope={year:'2025',playerPersonId:'per_kk'};p.onLoad({familyId:'s',scope:encodeURIComponent(JSON.stringify(scope))});
  const q=new URL('https://mini'+url).searchParams;assert.equal(q.get('mode'),'stats');assert.deepEqual(JSON.parse(q.get('scope')!),scope);
});


test('refresh preserves unapplied search text and match actions have distinct destinations',()=>{
  let url='';const p=page('list',{wx:{navigateTo:(o:any)=>{url=o.url;}}});p.setData({familyId:'s',search:'尚未搜索',appliedSearch:'已应用'});p.load=async()=>{};p.onRefresh();assert.equal(p.data.appliedSearch,'已应用');
  const event={currentTarget:{dataset:{id:'rec_one'}}};p.onRecord(event);assert.match(url,/football\/detail/);p.onEditMatch(event);assert.match(url,/football\/edit\?kind=match/);
});

test('match revalidation only reloads volatile match and performance data during metadata TTL', async () => {
  let version = 3, matches = 0, teams = 0, people = 0, schema = 0, performances = 0;
  const p = page('detail', {
    quickTypes, goalMethods: [], shotOutcomes: [], entryModes: [],
    typeLabels: {goal:'进球'}, availableTypes: (schema:any) =>
      schema.fields.find((field:any)=>field.key==='performanceType')?.values||[],
    getMatch: async () => { matches++; return {
      id:'m',version,representativeTeamId:'a',opponentTeamId:'b',
      playerPersonIds:['p'],representativeTeamScore:2,opponentTeamScore:1,
    }; },
    getTeam: async (_family:string,id:string) => { teams++; return { id, name:id }; },
    getFootballPerson: async (_family:string,id:string) => { people++; return { id, displayName:'KK' }; },
    readPerformanceSchema: async () => { schema++; return { fields:[{key:'performanceType',values:['goal']}] }; },
    listPerformances: async () => { performances++; return { items:[],nextCursor:null }; },
  });
  p.setData({familyId:'spc_a',matchId:'m'});
  await p.refresh();
  assert.deepEqual([matches,teams,people,schema,performances],[1,2,1,1,1]);
  await p.refresh();
  assert.deepEqual([matches,teams,people,schema,performances],[2,2,1,1,2],
    'same match version should retain team and roster data while updating performances');
  version++;
  await p.refresh();
  assert.deepEqual([matches,teams,people,schema,performances],[3,4,2,1,3],
    'a match version change invalidates displayed metadata immediately');
  markRefreshDirty('football');
  await p.refresh();
  assert.deepEqual([matches,teams,people,schema,performances],[4,6,3,1,4],
    'local football edits bypass metadata TTL without re-reading the schema');
});
