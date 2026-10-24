import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shiftEndWithStart } from '../miniprogram/utils/event-time-shift.ts';

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
