// Stateless HomeMew map provider adapter. LifeSpace stores only WGS84.
import { json, errorResponse, forwardLifeSpace } from './miniprogram-upstream.mjs';

const PI = Math.PI, A = 6378245, EE = 0.00669342162296594323;
const outsideChina = (lat, lon) => lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
function offset(lat, lon) {
  const x = lon - 105, y = lat - 35;
  let dl = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  dl += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
  dl += (20*Math.sin(y*PI) + 40*Math.sin(y/3*PI))*2/3;
  dl += (160*Math.sin(y/12*PI) + 320*Math.sin(y*PI/30))*2/3;
  let dn = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  dn += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
  dn += (20*Math.sin(x*PI) + 40*Math.sin(x/3*PI))*2/3;
  dn += (150*Math.sin(x/12*PI) + 300*Math.sin(x/30*PI))*2/3;
  const rad = lat/180*PI;
  const magic = 1-EE*Math.sin(rad)**2;
  const root = Math.sqrt(magic);
  return { latitude: dl*180 / ((A*(1-EE))/(magic*root)*PI),
    longitude: dn*180 / (A/root*Math.cos(rad)*PI) };
}
export function wgs84ToGcj02(latitude, longitude) {
  if (outsideChina(latitude,longitude)) return {latitude,longitude};
  const d=offset(latitude,longitude);
  return {latitude:latitude+d.latitude,longitude:longitude+d.longitude};
}
export function gcj02ToWgs84(latitude, longitude) {
  if (outsideChina(latitude,longitude)) return {latitude,longitude};
  let lat=latitude,lon=longitude;
  // Numeric inverse of the forward GCJ-02 transform, not a coordinate-system label swap.
  for(let i=0;i<6;i++){const guess=wgs84ToGcj02(lat,lon);lat+=latitude-guess.latitude;lon+=longitude-guess.longitude;}
  return {latitude:lat,longitude:lon};
}
export function parseAmapSuggestions(payload) {
  if (payload?.status !== '1' || !Array.isArray(payload.tips)) throw new Error('Invalid Amap response');
  const seen=new Set();
  return payload.tips.slice(0,30).flatMap(item=>{
    const name=typeof item?.name==='string'?item.name.trim():'';
    if(!name || name.length>500) return [];
    const address=[item.district,typeof item.address==='string'?item.address:''].filter(Boolean).join(' ').trim().slice(0,1000);
    const raw=typeof item.location==='string'?item.location.split(',').map(Number):[];
    const lng=raw[0],lat=raw[1];
    const coordinates=raw.length===2 && Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat)<=90 && Math.abs(lng)<=180 ? gcj02ToWgs84(lat,lng) : undefined;
    const key=name+'|'+address+'|'+(coordinates?item.location:'');
    if(seen.has(key))return [];
    seen.add(key);
    return [{name,...(address?{address}:{}),...(coordinates?{coordinates}: {})}];
  }).slice(0,8);
}

/**
 * Budget protection without storing AMap response data. Both bindings are
 * Cloudflare location-local approximate limits, NOT a strict monthly budget.
 * Actor identifiers are verified by the caller and immediately hashed.
 */
export async function enforcePlaceRateLimits(env, actorKey) {
  if (typeof actorKey !== 'string' || !actorKey.trim())
    return errorResponse(401, 'PLACE_SEARCH_UNAUTHENTICATED', 'Place search requires authentication');
  const required = [
    ['PLACE_SEARCH_USER_LIMIT', null],
    ['PLACE_SEARCH_BURST_LIMIT', 'amap-inputtips'],
  ];
  if (required.some(([name]) => typeof env[name]?.limit !== 'function')) {
    console.error('[HomeMew place search] rate limits not configured');
    return errorResponse(503, 'PLACE_SEARCH_NOT_READY', 'Place search is temporarily unavailable');
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actorKey));
  const actor = Array.from(new Uint8Array(hash).slice(0, 16), value => value.toString(16).padStart(2, '0')).join('');
  try {
    for (const [name, constantKey] of required) {
      const { success } = await env[name].limit({ key: constantKey || actor });
      if (!success) {
        console.info('[HomeMew place search] rate_limited', name);
        return errorResponse(429, 'PLACE_SEARCH_RATE_LIMITED', '地点查询过于频繁，请稍后再试');
      }
    }
  } catch (error) {
    console.error('[HomeMew place search] rate limit unavailable');
    return errorResponse(503, 'PLACE_SEARCH_NOT_READY', 'Place search is temporarily unavailable');
  }
  return null;
}

export async function searchPlaces(request,env,{fetcher=fetch, actorKey}={}) {
  const url=new URL(request.url), query=url.searchParams.get('q')?.trim()||'';
  if([...url.searchParams.keys()].some(k=>k!=='q')||query.length>100) return errorResponse(400,'INVALID_QUERY','Invalid place query');
  if(query.length<2) return json({data:{items:[],available:false,structured:true}});
  const structured=true;
  const key=env.AMAP_WEB_SERVICE_KEY;
  if(typeof key!=='string'||!key.trim())return json({data:{items:[],available:false,structured}});
  const blocked = await enforcePlaceRateLimits(env, actorKey);
  if (blocked) return blocked;
  const target=new URL('https://restapi.amap.com/v3/assistant/inputtips');
  target.searchParams.set('key',key);
  target.searchParams.set('keywords',query);
  target.searchParams.set('datatype','poi');
  target.searchParams.set('output','json');
  try{
    // Cloudflare Workers only accepts 'follow' and 'manual'. 'error' throws
    // synchronously before sending the request. 'manual' + reject 3xx keeps
    // provider credentials from being forwarded to any redirect target.
    const res=await fetcher(target.toString(),{signal:AbortSignal.timeout(4000),redirect:'manual'});
    if(res.status>=300&&res.status<400) {
      console.warn('[HomeMew place search] provider_redirect_blocked',res.status);
      return errorResponse(502,'PLACE_SEARCH_UNAVAILABLE','Place search is temporarily unavailable');
    }
    if(!res.ok) {
      console.warn('[HomeMew place search] provider_http_error', res.status);
      return errorResponse(502,'PLACE_SEARCH_UNAVAILABLE','Place search is temporarily unavailable');
    }
    const payload=await res.json();
    if(payload?.status!=='1'||!Array.isArray(payload.tips)) {
      // AMap responds with HTTP 200 even for invalid/unauthorized API keys.
      // The numeric status is safe to log. Never log the provider URL or key.
      const code=typeof payload?.infocode==='string'&&/^\d{5}$/.test(payload.infocode)
        ?payload.infocode:'unknown';
      console.warn('[HomeMew place search] provider_rejected',code);
      return errorResponse(502,'PLACE_SEARCH_UNAVAILABLE','Place search is temporarily unavailable');
    }
    const items=parseAmapSuggestions(payload);
    console.info('[HomeMew place search] provider_success');
    return json({data:{items,available:true,structured}});
  }catch{
    console.warn('[HomeMew place search] provider_failed');
    return errorResponse(502,'PLACE_SEARCH_UNAVAILABLE','Place search is temporarily unavailable');
  }
}
export async function handleMiniPlaceSearch(request,env,options={}) {
  if(new URL(request.url).pathname!=='/api/v1/miniprogram/places/search')return null;
  if(request.method!=='GET')return errorResponse(405,'METHOD_NOT_ALLOWED','GET required');
  // Never expose a paid provider key through an unauthenticated public search endpoint.
  const auth=await forwardLifeSpace(new Request(request.url,{headers:request.headers}),env,{
    target:'identity',upstreamPath:'/api/v1/me'});
  if(!auth.ok)return auth;
  return searchPlaces(request,env,{...options,actorKey:request.headers.get('authorization')});
}
