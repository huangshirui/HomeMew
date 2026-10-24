/** Small, exact native-football aggregation: do not infer missing performances or minutes. */
import type { Match,Performance } from '../services/football';
export type MonthMetric={month:string;matches:number;goals:number;assists:number;tackles:number;interceptions:number;
  minutes:number;completeMinutesMatches:number;timedGoals:number;timedAssists:number};
export type FootballSummary={matches:number;scoredMatches:number;wins:number;winRate:number|null;
  goals:number;assists:number;completeMinutesMatches:number;knownMinutes:number;months:MonthMetric[]};
export function aggregateFootball(matches:Match[],events:Performance[],playerId:string):FootballSummary{
  const played=matches.filter(m=>m.playerPersonIds?.includes(playerId));
  const playedMap=new Map(played.map(m=>[m.id,m]));
  const months=new Map<string,MonthMetric>();
  let scoredMatches=0,wins=0;
  for(const m of played){
    if(typeof m.representativeTeamScore==='number'&&typeof m.opponentTeamScore==='number'){
      scoredMatches++;if(m.representativeTeamScore>m.opponentTeamScore)wins++;
    }
    const key=m.matchDate.slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))continue;
    if(!months.has(key))months.set(key,{month:key,matches:0,goals:0,assists:0,tackles:0,interceptions:0,
      minutes:0,completeMinutesMatches:0,timedGoals:0,timedAssists:0});
    months.get(key)!.matches++;
  }
  const filtered=events.filter(p=>p.playerPersonId===playerId&&playedMap.has(p.matchId));
  const segments=new Map<string,Performance[]>();
  for(const p of filtered)if(p.performanceType==='appearance')segments.set(p.matchId,[...(segments.get(p.matchId)||[]),p]);
  const fullyTimed=new Set<string>();
  for(const m of played){
    const s=segments.get(m.id)||[];
    if(s.length&&s.every(p=>typeof p.minutesPlayed==='number'&&Number.isInteger(p.minutesPlayed)&&p.minutesPlayed>=0)){
      const month=months.get(m.matchDate.slice(0,7));
      if(month){month.completeMinutesMatches++;month.minutes+=s.reduce((sum,p)=>sum+(p.minutesPlayed||0),0);fullyTimed.add(m.id);}
    }
  }
  for(const e of filtered){
    const m=playedMap.get(e.matchId)!,bucket=months.get(m.matchDate.slice(0,7));
    if(!bucket)continue;
    if(e.performanceType==='goal'){bucket.goals++;if(fullyTimed.has(e.matchId))bucket.timedGoals++;}
    if(e.performanceType==='assist'){bucket.assists++;if(fullyTimed.has(e.matchId))bucket.timedAssists++;}
    if(e.performanceType==='tackle')bucket.tackles++;
    if(e.performanceType==='interception')bucket.interceptions++;
  }
  const items=[...months.values()].sort((a,b)=>a.month.localeCompare(b.month));
  return{matches:played.length,scoredMatches,wins,winRate:scoredMatches?wins/scoredMatches:null,
    goals:items.reduce((s,b)=>s+b.goals,0),assists:items.reduce((s,b)=>s+b.assists,0),
    completeMinutesMatches:fullyTimed.size,knownMinutes:items.reduce((s,b)=>s+b.minutes,0),
    months:items};
}
export type Trend='attack'|'efficiency'|'defense';
export function metricPair(month:MonthMetric,trend:Trend):[number|null,number|null]{
  if(trend==='attack')return[month.matches?month.goals/month.matches:null,month.matches?month.assists/month.matches:null];
  if(trend==='defense')return[month.matches?month.tackles/month.matches:null,month.matches?month.interceptions/month.matches:null];
  return[month.completeMinutesMatches&&month.timedGoals?month.minutes/month.timedGoals:null,
    month.completeMinutesMatches&&month.timedAssists?month.minutes/month.timedAssists:null];
}
