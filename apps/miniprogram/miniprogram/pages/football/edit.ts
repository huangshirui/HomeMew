import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { currentFamilyStore } from '../../stores/index';
import { listDomainRecords,getDomainRecord,type DomainRecord } from '../../services/domains';
import { getMatch,getTeam,saveTeam,saveMatch,removeMatch,listTeams,listFootballPeople,saveFootballPerson,
  type FootballPerson,type Match } from '../../services/football';
import { originalIconState,prepareRecordIcon,pickerChangeState,type RecordIconPickerChange } from '../../utils/record-icon-edit';
import { downloadRecordIconImage } from '../../services/record-icons';

type Label={id:string;name:string};
const now=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
Page({
  data:{
    familyId:'',kind:'match' as 'match'|'team',recordId:'',loading:true,saving:false,error:'',version:0,
    name:'',description:'',matchDate:now(),matchType:'official',matchTypeIndex:0,matchTypes:[
      {key:'official',name:'正式比赛'},{key:'friendly',name:'友谊赛'},
    ],teams:[] as Label[],representativeTeamId:'',opponentTeamId:'',representativeTeamIndex:0,opponentTeamIndex:0,
    competition:[] as Label[],competitionActivityId:'',competitionIndex:0,
    representativeTeamScore:'',opponentTeamScore:'',notes:'',
    people:[] as (FootballPerson&{selected:boolean})[],playerPersonIds:[] as string[],teamMemberPersonIds:[] as string[],
    personSearch:'',peopleCursor:null as string|null,teamSearch:'',teamCursor:null as string|null,
    iconEmoji:'',iconImagePath:'',iconFileId:'',iconTouched:false,
  },
  async onLoad(opts:{familyId?:string;kind?:string;id?:string}):Promise<void>{
    const kind=opts.kind==='team'?'team':'match',familyId=opts.familyId||currentFamilyStore.value?.id||'';
    this.setData({kind,familyId,recordId:opts.id||'',loading:true,error:''});
    try{
      await ensureRuntimeReady();
      const [record,peoplePage,teamsPage,activityPage]=await Promise.all([
        opts.id?(kind==='team'?getTeam(familyId,opts.id):getMatch(familyId,opts.id)):Promise.resolve(null),
        listFootballPeople(familyId),
        listTeams(familyId),
        listDomainRecords(familyId,'activities',{period:'all',limit:50}),
      ]);
      const ids=kind==='team'?(record?.memberPersonIds||[]):(record?.playerPersonIds||[]);
      const people=peoplePage.items.map(p=>({...p,selected:ids.includes(p.id)}));
      const teams=teamsPage.items.map(t=>({id:t.id,name:t.name||'未命名球队'}));
      const competition=[{id:'',name:'无指定赛事'},...activityPage.items.map(a=>({id:a.id,name:a.name||'未命名活动'}))];
      const representativeTeamId=record?.representativeTeamId||teams[0]?.id||'';
      const opponentTeamId=record?.opponentTeamId||teams[1]?.id||'';
      const competitionActivityId=record?.competitionActivityId||'';
      this.setData({loading:false,people,peopleCursor:peoplePage.nextCursor,
        teams,teamCursor:teamsPage.nextCursor,competition,version:record?.version||0,
        name:record?.name||'',description:record?.description||'',
        matchDate:record?.matchDate||now(),matchType:record?.matchType||'official',
        matchTypeIndex:record?.matchType==='friendly'?1:0,
        representativeTeamId,opponentTeamId,
        representativeTeamIndex:Math.max(0,teams.findIndex(t=>t.id===representativeTeamId)),
        opponentTeamIndex:Math.max(0,teams.findIndex(t=>t.id===opponentTeamId)),
        competitionActivityId,competitionIndex:Math.max(0,competition.findIndex(t=>t.id===competitionActivityId)),
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
  onValue(e:WechatMiniprogram.Input):void{
    const key=String(e.currentTarget.dataset.name||'');
    if(['name','description','notes','representativeTeamScore','opponentTeamScore','personSearch','teamSearch'].includes(key))
      this.setData({[key]:e.detail.value});
  },
  onDate(e:WechatMiniprogram.CustomEvent<{value:string}>):void{this.setData({matchDate:String(e.detail.value)});},
  onMatchType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const i=Number(e.detail.value);this.setData({matchTypeIndex:i,matchType:this.data.matchTypes[i]?.key||'official'});
  },
  onTeamPicker(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const key=String(e.currentTarget.dataset.key),index=Number(e.detail.value),team=this.data.teams[index];
    if(!team)return;
    if(key==='representative'){this.setData({representativeTeamIndex:index,representativeTeamId:team.id});}
    else{this.setData({opponentTeamIndex:index,opponentTeamId:team.id});}
  },
  onCompetition(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value);
    this.setData({competitionIndex:index,competitionActivityId:this.data.competition[index]?.id||''});
  },
  onPersonToggle(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id);
    const name=this.data.kind==='team'?'teamMemberPersonIds':'playerPersonIds';
    const ids=this.data[name],next=ids.includes(id)?ids.filter(p=>p!==id):[...ids,id];
    this.setData({[name]:next,people:this.data.people.map(p=>({...p,selected:next.includes(p.id)}))});
  },
  async onPeopleSearch():Promise<void>{
    try{
      const page=await listFootballPeople(this.data.familyId,this.data.personSearch.trim()||undefined);
      const selected=this.data.kind==='team'?this.data.teamMemberPersonIds:this.data.playerPersonIds;
      this.setData({people:page.items.map(p=>({...p,selected:selected.includes(p.id)})),peopleCursor:page.nextCursor});
    }catch(e){this.setData({error:(e as Error).message||'查询球员失败'});}
  },
  onAddPerson():void{
    const name=this.data.personSearch.trim();
    wx.showModal({title:'新增球员',editable:true,placeholderText:'球员姓名',content:name,
      success:async r=>{
        if(!r.confirm||!r.content?.trim())return;
        try{
          const person=await saveFootballPerson(this.data.familyId,r.content.trim());
          this.setData({people:[{...person,selected:false},...this.data.people],personSearch:''});
        }catch(e){this.setData({error:(e as Error).message||'添加失败'});}
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
  async onTeamSearch():Promise<void>{
    try{
      const page=await listTeams(this.data.familyId,undefined,this.data.teamSearch.trim()||undefined);
      const selected=new Set([this.data.representativeTeamId,this.data.opponentTeamId]);
      const teams=[...page.items.map(t=>({id:t.id,name:t.name||'未命名球队'}))];
      const ids=new Set(teams.map(t=>t.id));
      for(const id of selected)if(id&&!ids.has(id)){
        const original=this.data.teams.find(t=>t.id===id);
        if(original)teams.push(original);
      }
      this.setData({teams,teamCursor:page.nextCursor,
        representativeTeamIndex:Math.max(0,teams.findIndex(t=>t.id===this.data.representativeTeamId)),
        opponentTeamIndex:Math.max(0,teams.findIndex(t=>t.id===this.data.opponentTeamId))});
    }catch(e){this.setData({error:(e as Error).message||'球队搜索失败'});}
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
      wx.showToast({title:'已保存',icon:'success'});
      if(d.kind==='match'&&!d.recordId&&saved.id)
        wx.redirectTo({url:'/pages/football/detail?familyId='+d.familyId+'&id='+encodeURIComponent(saved.id)});
      else wx.navigateBack();
    }catch(e){this.setData({error:(e as Error).message||'保存失败'});}
    finally{this.setData({saving:false});}
  },
  onDelete():void{
    const d=this.data;if(!d.recordId||d.saving)return;
    if(d.kind==='team'){wx.showToast({title:'请在 Web 中核对引用关系后删除球队',icon:'none'});return;}
    wx.showModal({title:'确认删除',content:'删除这场比赛？请先确认其表现记录已处理。',confirmColor:'#E85A5A',
      success:async r=>{
        if(!r.confirm)return;
        try{await removeMatch(d.familyId,d.recordId,d.version);wx.redirectTo({url:'/pages/football/list'});}
        catch(e){this.setData({error:(e as Error).message||'删除失败'});}
      }});
  },
});