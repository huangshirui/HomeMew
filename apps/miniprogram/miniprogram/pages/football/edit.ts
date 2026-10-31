import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { markRefreshDirty } from '../../services/refresh-policy';
import { currentFamilyStore,userStore } from '../../stores/index';
import { deleteDomainRecord,listDomainPeople } from '../../services/domains';
import { getMatch,getTeam,saveTeam,saveMatch,removeMatch,listMatches,listFootballPeople,saveFootballPerson,getFootballPerson,
  type FootballPerson } from '../../services/football';
import { originalIconState,prepareRecordIcon,pickerChangeState,type RecordIconPickerChange } from '../../utils/record-icon-edit';
import { downloadRecordIconImage } from '../../services/record-icons';

const now=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
Page({
  data:{
    userId:'',familyId:'',kind:'match' as 'match'|'team',recordId:'',loading:true,saving:false,error:'',version:0,
    name:'',description:'',matchDate:now(),matchType:'official',matchTypeIndex:0,matchTypes:[
      {key:'official',name:'正式比赛'},{key:'friendly',name:'友谊赛'},
    ],representativeTeamId:'',opponentTeamId:'',competitionActivityId:'',
    representativeTeamScore:'',opponentTeamScore:'',notes:'',
    people:[] as (FootballPerson&{selected:boolean})[],playerPersonIds:[] as string[],teamMemberPersonIds:[] as string[],
    personCanCreate:false,personSearch:'',peopleCursor:null as string|null,
    iconEmoji:'',iconImagePath:'',iconFileId:'',iconTouched:false,
  },
  async onLoad(opts:{familyId?:string;kind?:string;id?:string}):Promise<void>{
    const kind=opts.kind==='team'?'team':'match',familyId=opts.familyId||currentFamilyStore.value?.id||'';
    this.setData({kind,familyId,recordId:opts.id||'',loading:true,error:''});
    try{
      await ensureRuntimeReady();this.setData({userId:userStore.value?.id||''});
      const [record,family]=await Promise.all([
        opts.id?(kind==='team'?getTeam(familyId,opts.id):getMatch(familyId,opts.id)):Promise.resolve(null),
        listDomainPeople(familyId),
      ]);
      const ids=kind==='team'?(record?.memberPersonIds||[]):(record?.playerPersonIds||[]);
      const peopleMap=new Map<string,FootballPerson>();
      const missing=[...new Set([...family.map(p=>p.personId),...ids])].filter(id=>!peopleMap.has(id));
      await Promise.all(missing.slice(0,50).map(async id=>{const person=await getFootballPerson(familyId,id);peopleMap.set(id,person);}));
      const familyIds=new Set(family.map(p=>p.personId));
      const people=[...peopleMap.values()].sort((a,b)=>Number(familyIds.has(b.id))-Number(familyIds.has(a.id))).map(p=>({...p,selected:ids.includes(p.id)}));
      const representativeTeamId=record?.representativeTeamId||'';
      const opponentTeamId=record?.opponentTeamId||'';
      const competitionActivityId=record?.competitionActivityId||'';
      this.setData({loading:false,people,peopleCursor:null,version:record?.version||0,
        name:record?.name||'',description:record?.description||'',
        matchDate:record?.matchDate||now(),matchType:record?.matchType||'official',
        matchTypeIndex:record?.matchType==='friendly'?1:0,
        representativeTeamId,opponentTeamId,
        competitionActivityId,
        representativeTeamScore:record?.representativeTeamScore===null||record?.representativeTeamScore===undefined?'':String(record.representativeTeamScore),
        opponentTeamScore:record?.opponentTeamScore===null||record?.opponentTeamScore===undefined?'':String(record.opponentTeamScore),
        notes:record?.notes||'',playerPersonIds:kind==='match'?ids:[],
        teamMemberPersonIds:kind==='team'?ids:[],...originalIconState(record?.presentation?.icon),
      });
      if(kind==='team'&&record?.presentation?.icon?.type==='image'){
        const fileId=record.presentation.icon.fileId;
        void downloadRecordIconImage(familyId,'person_group',record.id,fileId).then(iconImagePath=>{
          if(!this.data.iconTouched)this.setData({iconImagePath});
        }).catch(()=>{});
      }
    }catch(e){this.setData({loading:false,error:(e as Error).message||'加载失败'});}
  },
  onReferenceSelect(e:WechatMiniprogram.CustomEvent<{id:string;name:string}>):void{
    const key=String(e.currentTarget.dataset.key);if(!['representativeTeamId','opponentTeamId','competitionActivityId'].includes(key))return;
    this.setData({[key]:e.detail.id});
  },
  onValue(e:WechatMiniprogram.Input):void{
    const key=String(e.currentTarget.dataset.name||'');
    if(['name','description','notes','representativeTeamScore','opponentTeamScore','personSearch'].includes(key))
      this.setData({[key]:e.detail.value,...(key==='personSearch'?{personCanCreate:false}:{})});
  },
  onDate(e:WechatMiniprogram.CustomEvent<{value:string}>):void{this.setData({matchDate:String(e.detail.value)});},
  onMatchType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const i=Number(e.detail.value);this.setData({matchTypeIndex:i,matchType:this.data.matchTypes[i]?.key||'official'});
  },
  onPersonToggle(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id);
    const name=this.data.kind==='team'?'teamMemberPersonIds':'playerPersonIds';
    const ids=this.data[name],next=ids.includes(id)?ids.filter(p=>p!==id):[...ids,id];
    this.setData({[name]:next,people:this.data.people.map(p=>({...p,selected:next.includes(p.id)}))});
  },
  async onPeopleSearch():Promise<void>{
    try{
      const term=this.data.personSearch.trim();if(term.length<2){this.setData({error:'请输入至少两个字搜索球员',personCanCreate:false});return;}
      const page=await listFootballPeople(this.data.familyId,term);
      if(term!==this.data.personSearch.trim())return;
      const selected=this.data.kind==='team'?this.data.teamMemberPersonIds:this.data.playerPersonIds;
      const people=[...new Map([...this.data.people.filter(p=>selected.includes(p.id)),...page.items.map(p=>({...p,selected:selected.includes(p.id)}))].map(p=>[p.id,p])).values()];
      this.setData({people,peopleCursor:page.nextCursor,personCanCreate:!page.items.length&&!page.nextCursor});
    }catch(e){this.setData({error:(e as Error).message||'查询球员失败'});}
  },
  onAddPerson():void{
    const name=this.data.personSearch.trim();if(!this.data.personCanCreate||name.length<2||this.data.saving)return;
    wx.showModal({title:'新增球员',editable:true,placeholderText:'球员姓名',content:name,
      success:async r=>{
        if(!r.confirm||!r.content?.trim()||this.data.saving)return;
        this.setData({saving:true,error:''});
        try{
          const person=await saveFootballPerson(this.data.familyId,r.content.trim());
          markRefreshDirty('football');
          const key=this.data.kind==='team'?'teamMemberPersonIds':'playerPersonIds';
          this.setData({people:[{...person,selected:true},...this.data.people],[key]:[...new Set([...this.data[key],person.id])],personSearch:'',personCanCreate:false});
        }catch(e){this.setData({error:(e as Error).message||'添加失败'});}finally{this.setData({saving:false});}
      }});
  },
  async onMorePeople():Promise<void>{
    if(!this.data.peopleCursor)return;
    try{
      const p=await listFootballPeople(this.data.familyId,this.data.personSearch||undefined,this.data.peopleCursor);
      const selected=this.data.kind==='team'?this.data.teamMemberPersonIds:this.data.playerPersonIds;
      this.setData({people:[...this.data.people,...p.items.map(x=>({...x,selected:selected.includes(x.id)}))],
        peopleCursor:p.nextCursor});
    }catch(e){this.setData({error:(e as Error).message||'加载更多球员失败'});}
  },
  onRecordIconChange(e:WechatMiniprogram.CustomEvent<RecordIconPickerChange>):void{this.setData(pickerChangeState(e.detail));},
  async onSubmit():Promise<void>{
    const d=this.data;if(d.saving)return;
    let payload:Record<string,unknown>;
    if(d.kind==='team'){
      if(!d.name.trim()){wx.showToast({title:'请输入球队名称',icon:'none'});return;}
      payload={name:d.name.trim(),description:d.description.trim()||null,memberPersonIds:d.teamMemberPersonIds};
    }else{
      if(!d.matchDate||!d.representativeTeamId||!d.opponentTeamId||d.representativeTeamId===d.opponentTeamId){
        wx.showToast({title:'请选择日期和两支不同的球队',icon:'none'});return;
      }
      if((d.representativeTeamScore==='')!==(d.opponentTeamScore==='')){
        wx.showToast({title:'比分需同时填写或留空',icon:'none'});return;
      }
      const score=(v:string)=>{if(!v)return null;const n=Number(v);if(!Number.isInteger(n)||n<0)throw Error('比分必须是非负整数');return n;};
      try{
        payload={matchDate:d.matchDate,matchType:d.matchType,representativeTeamId:d.representativeTeamId,
          opponentTeamId:d.opponentTeamId,competitionActivityId:d.competitionActivityId||null,
          representativeTeamScore:score(d.representativeTeamScore),opponentTeamScore:score(d.opponentTeamScore),
          playerPersonIds:d.playerPersonIds,notes:d.notes.trim()||null};
      }catch(e){wx.showToast({title:(e as Error).message,icon:'none'});return;}
    }
    this.setData({saving:true,error:''});
    try{
      if(d.kind==='team'){
        const icon=await prepareRecordIcon(d.familyId,'person_group',d.recordId?'edit':'create',d);
        if(icon)payload.presentation=icon;
      }
      const saved=d.kind==='team'?await saveTeam(d.familyId,{...payload,...(d.recordId?{version:d.version}:{})},d.recordId||undefined):
        await saveMatch(d.familyId,{...payload,...(d.recordId?{version:d.version}:{})},d.recordId||undefined);
      markRefreshDirty('football');
      wx.showToast({title:'已保存',icon:'success'});
      if(d.kind==='match'&&!d.recordId&&saved.id)
        wx.redirectTo({url:'/pages/football/detail?familyId='+d.familyId+'&id='+encodeURIComponent(saved.id)});
      else wx.navigateBack();
    }catch(e){this.setData({error:(e as Error).message||'保存失败'});}
    finally{this.setData({saving:false});}
  },
  onDelete():void{
    const d=this.data;if(!d.recordId||d.saving)return;
    wx.showModal({title:'确认删除',content:d.kind==='team'?'删除这个球队？它可能还被其他模块使用。':'删除这场比赛？请先确认其表现记录已处理。',confirmColor:'#E85A5A',
      success:async r=>{
        if(!r.confirm||this.data.saving)return;
        this.setData({saving:true,error:''});
        try{
          if(d.kind==='team'){
            for(const field of ['representativeTeamId','opponentTeamId'] as const){
              const page=await listMatches(d.familyId,{[field]:d.recordId,limit:1});
              if(page.items.length)throw Error('球队被比赛引用，请先修改相关比赛');
            }
            await deleteDomainRecord(d.familyId,'football-teams',d.recordId,d.version);markRefreshDirty('football');wx.navigateBack();
          }else{await removeMatch(d.familyId,d.recordId,d.version);markRefreshDirty('football');wx.redirectTo({url:'/pages/football/list'});}
        }
        catch(e){this.setData({error:(e as Error).message||'删除失败'});}finally{this.setData({saving:false});}
      }});
  },
});