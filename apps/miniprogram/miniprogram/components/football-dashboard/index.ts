import { listMatches,listPerformances,type Match,type Performance } from '../../services/football';
import { aggregateFootball,metricPair,type Trend } from '../../utils/football-stats';
import { footballChart } from '../../utils/football-chart';
import type { FootballScope } from '../../utils/football-scope';
const trends=[{key:'attack',name:'场均进攻',labelA:'场均进球',labelB:'场均助攻',unit:'次／场'},
  {key:'efficiency',name:'进攻效率',labelA:'平均每进球分钟数',labelB:'平均每助攻分钟数',unit:'分钟／次'},
  {key:'defense',name:'场均防守',labelA:'场均抢断',labelB:'场均拦截',unit:'次／场'}];
const fmt=(n:number|null)=>n===null?'—':String(Number(n.toFixed(2)));
Component({
  options:{pureDataPattern:/^_/},
  properties:{familyId:{type:String,value:''},scope:{type:Object,value:{} as FootballScope}},
  data:{_generation:0,_matches:[] as Match[],_events:[] as Performance[],loading:false,error:'',trend:'attack' as Trend,trends,activeTrend:trends[0],matchCount:0,goalCount:0,assistCount:0,winRate:'—',minutes:'—',coverage:'',scoreCoverage:'',chartBackground:'',chartWidth:360,months:[] as {month:string;first:string;second:string;matches:number}[]},
  observers:{'familyId,scope':function():void{void this.load();}},
  lifetimes:{detached():void{this.data._generation++;}},
  methods:{
    async load():Promise<void>{
      const generation=++this.data._generation,{familyId,scope}=this.properties;
      if(!familyId||!scope.playerPersonId){this.setData({loading:false,error:'请选择家庭球员后查看统计'});return;}
      this.setData({loading:true,error:''});
      try{
        const matches:Match[]=[],events:Performance[]=[];let cursor:string|undefined;
        for(let i=0;i<8;i++){
          const page=await listMatches(familyId,{...scope,limit:100,cursor});if(generation!==this.data._generation)return;
          matches.push(...page.items);cursor=page.nextCursor||undefined;if(!cursor)break;
          if(i===7)throw Error('比赛超过 800 场，请缩小筛选范围');
        }
        cursor=undefined;
        for(let i=0;i<8;i++){
          const page=await listPerformances(familyId,undefined,cursor,scope.playerPersonId);if(generation!==this.data._generation)return;
          events.push(...page.items);cursor=page.nextCursor||undefined;if(!cursor)break;
          if(i===7)throw Error('表现超过 800 条，无法保证完整统计，请缩小范围');
        }
        this.data._matches=matches;this.data._events=events;this.renderStats();
      }catch(e){if(generation===this.data._generation)this.setData({error:(e as Error).message||'统计加载失败'});}
      finally{if(generation===this.data._generation)this.setData({loading:false});}
    },
    renderStats():void{
      const summary=aggregateFootball(this.data._matches,this.data._events,this.properties.scope.playerPersonId||'');
      const activeTrend=trends.find(t=>t.key===this.data.trend)||trends[0],chart=footballChart(summary.months,this.data.trend);
      this.setData({activeTrend,matchCount:summary.matches,goalCount:summary.goals,assistCount:summary.assists,
        winRate:summary.winRate===null?'—':String(Number((summary.winRate*100).toFixed(1)))+'%',minutes:summary.completeMinutesMatches?String(summary.knownMinutes):'—',
        coverage:'已记时长 '+summary.completeMinutesMatches+' / '+summary.matches+' 场',scoreCoverage:'有比分 '+summary.scoredMatches+' / '+summary.matches+' 场',
        chartWidth:chart.width,chartBackground:chart.background,
        months:summary.months.map(m=>{const p=metricPair(m,this.data.trend);return{month:m.month,first:fmt(p[0]),second:fmt(p[1]),matches:m.matches};})});
    },
    onTrend(e:WechatMiniprogram.TouchEvent):void{this.setData({trend:String(e.currentTarget.dataset.key) as Trend});this.renderStats();},
    onRetry():void{void this.load();},
  },
});
