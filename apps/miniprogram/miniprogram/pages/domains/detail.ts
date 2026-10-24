import { currentFamilyStore,userStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import {
  getDomainRecord,listDomainPeople,listDomainRelations,performDomainAction,listHabitHistory,
  searchLinkedCandidates,linkDomainRecord,unlinkDomainRecord,createLinkedRecord,
  readableRelationTitle,DOMAIN_COPY,STATUS_COPY,type DomainRecord,type DomainRelation,type DomainKind,type DomainStatus,
  type PersonOption,type CheckInHistory,
} from '../../services/domains';

type Kind='activities'|'goals'|'habits';
type Tab='overview'|'calendar'|'tasks'|'related';
type RelationDisplay={id:string;title:string;category:string;modelKey:string;recordId:string};
const TITLES:Record<string,string>={task:'待办',event:'日程',day_record:'日子',activity:'活动',goal:'目标',habit:'习惯',anniversary:'纪念日',wish:'愿望'};
function actions(kind:Kind,status:DomainStatus):{key:string;title:string;danger:boolean}[]{
  if(status==='active')return kind==='goals'?
    [{key:'pause',title:'暂停',danger:false},{key:'achieve',title:'标记为已达成',danger:false},{key:'abandon',title:'放弃目标',danger:true}]:
    [{key:'pause',title:'暂停',danger:false},{key:'end',title:'结束习惯',danger:true}];
  if(status==='paused')return kind==='goals'?
    [{key:'resume',title:'恢复进行',danger:false},{key:'achieve',title:'标记为已达成',danger:false},{key:'abandon',title:'放弃目标',danger:true}]:
    [{key:'resume',title:'恢复进行',danger:false},{key:'end',title:'结束习惯',danger:true}];
  if((kind==='goals'&&(status==='achieved'||status==='abandoned'))||(kind==='habits'&&status==='ended'))
    return [{key:'reopen',title:'重新开始',danger:false}];
  return [];
}
function relationDisplays(relations:DomainRelation[],direction:'incoming'|'outgoing'):RelationDisplay[]{
  return relations.map(edge=>{
    const ref=direction==='outgoing'?edge.target:edge.source;
    return{id:edge.id,title:readableRelationTitle(edge,direction),category:TITLES[ref.modelKey]||'其他内容',
      modelKey:ref.modelKey,recordId:ref.recordId};
  });
}
Page({
  data:{
    kind:'activities' as Kind, familyId:'', recordId:'',loading:true,busy:false,error:'',record:null as DomainRecord|null,
    title:'',statusLabel:'',dateLabel:'',peopleLabel:'',icon:'',subjectOwner:false,canWrite:false,
    tabs:[] as {key:Tab;label:string}[],tab:'overview' as Tab,menuActions:[] as {key:string;title:string;danger:boolean}[],
    outgoing:[] as RelationDisplay[],incoming:[] as RelationDisplay[],nextOut:null as string|null,nextIn:null as string|null,
    relationLoading:false,relationError:'',checkIns:[] as CheckInHistory[],historyCursor:null as string|null,
    historyOpen:false,historyLoading:false,historyError:'',
    quickOpen:false,quickType:'task' as 'task'|'countdown',quickName:'',quickDate:'',
    linkOpen:false,linkType:'task',linkTypes:[
      {key:'task',label:'待办'},{key:'event',label:'日程'},{key:'day_record',label:'日子'},
      {key:'activity',label:'活动'},{key:'goal',label:'目标'},{key:'habit',label:'习惯'},
      {key:'anniversary',label:'纪念日'},{key:'wish',label:'愿望'},
    ],linkIndex:0,linkTerm:'',linkItems:[] as {id:string;name:string}[],
    candidateCursor:null as string|null,candidateLoading:false,moreCandidates:false,
  },
  _generation:0,
  async onLoad(opts:{kind?:string;familyId?:string;id?:string}):Promise<void>{
    const kind=['activities','goals','habits'].includes(opts.kind||'')?opts.kind as Kind:'activities';
    const familyId=opts.familyId||currentFamilyStore.value?.id||'',recordId=opts.id||'';
    this.setData({kind,familyId,recordId,title:DOMAIN_COPY[kind].title,
      tabs:kind==='activities'?[
        {key:'overview',label:'概览'},{key:'calendar',label:'日程'},{key:'tasks',label:'待办'},{key:'related',label:'更多'}]:
        kind==='goals'?[{key:'overview',label:'概览'},{key:'tasks',label:'行动计划'},{key:'related',label:'其他关联'}]:
        [{key:'overview',label:'概览'},{key:'related',label:'关联内容'}]});
    try{await ensureRuntimeReady();}catch{}
    await this.refresh();
  },
  onShow():void{if(this.data.recordId&&!this.data.loading)void this.refresh();},
  async refresh():Promise<void>{
    const {familyId,recordId,kind}=this.data;if(!familyId||!recordId)return;
    const generation=++this._generation;
    this.setData({loading:true,error:''});
    try{
      const [record,people]=await Promise.all([getDomainRecord(familyId,kind,recordId),listDomainPeople(familyId)]);
      if(generation!==this._generation)return;
      const ids=record.attendeePersonIds||record.subjectPersonIds||(record.subjectPersonId?[record.subjectPersonId]:[]);
      const dateLabel=[record.startDate,record.endDate||record.targetDate].filter(Boolean).join(' — ');
      const subjectOwner=Boolean(kind==='habits'&&people.find(p=>p.userId===userStore.value?.id)?.personId===record.subjectPersonId);
      const canWrite=(currentFamilyStore.value?.role as string)!=='viewer'&&(kind!=='habits'||subjectOwner);
      this.setData({record,title:record.name||DOMAIN_COPY[kind].title,
        icon:record.presentation?.icon?.type==='emoji'?record.presentation.icon.value:DOMAIN_COPY[kind].symbol,
        statusLabel:record.status?STATUS_COPY[record.status]:'',dateLabel,
        peopleLabel:ids.map(id=>people.find(p=>p.personId===id)?.displayName||'家庭成员').join('、'),
        subjectOwner,canWrite,menuActions:kind==='activities'||!canWrite||!record.status?[]:actions(kind,record.status)});
      await this.loadRelations(true);
    }catch(error){if(generation===this._generation)this.setData({error:(error as Error).message||'记录不存在或没有查看权限'});}
    finally{if(generation===this._generation)this.setData({loading:false});}
  },
  onRetry():void{void this.refresh();},
  noop():void{},
  onTab(e:WechatMiniprogram.TouchEvent):void{this.setData({tab:String(e.currentTarget.dataset.key) as Tab});},
  onEdit():void{
    if(!this.data.canWrite)return;
    const {kind,familyId,recordId}=this.data;
    wx.navigateTo({url:'/pages/domains/edit?kind='+kind+'&familyId='+familyId+'&id='+encodeURIComponent(recordId)});
  },
  onMenu():void{
    if(!this.data.canWrite)return;
    const opts=[{key:'edit',title:'编辑',danger:false},...this.data.menuActions];
    wx.showActionSheet({itemList:opts.map(a=>a.title),success:res=>{
      const action=opts[res.tapIndex];if(!action)return;
      if(action.key==='edit'){this.onEdit();return;}
      wx.showModal({title:action.title,content:'确定对“'+this.data.title+'”执行“'+action.title+'”吗？',
        confirmColor:action.danger?'#E85A5A':'#43A047',
        success:r=>{if(r.confirm)void this.runAction(action.key);}});
    }});
  },
  async runAction(action:string):Promise<void>{
    const record=this.data.record;if(!record||this.data.busy)return;
    this.setData({busy:true,error:''});
    try{
      await performDomainAction(this.data.familyId,this.data.kind as 'goals'|'habits',record.id,action,record.version);
      await this.refresh();
      wx.showToast({title:action==='check-in'?'打卡成功':'操作成功',icon:'success'});
    }catch(error){this.setData({error:(error as Error).message||'操作失败，请刷新后重试'});}
    finally{this.setData({busy:false});}
  },
  onCheckIn():void{
    const r=this.data.record;
    if(this.data.kind!=='habits'||!r||!this.data.subjectOwner||r.status!=='active'||
      r.computed?.checkIn?.checkedInToday||this.data.busy)return;
    void this.runAction('check-in');
  },
  async onToggleHistory():Promise<void>{
    this.setData({historyOpen:!this.data.historyOpen});
    if(this.data.historyOpen&&!this.data.checkIns.length)await this.loadHistory(false);
  },
  async loadHistory(more:boolean):Promise<void>{
    if(this.data.historyLoading)return;
    this.setData({historyLoading:true,historyError:''});
    try{
      const page=await listHabitHistory(this.data.familyId,this.data.recordId,more?this.data.historyCursor||undefined:undefined);
      this.setData({checkIns:more?[...this.data.checkIns,...page.items]:page.items,historyCursor:page.nextCursor});
    }catch(error){this.setData({historyError:(error as Error).message||'打卡历史加载失败'});}
    finally{this.setData({historyLoading:false});}
  },
  onMoreHistory():void{if(this.data.historyCursor)void this.loadHistory(true);},
  async loadRelations(reset:boolean,direction?:'outgoing'|'incoming'):Promise<void>{
    if(this.data.relationLoading)return;
    this.setData({relationLoading:true,relationError:''});
    try{
      for(const dir of (direction?[direction]:['outgoing','incoming'] as const)){
        const cursor=reset?undefined:(dir==='outgoing'?this.data.nextOut:this.data.nextIn)||undefined;
        const page=await listDomainRelations(this.data.familyId,this.data.kind,this.data.recordId,dir,cursor);
        const items=relationDisplays(page.items,dir);
        if(dir==='outgoing')this.setData({outgoing:reset?items:[...this.data.outgoing,...items],nextOut:page.nextCursor});
        else this.setData({incoming:reset?items:[...this.data.incoming,...items],nextIn:page.nextCursor});
      }
    }catch(error){this.setData({relationError:(error as Error).message||'关联内容加载失败'});}
    finally{this.setData({relationLoading:false});}
  },
  onMoreRelations(e:WechatMiniprogram.TouchEvent):void{
    const direction=String(e.currentTarget.dataset.direction) as 'incoming'|'outgoing';
    void this.loadRelations(false,direction);
  },
  onRelatedTap(e:WechatMiniprogram.TouchEvent):void{
    const model=String(e.currentTarget.dataset.model),id=String(e.currentTarget.dataset.id);
    const kind=({activity:'activities',goal:'goals',habit:'habits'} as Record<string,string>)[model];
    if(kind){wx.navigateTo({url:'/pages/domains/detail?kind='+kind+'&familyId='+this.data.familyId+'&id='+encodeURIComponent(id)});return;}
    const dest=({task:'/pages/tasks/detail',event:'/pages/events/detail',day_record:'/pages/days/detail',wish:'/pages/wishes/detail'} as Record<string,string>)[model];
    if(dest)wx.navigateTo({url:dest+'?familyId='+this.data.familyId+'&id='+encodeURIComponent(id)});
    else wx.showToast({title:'请从对应功能列表查看',icon:'none'});
  },
  onUnlink(e:WechatMiniprogram.TouchEvent):void{
    if(!this.data.canWrite)return;
    const edgeId=String(e.currentTarget.dataset.id||'');
    wx.showModal({title:'移除关联',content:'只移除关联，不会删除原有记录。确定继续？',
      success:async r=>{if(!r.confirm)return;
        try{await unlinkDomainRecord(this.data.familyId,this.data.kind,this.data.recordId,edgeId);
          await this.loadRelations(true);}catch(e){this.setData({relationError:(e as Error).message||'移除失败'});}
      }});
  },
  onOpenQuick(e:WechatMiniprogram.TouchEvent):void{
    if(!this.data.canWrite)return;
    const type=String(e.currentTarget.dataset.type||'task') as 'task'|'event'|'countdown';
    if(type==='event'){
      wx.navigateTo({url:'/pages/events/edit?familyId='+this.data.familyId+'&sourceKind='+this.data.kind+'&sourceId='+this.data.recordId});return;
    }
    this.setData({quickOpen:true,quickType:type,quickName:'',quickDate:''});
  },
  onQuickName(e:WechatMiniprogram.Input):void{this.setData({quickName:e.detail.value});},
  onQuickDate(e:WechatMiniprogram.PickerChange):void{this.setData({quickDate:String(e.detail.value)});},
  onQuickClose():void{this.setData({quickOpen:false});},
  async onQuickConfirm():Promise<void>{
    const d=this.data;if(d.busy||!d.quickName.trim()||(d.quickType==='countdown'&&!d.quickDate))return;
    this.setData({busy:true,error:''});
    try{
      const draft=d.quickType==='countdown'?{name:d.quickName.trim(),anchorDate:d.quickDate}:{name:d.quickName.trim()};
      await createLinkedRecord(d.familyId,d.kind,d.recordId,d.quickType,draft);
      this.setData({quickOpen:false});await this.loadRelations(true);
      wx.showToast({title:'创建并关联成功',icon:'success'});
    }catch(e){this.setData({error:(e as Error).message||'创建失败'});}
    finally{this.setData({busy:false});}
  },
  onOpenLink():void{if(this.data.canWrite)this.setData({linkOpen:true,linkItems:[],linkTerm:'',candidateCursor:null});},
  onLinkClose():void{this.setData({linkOpen:false});},
  onLinkType(e:WechatMiniprogram.PickerChange):void{
    const index=Number(e.detail.value);this.setData({linkIndex:index,linkType:this.data.linkTypes[index]?.key||'task',
      linkItems:[],candidateCursor:null});
  },
  onLinkTerm(e:WechatMiniprogram.Input):void{this.setData({linkTerm:e.detail.value});},
  async onLinkSearch(more=false):Promise<void>{
    const d=this.data;if(d.candidateLoading||d.linkTerm.trim().length<2)return;
    this.setData({candidateLoading:true});
    try{
      const page=await searchLinkedCandidates(d.familyId,d.kind,d.recordId,d.linkType,d.linkTerm.trim(),more?d.candidateCursor||undefined:undefined);
      this.setData({linkItems:more?[...d.linkItems,...page.items.map(x=>({id:x.id,name:x.name||'名称暂不可用'}))]:
        page.items.map(x=>({id:x.id,name:x.name||'名称暂不可用'})),candidateCursor:page.nextCursor});
    }catch(e){this.setData({relationError:(e as Error).message||'搜索失败'});}
    finally{this.setData({candidateLoading:false});}
  },
  onSearchLink():void{void this.onLinkSearch(false);},
  onMoreCandidates():void{void this.onLinkSearch(true);},
  async onLinkSelect(e:WechatMiniprogram.TouchEvent):Promise<void>{
    if(this.data.busy)return;
    const id=String(e.currentTarget.dataset.id||'');
    if(!id)return;
    this.setData({busy:true});
    try{
      await linkDomainRecord(this.data.familyId,this.data.kind,this.data.recordId,this.data.linkType,id);
      this.setData({linkOpen:false});await this.loadRelations(true);
      wx.showToast({title:'已关联',icon:'success'});
    }catch(err){this.setData({relationError:(err as Error).message||'关联失败'});}
    finally{this.setData({busy:false});}
  },
});
