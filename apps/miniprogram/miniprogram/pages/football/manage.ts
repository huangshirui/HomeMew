import { currentFamilyStore,userStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { readFootballRecent } from '../../utils/football-recent-cache';
import { listDomainPeople,deleteDomainRecord,type DomainRecord } from '../../services/domains';
import { getTeam,listTeams,listFootballPeople,saveFootballPerson,removeFootballPerson,listMatches,listPerformances,type FootballPerson } from '../../services/football';
Page({
  data:{familyId:'',tab:'teams',loading:true,loadedOnce:false,loadingMore:false,busy:false,error:'',search:'',appliedSearch:'',
    teams:[] as DomainRecord[],players:[] as FootballPerson[],familyPersonIds:[] as string[],nextCursor:null as string|null},
  _generation:0,_timer:0 as ReturnType<typeof setTimeout>|0,
  onLoad(opts:{familyId?:string}):void{this.setData({familyId:opts.familyId||currentFamilyStore.value?.id||''});},
  async onShow():Promise<void>{
    try{await ensureRuntimeReady();}catch{}
    const familyId=currentFamilyStore.value?.id||'';
    if(familyId!==this.data.familyId){++this._generation;this.setData({familyId,teams:[],players:[],nextCursor:null,loadedOnce:false});}
    await this.load(true);
  },
  onUnload():void{this._generation++;if(this._timer)clearTimeout(this._timer);},
  async load(reset:boolean):Promise<void>{
    if(!this.data.familyId){this.setData({loading:false,error:'请先加入家庭'});return;}
    const generation=++this._generation;
    this.setData({loading:reset&&!this.data.loadedOnce,loadingMore:!reset,error:''});
    try{
      const q=this.data.appliedSearch||undefined,cursor=reset?undefined:this.data.nextCursor||undefined;
      if(this.data.tab==='teams'){
        let page:{items:DomainRecord[];nextCursor:string|null};
        if(q){
          if(q.length<2){this.setData({error:'输入至少两个字可搜索更多球队'});return;}
          page=await listTeams(this.data.familyId,cursor,q);
        }else{
          const recent=readFootballRecent(userStore.value?.id||'',this.data.familyId,'team');
          const matches=await listMatches(this.data.familyId,{limit:20});
          const ids=new Set(recent.map(t=>t.id));for(const m of matches.items){ids.add(m.representativeTeamId);ids.add(m.opponentTeamId);}
          const teams=await Promise.all([...ids].filter(Boolean).slice(0,50).map(id=>getTeam(this.data.familyId,id).catch(()=>null)));
          page={items:teams.filter((t):t is DomainRecord=>!!t),nextCursor:null};
        }
        if(generation===this._generation)this.setData({teams:reset?page.items:[...this.data.teams,...page.items],nextCursor:page.nextCursor,loadedOnce:true});
      }else{
        const [page,family]=await Promise.all([listFootballPeople(this.data.familyId,q,cursor),listDomainPeople(this.data.familyId)]);
        if(generation!==this._generation)return;
        const familyPersonIds=family.map(p=>p.personId);
        const players=page.items.filter(p=>!p.linkedUser&&!familyPersonIds.includes(p.id));
        this.setData({players:reset?players:[...this.data.players,...players],familyPersonIds,nextCursor:page.nextCursor,loadedOnce:true});
      }
    }catch(e){if(generation===this._generation)this.setData({error:(e as Error).message||'加载失败'});}
    finally{if(generation===this._generation)this.setData({loading:false,loadingMore:false});}
  },
  onTab(e:WechatMiniprogram.TouchEvent):void{this.setData({tab:String(e.currentTarget.dataset.tab),search:'',appliedSearch:'',teams:[],players:[],nextCursor:null,loadedOnce:false});void this.load(true);},
  onInput(e:WechatMiniprogram.Input):void{if(this._timer)clearTimeout(this._timer);this.setData({search:e.detail.value});this._timer=setTimeout(()=>this.onSearch(),320);},
  onClearSearch():void{if(this._timer)clearTimeout(this._timer);this.setData({search:'',appliedSearch:''});void this.load(true);},
  onSearch():void{this.setData({appliedSearch:this.data.search.trim()});void this.load(true);},
  onMore():void{if(this.data.nextCursor&&!this.data.loading&&!this.data.loadingMore)void this.load(false);},
  onCreate():void{if(this.data.tab==='teams')wx.navigateTo({url:'/pages/football/edit?kind=team&familyId='+this.data.familyId});else this.editPlayer();},
  onTeam(e:WechatMiniprogram.TouchEvent):void{wx.navigateTo({url:'/pages/football/edit?kind=team&familyId='+this.data.familyId+'&id='+encodeURIComponent(String(e.currentTarget.dataset.id))});},
  onPlayer(e:WechatMiniprogram.TouchEvent):void{const person=this.data.players.find(p=>p.id===String(e.currentTarget.dataset.id));if(person)this.editPlayer(person);},
  editPlayer(person?:FootballPerson):void{
    if(this.data.busy)return;
    wx.showModal({title:person?'编辑球员':'新建球员',editable:true,content:person?.displayName||'',placeholderText:'球员姓名',success:async r=>{
      if(!r.confirm||!r.content?.trim()||this.data.busy)return;
      this.setData({busy:true,error:''});
      try{await saveFootballPerson(this.data.familyId,r.content.trim(),person?.id,person?.version);await this.load(true);}
      catch(e){this.setData({error:(e as Error).message||'保存失败，请刷新后重试'});}
      finally{this.setData({busy:false});}
    }});
  },
  onDeleteTeam(e:WechatMiniprogram.TouchEvent):void{
    const team=this.data.teams.find(t=>t.id===String(e.currentTarget.dataset.id));if(!team||this.data.busy)return;
    wx.showModal({title:'删除球队',content:'删除“'+team.name+'”？它可能还被其他模块使用。',success:async r=>{
      if(!r.confirm||this.data.busy)return;this.setData({busy:true,error:''});
      try{
        for(const key of ['representativeTeamId','opponentTeamId'] as const){const page=await listMatches(this.data.familyId,{[key]:team.id,limit:1});if(page.items.length)throw Error('球队被比赛引用，请先修改相关比赛');}
        await deleteDomainRecord(this.data.familyId,'football-teams',team.id,team.version);await this.load(true);
      }catch(e){this.setData({error:(e as Error).message||'删除失败，请刷新后重试'});}finally{this.setData({busy:false});}
    }});
  },
  onDeletePlayer(e:WechatMiniprogram.TouchEvent):void{
    const person=this.data.players.find(p=>p.id===String(e.currentTarget.dataset.id));if(!person||this.data.busy)return;
    wx.showModal({title:'删除球员',content:'删除“'+person.displayName+'”？该档案可能还被其他模块使用。',confirmColor:'#c36363',success:async r=>{
      if(!r.confirm||this.data.busy)return;
      this.setData({busy:true,error:''});
      try{
        const [matches,performances]=await Promise.all([listMatches(this.data.familyId,{playerPersonId:person.id,limit:1}),listPerformances(this.data.familyId,undefined,undefined,person.id)]);
        if(matches.items.length||performances.items.length)throw Error('球员被比赛或表现记录引用，请先处理相关记录');
        await removeFootballPerson(this.data.familyId,person.id,person.version);await this.load(true);
      }catch(e){this.setData({error:(e as Error).message||'删除失败，请刷新后重试'});}
      finally{this.setData({busy:false});}
    }});
  },
  onActivities():void{wx.navigateTo({url:'/pages/domains/list?kind=activities'});},
});
