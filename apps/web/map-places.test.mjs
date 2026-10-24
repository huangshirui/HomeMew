import test from 'node:test';
import assert from 'node:assert/strict';
import {wgs84ToGcj02,gcj02ToWgs84,parseAmapSuggestions,searchPlaces,handleMiniPlaceSearch,enforcePlaceRateLimits} from './map-places.mjs';
const fakeLimits = () => ({ 
 PLACE_SEARCH_USER_LIMIT: { limit: async () => ({success:true}) },
 PLACE_SEARCH_BURST_LIMIT: { limit: async () => ({success:true}) },
});
test('GCJ-02/WGS84 round trip and coordinates outside China',()=>{
 const p={latitude:39.991,longitude:116.391};
 const g=wgs84ToGcj02(p.latitude,p.longitude);
 assert.ok(Math.abs(g.longitude-p.longitude)>0.001);
 const w=gcj02ToWgs84(g.latitude,g.longitude);
 assert.ok(Math.abs(w.latitude-p.latitude)<1e-6);
 assert.ok(Math.abs(w.longitude-p.longitude)<1e-6);
 assert.deepEqual(wgs84ToGcj02(34.05,-118.24),{latitude:34.05,longitude:-118.24});
});
test('AMap response converted and name only kept without coordinates',()=>{
 const items=parseAmapSuggestions({status:'1',tips:[{name:'公园',district:'北京',address:'路口',location:'116.397,39.908'}, {name:'房间',address:[],location:[]}]});
 assert.equal(items.length,2);assert.equal(items[0].address,'北京 路口');
 assert.ok(Math.abs(items[0].coordinates.longitude-116.397)>0.001);
 assert.deepEqual(items[1],{name:'房间'});
});
test('search has no implicit geocoding and no exposed key',async()=>{
 const request=new Request('https://homemew.test/api/places/search?q=%E5%85%AC%E5%9B%AD');
 const r=await searchPlaces(request,{LIFESPACE_EVENT_LOCATION_FORMAT:'string'});
 assert.deepEqual((await r.json()).data,{items:[],available:false,structured:false});
 const response=await searchPlaces(request,{LIFESPACE_EVENT_LOCATION_FORMAT:'location',AMAP_WEB_SERVICE_KEY:'private',...fakeLimits()},{
  actorKey:'access-assertion',fetcher:async url=>{assert.ok(url.includes('key=private'));return new Response(JSON.stringify({status:'1',tips:[{name:'公园',location:'116.397,39.908'}]}));}
 });
 const body=await response.json();assert.equal(body.data.items.length,1);assert.equal(body.data.structured,true);
 assert.ok(!JSON.stringify(body).includes('private'));
});
test('mini map search checks bearer against Identity first',async()=>{
 const request=new Request('https://homemew.test/api/v1/miniprogram/places/search?q=%E5%85%AC%E5%9B%AD');
 const res=await handleMiniPlaceSearch(request,{AMAP_WEB_SERVICE_KEY:'private'});
 assert.equal(res.status,401);
});

test('rate limits prevent provider requests and do not cache POI data',async()=>{
 const url='https://homemew.test/api/places/search?q=%E5%85%AC%E5%9B%AD';
 let called=0;
 const fetcher=async()=>{called++;return Response.json({status:'1',tips:[]});};
 const env={AMAP_WEB_SERVICE_KEY:'private',LIFESPACE_EVENT_LOCATION_FORMAT:'location',
   PLACE_SEARCH_USER_LIMIT:{limit:async()=>({success:false})},
   PLACE_SEARCH_BURST_LIMIT:{limit:async()=>({success:true})}};
 const denied=await searchPlaces(new Request(url),env,{actorKey:'verified-user',fetcher});
 assert.equal(denied.status,429);
 assert.equal(called,0);
 assert.equal((await denied.json()).error.code,'PLACE_SEARCH_RATE_LIMITED');
 const burst={...env,PLACE_SEARCH_USER_LIMIT:{limit:async()=>({success:true})},
   PLACE_SEARCH_BURST_LIMIT:{limit:async()=>({success:false})}};
 assert.equal((await searchPlaces(new Request(url),burst,{actorKey:'verified-user',fetcher})).status,429);
 assert.equal(called,0);
 const invalid=new Request('https://homemew.test/api/places/search?q=x');
 const small=await searchPlaces(invalid,env,{fetcher});
 assert.equal(small.status,200);
 assert.equal(called,0);
});
test('rate binding must be configured before paid provider traffic and keys are pseudonymous',async()=>{
 const url='https://homemew.test/api/places/search?q=%E8%B6%B3%E7%90%83';
 let invoked=0;const seen=[];
 const env={AMAP_WEB_SERVICE_KEY:'private',LIFESPACE_EVENT_LOCATION_FORMAT:'location',
   PLACE_SEARCH_USER_LIMIT:{limit:async input=>{seen.push(input.key);return {success:true};}},
   PLACE_SEARCH_BURST_LIMIT:{limit:async input=>{seen.push(input.key);return {success:true};}}};
 const noBind=await searchPlaces(new Request(url),{AMAP_WEB_SERVICE_KEY:'private'},
  {actorKey:'secret-bearer',fetcher:async()=>{invoked++;throw Error('unexpected');}});
 assert.equal(noBind.status,503);
 assert.equal(invoked,0);
 const response=await searchPlaces(new Request(url),env,{
   actorKey:'secret-bearer',
   fetcher:async()=>{invoked++;return Response.json({status:'1',tips:[]});},
 });
 assert.equal(response.status,200);
 assert.equal(invoked,1);
 assert.equal(seen.length,2);
 assert.notEqual(seen[0],'secret-bearer');
 assert.equal(seen[1],'amap-inputtips');
 assert.equal((await enforcePlaceRateLimits(env,'' )).status,401);
});
