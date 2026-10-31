import { currentFamilyStore, userStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { listDomainPeople,getDomainRecord,type PersonOption,type DomainIcon } from '../../services/domains';
import { listMatches,getTeam,type Match } from '../../services/football';
import { preferredFootballPerson,rememberFootballPerson,parseFootballScope,type FootballScope } from '../../utils/football-scope';

type MatchRow=Match&{representativeName:string;opponentName:string;competitionName:string;score:string;dateText:string;representativeIcon:DomainIcon|null;opponentIcon:DomainIcon|null};
Page({
  data:{
    mode:'record' as 'record'|'stats',activeScope:{} as FootballScope,hasFilters:false,teamIcons:{} as Record<string,DomainIcon|null>,userId:'',familyId:'',loading:true,loadedOnce:false,loadingMore:false,error:'',rows:[] as MatchRow[],nextCursor:null as string|null,
    people:[] as PersonOption[],personIndex:0,personOptions:[] as {id:string;label:string}[],personId:'',
    filterOpen:false,year:'',matchType:'',matchTypeIndex:0,matchTypes:[{key:'',label:'全部类型'},{key:'official',label:'正式比赛'},{key:'friendly',label:'友谊赛'}],
    years:['全部年份',...Array.from({length:5},(_,i)=>String(new Date().getFullYear()-i)),'其他年份…'],yearIndex:0,
    search:'',appliedSearch:'',knownTeams:{} as Record<string,string>,
    representativeTeamId:'',opponentTeamId:'',competitionActivityId:'',
    representativeTeamName:'全部代表球队',opponentTeamName:'全部对手球队',competitionName:'全部赛事',

  },
  _generation:0,
  onLoad(opts:{familyId?:string;mode?:string;scope?:string}):void{
    const scope=parseFootballScope(opts.scope);
    this.setData({...scope,familyId:opts.familyId||currentFamilyStore.value?.id||'',mode:opts.mode==='stats'?'stats':'record',
      personId:scope.playerPersonId||'',search:scope.q||'',appliedSearch:scope.q||'',
      yearIndex:scope.year?(this.data.years.includes(scope.year)?this.data.years.indexOf(scope.year):this.data.years.length-1):0,
      matchTypeIndex:this.data.matchTypes.findIndex(t=>t.key===(scope.matchType||'')),
      competitionName:scope.competitionActivityId?'已选赛事':'全部赛事',representativeTeamName:scope.representativeTeamId?'已选代表球队':'全部代表球队',opponentTeamName:scope.opponentTeamId?'已选对手球队':'全部对手球队'});
  },
  onMode(e:WechatMiniprogram.CustomEvent<{mode:string}>):void{
    const mode=e.detail.mode==='stats'?'stats':'record';this.setData({mode,activeScope:this.scope()});
    if(mode==='record')void this.load(true);
  },
  async onShow():Promise<void>{
    try{await ensureRuntimeReady();}catch{}
    const familyId=currentFamilyStore.value?.id||'';
    if(!familyId){++this._generation;this.setData({loading:false,error:'请先加入家庭',familyId:'',rows:[],loadedOnce:false});return;}
    if(familyId!==this.data.familyId){
      ++this._generation;
      this.setData({familyId,rows:[],nextCursor:null,loadedOnce:false,personId:'',personIndex:0,knownTeams:{},teamIcons:{},activeScope:{},hasFilters:false,
        representativeTeamId:'',opponentTeamId:'',competitionActivityId:'',representativeTeamName:'全部代表球队',opponentTeamName:'全部对手球队',competitionName:'全部赛事'});
    }
    this.setData({userId:userStore.value?.id||''});
    await this.load(true);
  },
  onUnload():void{this._generation++;},
  scope():FootballScope{
    const d=this.data;return{year:d.year,matchType:d.matchType,q:d.appliedSearch,playerPersonId:d.personId,
      representativeTeamId:d.representativeTeamId,opponentTeamId:d.opponentTeamId,competitionActivityId:d.competitionActivityId};
  },
  async load(reset:boolean):Promise<void>{
    const familyId=this.data.familyId;if(!familyId)return;
    const generation=++this._generation;
    this.setData({loading:reset&&!this.data.loadedOnce,loadingMore:!reset,error:''});
    try{
      if(reset){
        const people=await listDomainPeople(familyId);
        if(generation!==this._generation)return;
        const personId=preferredFootballPerson(people,this.data.personId,userStore.value?.id||'',familyId);
        const options=people.map(person=>({id:person.personId,label:person.displayName}));
        this.setData({people,personOptions:options,personId,personIndex:Math.max(0,options.findIndex(p=>p.id===personId))});
      }
      const activeScope=this.scope();this.setData({activeScope,hasFilters:Object.keys(activeScope).some(k=>k!=='playerPersonId'&&Boolean(activeScope[k as keyof FootballScope]))});
      if(this.data.mode==='stats'){this.setData({loadedOnce:true});return;}
      const page=await listMatches(familyId,{...this.scope(),limit:40,cursor:reset?undefined:this.data.nextCursor||undefined});
      const names={...this.data.knownTeams},icons={...this.data.teamIcons};
      const teamIds=new Set<string>();for(const m of page.items){teamIds.add(m.representativeTeamId);teamIds.add(m.opponentTeamId);}
      const competitionIds=new Set(page.items.map(m=>m.competitionActivityId).filter((id):id is string=>!!id));
      await Promise.all([
        ...[...teamIds].filter(id=>!names[id]).map(async id=>{try{const team=await getTeam(familyId,id);names[id]=team.name||'未命名球队';icons[id]=team.presentation?.icon||null;}catch{}}),
        ...[...competitionIds].filter(id=>!names[id]).map(async id=>{try{names[id]=(await getDomainRecord(familyId,'activities',id)).name||'未命名赛事';}catch{}}),
      ]);
      if(generation!==this._generation)return;
      this.setData({knownTeams:names,teamIcons:icons,rows:reset?page.items.map(m=>this.row(m,names,icons)):[...this.data.rows,...page.items.map(m=>this.row(m,names,icons))],nextCursor:page.nextCursor,loadedOnce:true});
    }catch(error){if(generation===this._generation)this.setData({error:(error as Error).message||'加载失败'});}
    finally{if(generation===this._generation)this.setData({loading:false,loadingMore:false});}
  },
  row(m:Match,names:Record<string,string>,icons:Record<string,DomainIcon|null>={}):MatchRow{
    const a=m.representativeTeamScore,b=m.opponentTeamScore;
    return{...m,representativeIcon:icons[m.representativeTeamId]||null,opponentIcon:icons[m.opponentTeamId]||null,representativeName:names[m.representativeTeamId]||'球队暂不可查看',opponentName:names[m.opponentTeamId]||'球队暂不可查看',
      competitionName:m.competitionActivityId?names[m.competitionActivityId]||'赛事暂不可查看':'',
      score:typeof a==='number'&&typeof b==='number'?a+' : '+b:'— : —',dateText:m.matchDate+(m.matchType==='friendly'?' · 友谊赛':' · 正式比赛')};
  },
  onReachBottom():void{if(!this.data.loading&&!this.data.loadingMore&&this.data.nextCursor)void this.load(false);},
  onPullDownRefresh():void{void this.load(true).then(()=>wx.stopPullDownRefresh(),()=>wx.stopPullDownRefresh());},
  onToggleFilter():void{this.setData({filterOpen:!this.data.filterOpen});},
  onFilterInput(e:WechatMiniprogram.Input):void{this.setData({search:e.detail.value});},
  onYear(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value);
    if(index===this.data.years.length-1){
      wx.showModal({title:'其他年份',editable:true,placeholderText:'输入四位年份',success:r=>{
        if(r.confirm&&/^\d{4}$/.test(r.content?.trim()||'')){const year=r.content!.trim();this.setData({year,yearIndex:index});void this.load(true);}
        else if(r.confirm)wx.showToast({title:'请输入四位年份',icon:'none'});
      }});return;
    }
    this.setData({yearIndex:index,year:index?this.data.years[index]:''});void this.load(true);
  },
  onMatchType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value);this.setData({matchTypeIndex:index,matchType:this.data.matchTypes[index]?.key||''});void this.load(true);
  },
  onPerson(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value),personId=this.data.personOptions[index]?.id||'';
    this.setData({personIndex:index,personId});rememberFootballPerson(userStore.value?.id||'',this.data.familyId,personId);void this.load(true);
  },
  onRefresh():void{void this.load(true);},
  onApply():void{this.setData({appliedSearch:this.data.search.trim()});void this.load(true);},
  onReset():void{this.setData({year:'',yearIndex:0,matchType:'',matchTypeIndex:0,search:'',appliedSearch:'',
    representativeTeamId:'',opponentTeamId:'',competitionActivityId:'',representativeTeamName:'全部代表球队',opponentTeamName:'全部对手球队',competitionName:'全部赛事'});void this.load(true);},
  onReferenceSelect(e:WechatMiniprogram.CustomEvent<{id:string;name:string}>):void{
    const key=String(e.currentTarget.dataset.key);if(!['representativeTeamId','opponentTeamId','competitionActivityId'].includes(key))return;
    this.setData({[key]:e.detail.id});void this.load(true);
  },
  onCreate():void{wx.navigateTo({url:'/pages/football/edit?kind=match&familyId='+this.data.familyId});},
  onEditMatch(e:WechatMiniprogram.TouchEvent):void{wx.navigateTo({url:'/pages/football/edit?kind=match&familyId='+this.data.familyId+'&id='+encodeURIComponent(String(e.currentTarget.dataset.id))});},
  onRecord(e:WechatMiniprogram.TouchEvent):void{wx.navigateTo({url:'/pages/football/detail?familyId='+this.data.familyId+'&id='+encodeURIComponent(String(e.currentTarget.dataset.id))+'&personId='+encodeURIComponent(this.data.personId)});},
  onManage():void{wx.navigateTo({url:'/pages/football/manage?familyId='+this.data.familyId});},
  onActivities():void{wx.navigateTo({url:'/pages/domains/list?kind=activities'});},
  onStats():void{this.setData({mode:'stats',activeScope:this.scope()});},
});
