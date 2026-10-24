import test from 'node:test';
import assert from 'node:assert/strict';
import {validRecentLocation,upsertRecentPlace,pruneRecentPlaces} from './recent-place-value.mjs';
test('direct canonical Location snapshots, dedup and expiry without event keys',()=>{
 const v={name:'文来中学',address:'上海',coordinates:{latitude:31.1,longitude:121.2}};
 const t=Date.parse('2026-10-24T00:00:00Z');
 const a=upsertRecentPlace([],v,t), b=upsertRecentPlace(a,v,t+1000);
 assert.deepEqual(b[0].location,v);assert.equal(b.length,1);assert.equal(b[0].useCount,2);
 assert.equal('familyId' in b[0],false);assert.equal('sourceEventId' in b[0],false);
 assert.equal(pruneRecentPlaces(b,t+91*86400000).length,0);
});
test('strict Location, excludes unknown fields and invalid coordinates',()=>{
 for(const v of [{},{name:''},{name:'a',x:1},{name:'a',coordinates:{latitude:90.1,longitude:1}},
   {name:'a',coordinates:{latitude:1,longitude:Infinity}}]){
  assert.equal(validRecentLocation(v),false);assert.throws(()=>upsertRecentPlace([],v));
 }
});
test('30-entry bound and latest-first ordering',()=>{
 const t=Date.parse('2026-10-24T00:00:00Z');let a=[];
 for(let i=0;i<40;i++)a=upsertRecentPlace(a,{name:'place-'+i},t+i*1000);
 assert.equal(a.length,30);assert.equal(a[0].location.name,'place-39');
});
