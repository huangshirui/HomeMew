/** WeChat-native Football consumers of the bounded HomeMew Mini BFF. */
import { request } from './api';
import { productQuery } from './product-routes';
import {
  listDomainRecords,getDomainRecord,createDomainRecord,updateDomainRecord,deleteDomainRecord,
  type DomainRecord,type DomainPage,
} from './domains';

export type Match=DomainRecord&{id:string;version:number;matchDate:string;matchType:string;representativeTeamId:string;
  opponentTeamId:string;playerPersonIds:string[];representativeTeamScore?:number|null;opponentTeamScore?:number|null};
export type Performance=DomainRecord&{id:string;matchId:string;playerPersonId:string;performanceType:string};
export type FootballPerson={id:string;version:number;displayName:string;linkedUser?:boolean};
export type FootballSchema={key:string;version:number;fields:{key:string;values?:string[]}[]};
const root=(familyId:string)=>'/api/v1/miniprogram/families/'+encodeURIComponent(familyId);
export const listMatches=(f:string,o:{cursor?:string;q?:string;year?:string;matchType?:string;playerPersonId?:string;
  representativeTeamId?:string;opponentTeamId?:string;competitionActivityId?:string;limit?:number}={})=>
  listDomainRecords(f,'football-matches',o) as Promise<DomainPage<Match>>;
export const getMatch=(f:string,id:string)=>getDomainRecord(f,'football-matches',id) as Promise<Match>;
export const saveMatch=(f:string,data:Record<string,unknown>,id?:string)=>id?
  updateDomainRecord(f,'football-matches',id,data):createDomainRecord(f,'football-matches',data);
export const removeMatch=(f:string,id:string,version:number)=>deleteDomainRecord(f,'football-matches',id,version);
export const listPerformances=(f:string,matchId?:string,cursor?:string,playerPersonId?:string)=>
  listDomainRecords(f,'football-performances',{matchId,playerPersonId,cursor,limit:100}) as Promise<DomainPage<Performance>>;
export const savePerformance=(f:string,data:Record<string,unknown>,id?:string)=>id?
  updateDomainRecord(f,'football-performances',id,data):createDomainRecord(f,'football-performances',data);
export const removePerformance=(f:string,id:string,version:number)=>deleteDomainRecord(f,'football-performances',id,version);
export const listTeams=(f:string,cursor?:string,q?:string)=>listDomainRecords(f,'football-teams',{limit:50,cursor,q});
export const getTeam=(f:string,id:string)=>getDomainRecord(f,'football-teams',id);
export const saveTeam=(f:string,data:Record<string,unknown>,id?:string)=>id?
  updateDomainRecord(f,'football-teams',id,data):createDomainRecord(f,'football-teams',data);
export const listFootballPeople=(f:string,q?:string,cursor?:string)=>
  request<DomainPage<FootballPerson>>(root(f)+'/football-people'+productQuery({q,cursor,limit:50}));
export const getFootballPerson=(f:string,id:string)=>request<FootballPerson>(root(f)+'/football-people/'+encodeURIComponent(id));
export const saveFootballPerson=(f:string,displayName:string,id?:string,version?:number)=>
  request<FootballPerson>(root(f)+'/football-people'+(id?'/'+encodeURIComponent(id):''),{
    method:id?'PATCH':'POST',data:{displayName,...(id?{version}:{})},skipRetry:true});
export const removeFootballPerson=(f:string,id:string,version:number)=>
  request<void>(root(f)+'/football-people/'+encodeURIComponent(id),{method:'DELETE',data:{version},skipRetry:true});
export const readPerformanceSchema=(f:string)=>request<FootballSchema>(root(f)+'/football-performance-schema');
export const quickTypes=[
  {key:'goal',name:'进球',icon:'⚽'},{key:'assist',name:'助攻',icon:'👟'},
  {key:'shot',name:'射门',icon:'🎯'},{key:'key_pass',name:'关键传球',icon:'💡'},
  {key:'successful_dribble',name:'成功过人',icon:'✨'},{key:'tackle',name:'抢断',icon:'🛡️'},
  {key:'interception',name:'拦截',icon:'✂️'},{key:'clearance',name:'解围',icon:'🚀'},
];
export const typeLabels:Record<string,string>={
  appearance:'出场记录',goal:'进球',assist:'助攻',shot:'射门',key_pass:'关键传球',successful_dribble:'成功过人',
  cross:'传中',penalty_won:'造点球',tackle:'抢断',interception:'拦截',clearance:'解围',block:'封堵',
  ball_recovery:'球权回收',aerial_duel_won:'争顶成功',pressure:'压迫',save:'扑救',
  goalkeeper_claim:'出击控球',goalkeeper_punch:'击拳解围',one_on_one_save:'单刀扑救',
  yellow_card:'黄牌',red_card:'红牌',foul:'犯规',foul_won:'造犯规',offside:'越位',
  own_goal:'乌龙球',critical_error:'致命失误',highlight:'精彩表现',
};
export const goalMethods=[{key:'',name:'未填写'},{key:'left_foot',name:'左脚'},{key:'right_foot',name:'右脚'},
  {key:'header',name:'头球'},{key:'penalty',name:'点球'},{key:'other',name:'其他'},{key:'unknown',name:'不明'}];
export const shotOutcomes=[{key:'',name:'未填写'},{key:'on_target',name:'射正'},{key:'off_target',name:'射偏'},
  {key:'blocked',name:'被封堵'},{key:'woodwork',name:'击中门框'},{key:'unknown',name:'未知'}];
export const entryModes=[{key:'',name:'未填写'},{key:'starter',name:'首发'},
  {key:'substitute',name:'替补／再次登场'},{key:'position_change',name:'场内换位'}];
export function availableTypes(schema:FootballSchema):string[]{
  return schema.fields.find(f=>f.key==='performanceType')?.values||[];
}
export function validatePerformance(draft:{
  matchId:string;playerPersonId:string;performanceType:string;notes:string;goalMethod:string;
  shotOutcome:string;minutesPlayed:string;position:string;entryMode:string;
},schema:FootballSchema):Record<string,unknown>{
  if(!availableTypes(schema).includes(draft.performanceType))throw Error('表现类型未在正式模型中发布');
  if(!draft.matchId||!draft.playerPersonId)throw Error('请选择比赛和球员');
  const declared=(key:string)=>schema.fields.find(f=>f.key===key)?.values||[];
  if(draft.performanceType==='goal'&&draft.goalMethod&&!declared('goalMethod').includes(draft.goalMethod))
    throw Error('所选进球方式未发布');
  if(draft.performanceType==='shot'&&draft.shotOutcome&&!declared('shotOutcome').includes(draft.shotOutcome))
    throw Error('所选射门结果未发布');
  if(draft.performanceType==='appearance'&&draft.entryMode&&!declared('entryMode').includes(draft.entryMode))
    throw Error('所选出场方式未发布');
  const minutes=draft.minutesPlayed===''?null:Number(draft.minutesPlayed);
  if(draft.performanceType==='appearance'&&minutes!==null&&(!Number.isInteger(minutes)||minutes<0))
    throw Error('出场时长必须是非负整数');
  return{
    matchId:draft.matchId,playerPersonId:draft.playerPersonId,performanceType:draft.performanceType,
    notes:draft.notes.trim()||null,
    goalMethod:draft.performanceType==='goal'?draft.goalMethod||null:null,
    ...(declared('shotOutcome').length?{shotOutcome:draft.performanceType==='shot'?draft.shotOutcome||null:null}:{}),
    minutesPlayed:draft.performanceType==='appearance'?minutes:null,
    position:draft.performanceType==='appearance'?draft.position.trim()||null:null,
    entryMode:draft.performanceType==='appearance'?draft.entryMode||null:null,
  };
}
