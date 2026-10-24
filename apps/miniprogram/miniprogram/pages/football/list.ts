import { currentFamilyStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { listDomainPeople,listDomainRecords,type PersonOption,type DomainRecord } from '../../services/domains';
import { listMatches,listTeams,getTeam,type Match } from '../../services/football';

type MatchRow=Match&{representativeName:string;opponentName:string;competitionName:string;score:string;dateText:string};
Page({
  data:{
    familyId:'',loading:true,loadingMore:false,error:'',mode:'record' as 'record'|'teams',
    rows:[] as MatchRow[],teams:[] as DomainRecord[],nextCursor:null as string|null,
    people:[] as PersonOption[],personIndex:0,personOptions:[] as {id:string;label:string}[],
    filterOpen:false,year:'',matchType:'',matchTypeIndex:0,matchTypes:[{key:'',label:'全部类型'},{key:'official',label:'正式比赛'},{key:'friendly',label:'友谊赛'}],
    search:'',appliedSearch:'',teamSearch:'',knownTeams:{} as Record<string,string>,
  },
  _generation:0,
  async onShow():Promise<void>{
    try{await ensureRuntimeReady();}catch{}
    const familyId=currentFamilyStore.value?.id||'';
    if(!familyId){this.setData({loading:false,error:'请先加入家庭',familyId:''});return;}
    if(familyId!==this.data.familyId)this.setData({familyId,personIndex:0,knownTeams:{}});
    await this.load(true);
  },
  onMode(e:WechatMiniprogram.TouchEvent):void{
    const mode=String(e.currentTarget.dataset.mode) as 'record'|'teams';
    this.setData({mode,rows:[],teams:[],nextCursor:null,error:''});void this.load(true);
  },
  async load(reset:boolean):Promise<void>{
    const familyId=this.data.familyId;if(!familyId)return;
    const generation=++this._generation;
    this.setData({loading:reset,loadingMore:!reset,error:reset?'':this.data.error});
    try{
      if(this.data.mode==='teams'){
        const page=await listTeams(familyId,reset?undefined:this.data.nextCursor||undefined,this.data.teamSearch||undefined);
        if(generation!==this._generation)return;
        this.setData({teams:reset?page.items:[...this.data.teams,...page.items],nextCursor:page.nextCursor});
      }else{
        const people=reset?await listDomainPeople(familyId):this.data.people;
        const options=[{id:'',label:'全部成员'},...people.map(person=>({id:person.personId,label:person.displayName}))];
        const personId=options[this.data.personIndex]?.id||'';
        const page=await listMatches(familyId,{
          limit:40,cursor:reset?undefined:this.data.nextCursor||undefined,
          year:this.data.year.trim()||undefined,matchType:this.data.matchType||undefined,
          q:this.data.appliedSearch||undefined,playerPersonId:personId||undefined,
        });
        const ids=new Set<string>();
        for(const match of page.items){
          if(match.representativeTeamId)ids.add(match.representativeTeamId);
          if(match.opponentTeamId)ids.add(match.opponentTeamId);
          if(match.competitionActivityId)ids.add(match.competitionActivityId);
        }
        const names={...this.data.knownTeams};
        // Fetch only referenced teams/competitions; never list all space records.
        await Promise.all([...ids].filter(id=>!names[id]).slice(0,70).map(async id=>{
          try{
            const type=page.items.some(m=>m.competitionActivityId===id)?'activities':'football-teams';
            const model=await (type==='activities'
              ? listDomainRecords(familyId,'activities',{q:'',limit:1}).then(()=>null) : getTeam(familyId,id));
            if(model?.name)names[id]=model.name;
          }catch{}
        }));
        if(generation!==this._generation)return;
        this.setData({
          people,personOptions:options,knownTeams:names,
          rows:reset?page.items.map(m=>this.row(m,names)):[...this.data.rows,...page.items.map(m=>this.row(m,names))],
          nextCursor:page.nextCursor,
        });
      }
    }catch(error){if(generation===this._generation)this.setData({error:(error as Error).message||'加载失败'});}
    finally{if(generation===this._generation)this.setData({loading:false,loadingMore:false});}
  },
  row(m:Match,names:Record<string,string>):MatchRow{
    const a=m.representativeTeamScore,b=m.opponentTeamScore;
    return{...m,representativeName:names[m.representativeTeamId]||'代表球队',
      opponentName:names[m.opponentTeamId]||'对方球队',
      competitionName:m.competitionActivityId?names[m.competitionActivityId]||'赛事':'',
      score:typeof a==='number'&&typeof b==='number'?a+' : '+b:'— : —',
      dateText:m.matchDate+(m.matchType==='friendly'?' · 友谊赛':' · 正式比赛')};
  },
  onReachBottom():void{if(!this.data.loading&&!this.data.loadingMore&&this.data.nextCursor)void this.load(false);},
  onPullDownRefresh():void{void this.load(true).finally(()=>wx.stopPullDownRefresh());},
  onToggleFilter():void{this.setData({filterOpen:!this.data.filterOpen});},
  onFilterInput(e:WechatMiniprogram.Input):void{
    const name=String(e.currentTarget.dataset.name||'');
    if(['year','search','teamSearch'].includes(name))this.setData({[name]:e.detail.value});
  },
  onMatchType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value);
    this.setData({matchTypeIndex:index,matchType:this.data.matchTypes[index]?.key||''});
    void this.load(true);
  },
  onPerson(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    this.setData({personIndex:Number(e.detail.value)});void this.load(true);
  },
  onApply():void{this.setData({appliedSearch:this.data.search.trim()});void this.load(true);},
  onReset():void{this.setData({year:'',matchType:'',matchTypeIndex:0,search:'',appliedSearch:'',personIndex:0});void this.load(true);},
  onCreateMatch():void{wx.navigateTo({url:'/pages/football/edit?kind=match&familyId='+this.data.familyId});},
  onCreateTeam():void{wx.navigateTo({url:'/pages/football/edit?kind=team&familyId='+this.data.familyId});},
  onRecord(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id);
    wx.navigateTo({url:'/pages/football/detail?familyId='+this.data.familyId+'&id='+encodeURIComponent(id)});
  },
  onTeam(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id);
    wx.navigateTo({url:'/pages/football/edit?kind=team&familyId='+this.data.familyId+'&id='+encodeURIComponent(id)});
  },
  onStats():void{wx.navigateTo({url:'/pages/football/stats?familyId='+this.data.familyId});},
});