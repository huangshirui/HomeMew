import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const xml=readFileSync(new URL('../miniprogram/pages/events/edit.wxml',import.meta.url),'utf8');
const code=readFileSync(new URL('../miniprogram/pages/events/edit.ts',import.meta.url),'utf8');
test('Mini place search displays friendly search and recent place labels',()=>{
 for(const text of ['搜索或输入地点','最近使用','搜索其他地点']){
  assert.ok(xml.includes(text),text);
 }
 assert.ok(code.includes("locationHint: '已选定地点'"));
 for(const text of ['没有找到合适的地点，可以直接填写',
  '暂时无法搜索地点，可以直接填写','没有找到其他地点，可以直接填写']){
  assert.ok(code.includes(text),text);
 }
 for(const technical of ['WGS84','无需地图搜索','当前仅保存地点名称','已选择地图地点']){
  assert.ok(!xml.includes(technical)&&!code.includes(technical),technical);
 }
});
