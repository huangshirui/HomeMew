/** Non-authoritative player preference and explicit product filter DTO. */
export type FootballScope={year?:string;matchType?:string;q?:string;playerPersonId?:string;representativeTeamId?:string;opponentTeamId?:string;competitionActivityId?:string};
const key=(userId:string,familyId:string)=>'homemew.football.player:'+encodeURIComponent(userId)+':'+encodeURIComponent(familyId);
export function preferredFootballPerson(people:{personId:string;displayName:string}[],current:string,userId:string,familyId:string):string{
  let saved='';try{if(userId&&familyId)saved=wx.getStorageSync(key(userId,familyId));}catch{}
  return people.find(p=>p.personId===current)?.personId||people.find(p=>p.personId===saved)?.personId||people.find(p=>p.displayName.toLowerCase()==='kk')?.personId||people[0]?.personId||'';
}
export function rememberFootballPerson(userId:string,familyId:string,personId:string):void{
  try{if(userId&&familyId)wx.setStorageSync(key(userId,familyId),personId);}catch{}
}
export function parseFootballScope(raw?:string):FootballScope{
  try{
    const value:unknown=JSON.parse(raw?.startsWith('%')?decodeURIComponent(raw):raw||'{}');if(!value||typeof value!=='object'||Array.isArray(value))return{};
    const result:FootballScope={};
    for(const field of ['year','matchType','q','playerPersonId','representativeTeamId','opponentTeamId','competitionActivityId'] as const){
      const text=(value as Record<string,unknown>)[field];if(typeof text==='string'&&text.length<=200)result[field]=text;
    }
    return result;
  }catch{return{};}
}
