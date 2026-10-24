import { currentFamilyStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { listDomainPeople, listDomainRecords, DOMAIN_COPY, STATUS_COPY, type DomainKind, type DomainRecord, type DomainStatus, type PersonOption } from '../../services/domains';
import { formatInstantInTimeZone } from '../../utils/index';

type Kind = 'activities' | 'goals' | 'habits' | 'anniversaries';
type Display = DomainRecord & { icon: string; people: string; dates: string; statusLabel: string };
const KINDS: Kind[] = ['activities','goals','habits','anniversaries'];
function localToday(timezone: string): string {
  try { return formatInstantInTimeZone(new Date().toISOString(),timezone || 'Asia/Shanghai').date; }
  catch { return new Date().toISOString().slice(0,10); }
}
function formatted(record:DomainRecord,people:PersonOption[],kind:Kind):Display {
  const ids = record.attendeePersonIds || record.subjectPersonIds || record.personIds ||
    (record.subjectPersonId ? [record.subjectPersonId] : []);
  const names = ids.map(id => people.find(person=>person.personId===id)?.displayName || '家庭成员');
  const dates = kind==='anniversaries' ? [record.year ? String(record.year)+'年' : '每年',record.month+'月',record.day+'日'].join(' ')
    : [record.startDate,record.endDate || record.targetDate].filter(Boolean).join(' — ');
  return { ...record, icon: record.presentation?.icon?.type==='emoji' ? record.presentation.icon.value : DOMAIN_COPY[kind].symbol,
    people:names.join('、'),dates,statusLabel:record.status ? STATUS_COPY[record.status] : '' };
}
Page({
  data:{
    kind:'activities' as Kind,title:'活动',familyId:'',loading:true,loadingMore:false,error:'',
    records:[] as Display[],nextCursor:null as string|null,noFamily:false,
    filters:[] as {key:string;label:string}[],filter:'current',searchOpen:false,search:'',appliedSearch:'',
    people:[] as PersonOption[],personId:'',personOptions:[] as {id:string;label:string}[],selectedPersonIndex:0,
  },
  _generation:0,
  onLoad(options:{kind?:string}):void {
    const kind=KINDS.includes(options.kind as Kind) ? options.kind as Kind : 'activities';
    const filters = kind==='activities' ? [
      {key:'current',label:'当前'},{key:'upcoming',label:'即将开始'},{key:'past',label:'已结束'},{key:'all',label:'全部'}]
      : kind==='anniversaries' ? [] : kind==='goals' ? [
        {key:'active',label:'进行中'},{key:'paused',label:'已暂停'},{key:'achieved',label:'已达成'},{key:'abandoned',label:'已放弃'}]
        : [{key:'active',label:'进行中'},{key:'paused',label:'已暂停'},{key:'ended',label:'已结束'}];
    this.setData({kind,title:DOMAIN_COPY[kind].title,filters,filter:kind==='activities'?'current':'active'});
  },
  async onShow():Promise<void> {
    try { await ensureRuntimeReady(); } catch {}
    const familyId=currentFamilyStore.value?.id||'';
    if (!familyId) { this.setData({familyId:'',records:[],noFamily:true,loading:false});return; }
    this.setData({familyId,noFamily:false,records:[],nextCursor:null});
    await this.load(true);
  },
  async load(reset:boolean):Promise<void> {
    const familyId=this.data.familyId,kind=this.data.kind,cursor=reset?undefined:this.data.nextCursor || undefined;
    if(!familyId || (!reset && !cursor))return;
    const generation=++this._generation;
    this.setData({loading:reset,loadingMore:!reset,error:reset?'':this.data.error});
    try {
      const members=reset ? await listDomainPeople(familyId) : this.data.people;
      const now=localToday(currentFamilyStore.value?.timezone||'Asia/Shanghai');
      const page=await listDomainRecords(familyId,kind,{
        limit:40,cursor,q:this.data.appliedSearch,
        ...(kind==='activities'?{period:this.data.filter as 'current',today:now,personId:this.data.personId}:
          kind==='goals'||kind==='habits'?{status:this.data.filter as DomainStatus}:{}),
      });
      if(generation!==this._generation || this.data.familyId!==familyId)return;
      const items=page.items.map(record=>formatted(record,members,kind));
      const records=reset?items:[...this.data.records,...items.filter(x=>!this.data.records.some(prev=>prev.id===x.id))];
      this.setData({people:members,personOptions:[{id:'',label:'全部成员'},...members.map(p=>({id:p.personId,label:p.displayName}))],
        records,nextCursor:page.nextCursor,error:''});
    }catch(error:unknown){if(generation===this._generation)this.setData({error:(error as Error).message||'加载失败'});}
    finally{if(generation===this._generation)this.setData({loading:false,loadingMore:false});}
  },
  onPullDownRefresh():void{void this.load(true).then(()=>wx.stopPullDownRefresh(),()=>wx.stopPullDownRefresh());},
  onReachBottom():void{if(!this.data.loadingMore && !this.data.loading)this.load(false);},
  onLoadMore():void{this.onReachBottom();},
  onFilterTap(e:WechatMiniprogram.TouchEvent):void{this.setData({filter:String(e.currentTarget.dataset.key),records:[],nextCursor:null});this.load(true);},
  onToggleSearch():void{this.setData({searchOpen:!this.data.searchOpen});},
  onSearchInput(e:WechatMiniprogram.Input):void{this.setData({search:e.detail.value});},
  onApplySearch():void{this.setData({appliedSearch:this.data.search.trim()});this.load(true);},
  onClearSearch():void{this.setData({search:'',appliedSearch:'',personId:'',selectedPersonIndex:0});this.load(true);},
  onPersonChange(e:WechatMiniprogram.PickerChange):void{
    const index=Number(e.detail.value);this.setData({selectedPersonIndex:index,personId:this.data.personOptions[index]?.id||''});this.load(true);
  },
  onCreate():void{wx.navigateTo({url:'/pages/domains/edit?kind='+this.data.kind+'&familyId='+this.data.familyId});},
  onRecordTap(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id||'');
    if(!id)return;
    const path=this.data.kind==='anniversaries'?'edit':'detail';
    wx.navigateTo({url:'/pages/domains/'+path+'?kind='+this.data.kind+'&familyId='+this.data.familyId+'&id='+encodeURIComponent(id)});
  },
  onFamilySetup():void{wx.switchTab({url:'/pages/home/home'});},
});
