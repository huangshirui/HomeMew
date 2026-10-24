import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftEndWithStart } from './src/lib/event-time-shift.ts';
import { readFileSync } from 'node:fs';

const zone={
  toStartInstant:(date,time)=>new Date(date+'T'+time+':00.000Z').toISOString(),
  toEndInstant:(date,time)=>new Date(date+'T'+time+':00.000Z').toISOString(),
  fromEndInstant:instant=>({date:instant.slice(0,10),time:instant.slice(11,16)}),
};
const base={isAllDay:false,startDate:'2026-10-24',startTime:'09:00',endDate:'2026-10-24',endTime:'10:30'};
test('moving start later or earlier preserves original duration',()=>{
 assert.deepEqual(shiftEndWithStart(base,{time:'11:15'},zone),{
  startDate:'2026-10-24',startTime:'11:15',endDate:'2026-10-24',endTime:'12:45'
 });
 assert.deepEqual(shiftEndWithStart(base,{time:'08:00'},zone),{
  startDate:'2026-10-24',startTime:'08:00',endDate:'2026-10-24',endTime:'09:30'
 });
});
test('moving start across midnight shifts end date too',()=>{
 const event={...base,startTime:'23:00',endDate:'2026-10-25',endTime:'00:30'};
 assert.deepEqual(shiftEndWithStart(event,{time:'22:00'},zone),{
  startDate:'2026-10-24',startTime:'22:00',endDate:'2026-10-24',endTime:'23:30'
 });
 assert.deepEqual(shiftEndWithStart(event,{time:'23:45'},zone),{
  startDate:'2026-10-24',startTime:'23:45',endDate:'2026-10-25',endTime:'01:15'
 });
});
test('moving date preserves timed duration or inclusive all-day span',()=>{
 assert.deepEqual(shiftEndWithStart({...base,endDate:'2026-10-25',endTime:'11:00'},{
   date:'2026-11-04'
 },zone),{startDate:'2026-11-04',startTime:'09:00',endDate:'2026-11-05',endTime:'11:00'});
 assert.deepEqual(shiftEndWithStart({...base,isAllDay:true,endDate:'2026-10-26'},{
   date:'2026-11-04'
 },zone),{startDate:'2026-11-04',startTime:'09:00',endDate:'2026-11-06',endTime:'10:30'});
});
test('invalid local time and invalid range leave existing end untouched',()=>{
 const broken={...zone,toStartInstant:()=>undefined};
 assert.deepEqual(shiftEndWithStart(base,{time:'11:00'},broken),{
  startDate:'2026-10-24',startTime:'11:00',endDate:'2026-10-24',endTime:'10:30'
 });
 const reversed={...base,endTime:'08:00'};
 assert.equal(shiftEndWithStart(reversed,{time:'11:00'},zone).endTime,'08:00');
});
test('Web editor wires the helper only to start edits, not end edits',()=>{
 const source=readFileSync(new URL('./src/pages/calendar-page.tsx',import.meta.url),'utf8');
 assert.match(source,/onChange=\{\(event\) => changeStart\(\{date:event.target.value\}\)\}/);
 assert.match(source,/onChange=\{\(event\) => changeStart\(\{time:event.target.value\}\)\}/);
 assert.match(source,/onChange=\{\(event\) => set\('endTime', event.target.value\)\}/);
});
