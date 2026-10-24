import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMiniRecentPlaces,recentPlacesRequest} from './recent-places.mjs';
test('mini route must supply bearer and delegates to internal-only Backend',async()=>{
 const url='https://homemew.test/api/v1/miniprogram/places/recent';
 const no=await handleMiniRecentPlaces(new Request(url),{});
 assert.equal(no.status,401);
 let endpoint='',auth='';
 const env={LIFESPACE_EVENT_LOCATION_FORMAT:'location',HOMEMEW_BACKEND:{fetch:async req=>{
  endpoint=req.url;auth=req.headers.get('authorization');
  return Response.json({data:{enabled:true,items:[{location:{name:'School'},useCount:1}]}});
 }}};
 const yes=await handleMiniRecentPlaces(new Request(url,{headers:{authorization:'Bearer token-for-user'}}),env);
 assert.equal(yes.status,200);assert.ok(endpoint.endsWith('/internal/v1/recent-places'));
 assert.equal(auth,'Bearer token-for-user');
 assert.deepEqual((await yes.json()).data.items[0].location,{name:'School'});
});
test('backend errors are optional for UI and no backend gives disabled mode',async()=>{
 const req=new Request('https://homemew.test/api/places/recent');
 const res=await recentPlacesRequest(req,{},'Bearer token-for-user');
 assert.deepEqual((await res.json()).data.items,[]);
});
