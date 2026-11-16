import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { candidateDisplayName, relationDisplayName, relatedRecordMetadata, activityTimeline } from '../miniprogram/utils/relation-display.ts';

test('relation label uses the authoritative LifeSpace referenceLabel', () => {
  assert.equal(relationDisplayName('rec_one', '正式显示名称', { name: '旧名称' }), '正式显示名称');
  assert.equal(relationDisplayName('rec_one', 'rec_one', { summary: '足球训练' }), '足球训练');
  assert.equal(relationDisplayName('rec_one', undefined, { title: '我的愿望' }), '我的愿望');
  assert.equal(relationDisplayName('rec_one', '', undefined), '名称暂不可用');
  assert.equal(relationDisplayName('rec_one', 'rec_other', undefined), '名称暂不可用');
});

test('linked candidates display the actual model-owned field, not a guessed name', () => {
  assert.equal(candidateDisplayName('task', { id: 'rec_a', name: '提交作业' }), '提交作业');
  assert.equal(candidateDisplayName('event', { id: 'rec_b', summary: '足球训练' }), '足球训练');
  assert.equal(candidateDisplayName('wish', { id: 'rec_c', title: '去露营' }), '去露营');
  assert.equal(candidateDisplayName('day_record', { id: 'rec_d', name: '生日倒计时' }), '生日倒计时');
  assert.equal(candidateDisplayName('goal', { id: 'rec_e', name: '学会游泳' }), '学会游泳');
  assert.equal(candidateDisplayName('event', { id: 'rec_b', name: '错误的字段' }), '名称暂不可用');
});

test('Mini relation view and candidate search both consume the shared display helper', () => {
  const services = readFileSync(new URL('../miniprogram/services/domains.ts', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../miniprogram/pages/domains/detail.ts', import.meta.url), 'utf8');
  assert.match(services, /relationDisplayName\(refId, label, obj\)/);
  assert.match(detail, /readableCandidateTitle\(d\.linkType,x\)/);
  assert.match(detail, /readableRelationTitle\(edge,direction\)/);
});


test('Activity relation metadata shows authorized dates, statuses, participants and countdowns', () => {
  const today='2026-11-16',timezone='Asia/Shanghai';
  const people=[{personId:'per_1',displayName:'家人'}];
  const format=(instant:string,zone:string)=>{
    assert.equal(zone,timezone);assert.equal(instant,'2026-11-15T18:30:00Z');
    return {date:today,time:'02:30'};
  };
  const event=relatedRecordMetadata('event',{when:{kind:'instant',start:'2026-11-15T18:30:00Z',endExclusive:'2026-11-15T19:30:00Z'},attendeePersonIds:['per_1','per_unknown']},timezone,today,people,format);
  assert.equal(event.dateLabel,'2026-11-16 02:30');assert.equal(event.peopleLabel,'家人');
  assert.equal(relatedRecordMetadata('event',{when:{kind:'date',start:'2026-11-16',endExclusive:'2026-11-17'}},timezone,today,people,format).dateLabel,'全天 2026-11-16');
  const task=relatedRecordMetadata('task',{dueDate:'2026-11-20',status:'completed',assigneePersonIds:['per_1']},timezone,today,people,format);
  assert.equal(task.dateLabel,'截止 2026-11-20');assert.equal(task.status,'已完成');assert.equal(task.peopleLabel,'家人');
  const day=relatedRecordMetadata('day_record',{kind:'countdown',anchorDate:'2026-11-18'},timezone,today,people,format);
  assert.equal(day.countdown,'2 天后');
  assert.equal(relatedRecordMetadata('anniversary',{month:2,day:29},timezone,today,people,format).date,'2028-02-29');
  assert.equal(relatedRecordMetadata('task',{dueDate:'2026-02-30'},timezone,today,people,format).date,'');
  assert.deepEqual(relatedRecordMetadata('task',undefined,timezone,today,people,format),{date:'',sortKey:'',dateLabel:'',status:'',peopleLabel:'',countdown:''});
});
test('Activity overview timeline orders loaded records and keeps undated records last in either direction',()=>{
  const rows=[{id:'future',date:'2026-11-17',sortKey:'2026-11-17T00:00'},{id:'undated',date:'',sortKey:''},
    {id:'past',date:'2026-11-15',sortKey:'2026-11-15T00:00'},{id:'today',date:'2026-11-16',sortKey:'2026-11-16T02:30'}];
  const asc=activityTimeline(rows,'2026-11-16','asc'),desc=activityTimeline(rows,'2026-11-16','desc');
  assert.deepEqual(asc.items.map(x=>x.id),['past','today','future','undated']);assert.equal(asc.markerAt,1);
  assert.deepEqual(desc.items.map(x=>x.id),['future','today','past','undated']);assert.equal(desc.markerAt,1);
  assert.equal(rows[0].id,'future');assert.equal(activityTimeline([rows[2]],'2026-11-16','asc').markerAt,1);
});
test('Activity detail keeps the full description in the expanded scroll view and limits collapsed content to three lines',()=>{
  const detail=readFileSync(new URL('../miniprogram/pages/domains/detail.wxml',import.meta.url),'utf8');
  const css=readFileSync(new URL('../miniprogram/pages/domains/detail.wxss',import.meta.url),'utf8');
  const page=readFileSync(new URL('../miniprogram/pages/domains/detail.ts',import.meta.url),'utf8');
  assert.match(detail,/wx:if="\{\{!descriptionExpanded\}\}" id="activity-description-clip"/);
  assert.match(detail,/<scroll-view wx:else scroll-y class="description-expanded"[^>]*>\s*<view class="description-text">\{\{record\.description\}\}/);
  assert.match(detail,/wx:if="\{\{descriptionCanExpand\}\}"[^>]*bindtap="onToggleDescription"/);
  assert.match(css,/\.description-text\{[^}]*line-height:44rpx/);assert.match(css,/\.description-clip\{max-height:132rpx;overflow:hidden\}/);
  assert.match(page,/descriptionCanExpand:full\.height>clip\.height\+1/);
  assert.match(detail,/wx:for="\{\{activityRows\}\}"/);
  for(const key of ['dateLabel','status','peopleLabel','countdown'])assert.ok(detail.includes('{{item.'+key));
  assert.match(detail,/今天 · \{\{today\}\}/);assert.match(detail,/bindtap="onOverviewOrder"/);
});


test('Activity description measurement toggles only on real overflow and ignores stale callbacks',()=>{
  const source=readFileSync(new URL('../miniprogram/pages/domains/detail.ts',import.meta.url),'utf8');
  const executable=stripTypeScriptTypes(source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,''));
  let page:any;let height=132;let full=80;let deferred:((value:any[])=>void)|null=null;
  const query={select:()=>query,boundingClientRect:()=>query,exec:(callback:(value:any[])=>void)=>{deferred=callback;}};
  runInNewContext(executable,{Page:(p:any)=>{page=p;},AutoRefreshGate:class{},wx:{createSelectorQuery:()=>query}});
  page.setData=(patch:any,callback?:()=>void)=>{Object.assign(page.data,patch);callback?.();};
  page.data.record={description:'文字说明'};
  const measure=()=>{page.measureDescription();assert.ok(deferred);const callback=deferred!;deferred=null;callback([{height},{height:full}]);};
  measure();assert.equal(page.data.descriptionCanExpand,false);
  page.onToggleDescription();assert.equal(page.data.descriptionExpanded,false);
  full=1000;measure();assert.equal(page.data.descriptionCanExpand,true);
  assert.equal(page.data.descriptionScrollHeight,429);
  page.onToggleDescription();assert.equal(page.data.descriptionExpanded,true);
  page.onToggleDescription();assert.equal(page.data.descriptionExpanded,false);
  page._generation++;const callback=deferred!;deferred=null;callback([{height},{height:80}]);
  assert.equal(page.data.descriptionCanExpand,true);
});
