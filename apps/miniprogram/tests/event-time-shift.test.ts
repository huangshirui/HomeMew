import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { shiftEndWithStart, shiftDateEndWithStart } from '../miniprogram/utils/event-time-shift.ts';

const read=(path:string)=>readFileSync(new URL('../miniprogram/'+path,import.meta.url),'utf8');
const executable=(path:string)=>stripTypeScriptTypes(read(path).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,'')).replace(/\bexport /g,'');
function editor(path:string){
 const datetime=runInNewContext(executable('utils/datetime.ts')+';({getWallTimeCandidates,formatInstantInTimeZone,addDaysToDateOnly})');
 let page:any;
 runInNewContext(executable('pages/'+path+'/edit.ts'),{
  ...datetime,timeZoneLabel:(zone:string)=>zone,shiftEndWithStart,shiftDateEndWithStart,Page:(p:any)=>{page=p;},
 });
 page.setData=(patch:any)=>Object.assign(page.data,patch);
 return page;
}

const conversions={
 toStartInstant:(date:string,time:string)=>date+'T'+time+':00.000Z',
 toEndInstant:(date:string,time:string)=>date+'T'+time+':00.000Z',
 fromEndInstant:(instant:string)=>({date:instant.slice(0,10),time:instant.slice(11,16)}),
};
test('Mini start edit shifts end by unchanged duration and rolls over midnight',()=>{
 const value={isAllDay:false,startDate:'2026-10-24',endDate:'2026-10-24',
   startTime:'21:30',endTime:'23:15'};
 assert.deepEqual(shiftEndWithStart(value,{time:'23:00'},conversions),{
  startDate:'2026-10-24',startTime:'23:00',endDate:'2026-10-25',endTime:'00:45'
 });
});
test('Mini start-date edit preserves all-day span',()=>{
 const value={isAllDay:true,startDate:'2026-10-24',endDate:'2026-10-26',
  startTime:'09:00',endTime:'10:00'};
 assert.equal(shiftEndWithStart(value,{date:'2026-10-27'},conversions).endDate,'2026-10-29');
});
test('Mini time handlers use start shift; user-edited end stays independent',()=>{
 const source=readFileSync(new URL('../miniprogram/pages/events/edit.ts',import.meta.url),'utf8');
 assert.match(source,/onStartTimeChange\([^)]*\): void \{\s*this.changeStart\(undefined,e.detail.value as string\)/);
 assert.match(source,/onEndTimeChange\([^)]*\): void \{\s*this.setData\(\{ endTime: e.detail.value as string \}\)/);
});

test('timed editor date selections retain duration, including a manually edited end',()=>{
 const p=editor('events');
 p.setData({isAllDay:false,startDate:'2026-10-25',endDate:'2026-10-25',startTime:'09:00',endTime:'10:00'});
 p.onStartDateSelect({detail:{date:'2026-10-28'}});
 assert.equal(p.data.endDate,'2026-10-28');
 assert.equal(p.data.endTime,'10:00');
 p.onEndDateSelect({detail:{date:'2026-10-30'}});
 p.onStartDateSelect({detail:{date:'2026-11-01'}});
 assert.equal(p.data.endDate,'2026-11-03');
});

test('switching midnight defaults to timed establishes a range that shifts with the start',()=>{
 const p=editor('events');
 p.setData({isAllDay:true,startDate:'2026-10-25',endDate:'2026-10-25',startTime:'23:00',endTime:'00:00'});
 p.onAllDayChange({detail:{value:false}});
 assert.equal(p.data.endDate,'2026-10-26');
 p.onStartDateSelect({detail:{date:'2026-10-31'}});
 assert.equal(p.data.endDate,'2026-11-01');
 assert.equal(p.data.endTime,'00:00');
});

test('date-only activity and goal editors move existing endpoints and keep optional dates empty',()=>{
 for(const [kind,endField] of [['activities','endDate'],['goals','targetDate']]){
  const p=editor('domains');
  const select=(name:string,value:string)=>p.onDateChange({currentTarget:{dataset:{name}},detail:{value}});
  p.setData({kind,startDate:'2026-10-25',[endField]:'2026-10-27'});
  select('startDate','2026-10-31');assert.equal(p.data[endField],'2026-11-02');
  select(endField,'2026-11-04');assert.equal(p.data.startDate,'2026-10-31');
  select('startDate','2026-11-01');assert.equal(p.data[endField],'2026-11-05');
  p.setData({[endField]:''});select('startDate','2026-11-03');assert.equal(p.data[endField],'');
  p.setData({startDate:'',[endField]:'2026-11-08'});
  select('startDate','2026-11-04');assert.equal(p.data[endField],'2026-11-08');
 }
});

test('date-only span handles leap days; invalid/incomplete input is retained for validation',()=>{
 assert.equal(shiftDateEndWithStart('2028-02-28','2028-02-29','2028-02-29'),'2028-03-01');
 assert.equal(shiftDateEndWithStart('2026-10-25','2026-10-24','2026-11-01'),'2026-10-24');
 const draft={isAllDay:false,startDate:'2026-10-25',endDate:'2026-10-25',startTime:'09:00',endTime:'10:00'};
 assert.equal(shiftEndWithStart(draft,{date:'2026-10-26'},{...conversions,toStartInstant:()=>undefined}).endDate,'2026-10-25');
});
