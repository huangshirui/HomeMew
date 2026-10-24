import { currentFamilyStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { listFootballPeople,listMatches,listPerformances,type Match,type Performance } from '../../services/football';
import { aggregateFootball,metricPair,type FootballSummary,type Trend } from '../../utils/football-stats';
type ChartMonth={month:string;dateLabel:string;first:string;second:string;heightA:number;heightB:number;matchCount:number};
const trends:{key:Trend;name:string;labelA:string;labelB:string;unit:string}[]=[
  {key:'attack',name:'场均进攻',labelA:'场均进球',labelB:'场均助攻',unit:'次／场'},
  {key:'efficiency',name:'进攻效率',labelA:'每进球分钟数',labelB:'每助攻分钟数',unit:'分钟／次'},
  {key:'defense',name:'场均防守',labelA:'场均抢断',labelB:'场均拦截',unit:'次／场'},
];
const fmt=(n:number|null,prec=2)=>n===null?'—':String(Number(n.toFixed(prec)));
Page({
  data:{
    familyId:'',loading:true,error:'',people:[] as {id:string;displayName:string}[],personIndex:0,personId:'',
    summary:null as FootballSummary|null,months:[] as ChartMonth[],trend:'attack' as Trend,
    trends,activeTrend:trends[0],winRate:'—',goalCount:0,assistCount:0,matchCount:0,
    minutes:'—',coverage:'',scope:'最近可查询的全部比赛',
  },
  _matches:[] as Match[],_events:[] as Performance[],
  async onLoad(opts:{familyId?:string}):Promise<void>{
    this.setData({familyId:opts.familyId||currentFamilyStore.value?.id||''});
    try{await ensureRuntimeReady();}catch{}
    await this.load();
  },
  async load():Promise<void>{
    this.setData({loading:true,error:''});
    try{
      const peoplePage=await listFootballPeople(this.data.familyId);
      const people=peoplePage.items;
      const personId=this.data.personId&&people.some(p=>p.id===this.data.personId)?
        this.data.personId:people[0]?.id||'';
      if(!personId){this.setData({people:[],summary:null,error:'请先录入球员'});return;}
      const matches:Match[]=[],performances:Performance[]=[];
      let cursor:string|undefined;
      for(let i=0;i<8;i++){
        const page=await listMatches(this.data.familyId,{limit:100,cursor,playerPersonId:personId});
        matches.push(...page.items);cursor=page.nextCursor||undefined;
        if(!cursor)break;
        if(i===7)throw Error('比赛超过 800 场，请先在 Web 限定统计范围，避免展示不完整结果');
      }
      cursor=undefined;
      for(let i=0;i<8;i++){
        const page=await listPerformances(this.data.familyId,undefined,cursor,personId);
        performances.push(...page.items);cursor=page.nextCursor||undefined;
        if(!cursor)break;
        if(i===7)throw Error('表现记录超过 800 条，无法保证完整统计，请缩小范围');
      }
      this._matches=matches;this._events=performances;
      this.setData({people,personId,personIndex:Math.max(0,people.findIndex(p=>p.id===personId))});
      this.refreshStats();
    }catch(e){this.setData({error:(e as Error).message||'统计数据加载失败'});}
    finally{this.setData({loading:false});}
  },
  refreshStats():void{
    const data=aggregateFootball(this._matches,this._events,this.data.personId);
    const trend=this.data.trend,settings=trends.find(t=>t.key===trend)||trends[0];
    const values=data.months.slice(-18).map(b=>metricPair(b,trend));
    const max=Math.max(1,...values.flatMap(v=>v.filter((x):x is number=>x!==null)));
    const months=data.months.slice(-18).map((m,i)=>{
      const a=values[i][0],b=values[i][1];
      return{month:m.month,dateLabel:m.month.slice(2).replace('-','/'),first:fmt(a),
        second:fmt(b),heightA:a===null?0:Math.max(3,Math.round(a/max*155)),
        heightB:b===null?0:Math.max(3,Math.round(b/max*155)),matchCount:m.matches};
    });
    this.setData({summary:data,months,activeTrend:settings,matchCount:data.matches,
      goalCount:data.goals,assistCount:data.assists,winRate:data.winRate===null?'—':fmt(data.winRate*100,1)+'%',
      minutes:data.completeMinutesMatches?String(data.knownMinutes):'—',
      coverage:'有比分 '+data.scoredMatches+' / '+data.matches+' 场；有完整出场时长 '+data.completeMinutesMatches+' 场'});
  },
  onPerson(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value),person=this.data.people[index];
    if(!person)return;
    this.setData({personIndex:index,personId:person.id});
    void this.load();
  },
  onTrend(e:WechatMiniprogram.TouchEvent):void{
    const trend=String(e.currentTarget.dataset.key||'attack') as Trend;
    this.setData({trend});this.refreshStats();
  },
  onRetry():void{void this.load();},
});