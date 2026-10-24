import test from 'node:test';
import assert from 'node:assert/strict';
import {wgs84ToGcj02,gcj02ToWgs84,parseAmapSuggestions,searchPlaces,handleMiniPlaceSearch} from './map-places.mjs';
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
 const response=await searchPlaces(request,{LIFESPACE_EVENT_LOCATION_FORMAT:'location',AMAP_WEB_SERVICE_KEY:'private'},{
  fetcher:async url=>{assert.ok(url.includes('key=private'));return new Response(JSON.stringify({status:'1',tips:[{name:'公园',location:'116.397,39.908'}]}));}
 });
 const body=await response.json();assert.equal(body.data.items.length,1);assert.equal(body.data.structured,true);
 assert.ok(!JSON.stringify(body).includes('private'));
});
test('mini map search checks bearer against Identity first',async()=>{
 const request=new Request('https://homemew.test/api/v1/miniprogram/places/search?q=%E5%85%AC%E5%9B%AD');
 const res=await handleMiniPlaceSearch(request,{AMAP_WEB_SERVICE_KEY:'private'});
 assert.equal(res.status,401);
});
