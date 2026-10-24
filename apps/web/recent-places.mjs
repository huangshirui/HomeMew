/** Authenticated, bounded app-usage cache proxy. Never address LifeSpace Event for this. */
import { eventLocationWireFormat } from './event-location-compat.mjs';
const endpoint='https://homemew-backend.internal/internal/v1/recent-places';
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
export async function recentPlacesRequest(request,env,token){
 if(!['GET','POST','DELETE'].includes(request.method))return json({error:{code:'METHOD_NOT_ALLOWED'}},405);
 if(typeof token!=='string'||!token.startsWith('Bearer ')&&token.length<10)return json({error:{code:'UNAUTHORIZED'}},401);
 if(!env.HOMEMEW_BACKEND || typeof env.HOMEMEW_BACKEND.fetch!=='function')
  return json({data:{items:[],enabled:false,structured:eventLocationWireFormat(env)==='location'}});
 let body;
 if(request.method==='POST'){
  body=await request.text();
  if(body.length>2500)return json({error:{code:'INVALID_LOCATION'}},413);
 }
 try{
  const res=await env.HOMEMEW_BACKEND.fetch(new Request(endpoint,{
   method:request.method,
   headers:{authorization:token.startsWith('Bearer ')?token:'Bearer '+token,
    accept:'application/json',...(body!==undefined?{'content-type':'application/json'}:{})},
   ...(body!==undefined?{body}:{})
  }));
  const payload=await res.json().catch(()=>null);
  if(!res.ok)return json({error:{code:'RECENT_PLACES_UNAVAILABLE'}},res.status===401?401:503);
  if(!payload || !Array.isArray(payload.data?.items))return json({error:{code:'RECENT_PLACES_UNAVAILABLE'}},503);
  return json({data:{items:payload.data.items,enabled:payload.data.enabled===true,
    structured:eventLocationWireFormat(env)==='location'}});
 }catch{return json({error:{code:'RECENT_PLACES_UNAVAILABLE'}},503);}
}
export async function handleMiniRecentPlaces(request,env) {
 const url=new URL(request.url);
 if(url.pathname!=='/api/v1/miniprogram/places/recent')return null;
 if(url.search)return json({error:{code:'INVALID_QUERY'}},400);
 const auth=request.headers.get('authorization')?.trim()||'';
 if(!auth.startsWith('Bearer '))return json({error:{code:'UNAUTHORIZED'}},401);
 return recentPlacesRequest(request,env,auth);
}
