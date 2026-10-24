/** Per-user recent Location snapshots; never used as domain truth. */
export const MAX_RECENT_PLACES=30;
const TTL_MS=90*86400000;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function validRecentLocation(v) {
 if(!object(v)||Object.keys(v).some(k=>!['name','address','coordinates'].includes(k))||
   typeof v.name!=='string'||!v.name.trim()||v.name.length>500)return false;
 if(v.address!==undefined&&(typeof v.address!=='string'||v.address.length>1000))return false;
 if(v.coordinates!==undefined){
  const c=v.coordinates;
  if(!object(c)||Object.keys(c).some(k=>!['latitude','longitude'].includes(k))||
    typeof c.latitude!=='number'||typeof c.longitude!=='number'||
    !Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||
    Math.abs(c.latitude)>90||Math.abs(c.longitude)>180)return false;
 }
 return true;
}
export function locationKey(v){
 const c=v.coordinates;
 return JSON.stringify([v.name.trim().toLocaleLowerCase(),(v.address||'').trim().toLocaleLowerCase(),
  c?Math.round(c.latitude*1e6):null,c?Math.round(c.longitude*1e6):null]);
}
export function pruneRecentPlaces(rows,now=Date.now()) {
 return (Array.isArray(rows)?rows:[]).filter(row=>validRecentLocation(row?.location)&&
  Number.isFinite(Date.parse(row?.lastUsedAt))&&Date.parse(row.lastUsedAt)<=now+60000&&
  now-Date.parse(row.lastUsedAt)<TTL_MS)
  .sort((a,b)=>Date.parse(b.lastUsedAt)-Date.parse(a.lastUsedAt)).slice(0,MAX_RECENT_PLACES);
}
export function upsertRecentPlace(rows,location,now=Date.now()) {
 if(!validRecentLocation(location))throw new TypeError('Invalid Location');
 const value={name:location.name.trim(),...(location.address!==undefined?{address:location.address.trim()}:{}),
  ...(location.coordinates?{coordinates:{...location.coordinates}}:{})};
 const key=locationKey(value),items=pruneRecentPlaces(rows,now),prev=items.find(x=>locationKey(x.location)===key);
 return pruneRecentPlaces([{location:value,lastUsedAt:new Date(now).toISOString(),useCount:(prev?.useCount||0)+1},
  ...items.filter(x=>locationKey(x.location)!==key)],now);
}
