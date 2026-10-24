import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./src/pages/calendar-page.tsx',import.meta.url),'utf8');
test('Web place search uses everyday copy without exposing implementation details',()=>{
 for(const text of ['搜索或输入地点','最近使用','搜索其他地点…',
  '已选定地点','没有找到合适的地点，可以直接填写',
  '暂时无法搜索地点，可以直接填写','地图会根据名称查找地点']){
   assert.ok(src.includes(text),text);
 }
 for(const technical of ['WGS84 坐标','无需地图搜索','当前仅保存地点名称','精确地点']){
   assert.ok(!src.includes(technical),technical);
 }
});
