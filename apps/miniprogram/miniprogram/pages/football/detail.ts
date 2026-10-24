import { currentFamilyStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import {
  getMatch,getTeam,getFootballPerson,listPerformances,savePerformance,removePerformance,
  readPerformanceSchema,validatePerformance,quickTypes,typeLabels,goalMethods,shotOutcomes,entryModes,availableTypes,
  type Match,type Performance,type FootballSchema,type FootballPerson,
} from '../../services/football';
type PerformanceView=Performance&{typeText:string;personName:string;detailText:string};
type FieldOption={key:string;name:string};
const statusError=(e:unknown)=>e instanceof Error?e.message:'操作失败';
Page({
  data:{
    familyId:'',matchId:'',match:null as Match|null,loading:true,error:'',busy:false,
    representative:'代表球队',opponent:'对方球队',competition:'',score:'— : —',
    people:[] as FootballPerson[],selectedPersonId:'',selectedPersonIndex:0,
    performances:[] as PerformanceView[],performanceCursor:null as string|null,performanceBusy:false,
    schema:null as FootballSchema|null,schemaError:'',quickTypes,allTypes:[] as FieldOption[],
    formOpen:false,performanceId:'',performanceVersion:0,performanceType:'',performanceTypeIndex:0,
    playerPersonId:'',playerIndex:0,notes:'',goalMethod:'',goalMethodIndex:0,goalMethods,
    shotOutcome:'',shotOutcomeIndex:0,shotOutcomes,minutesPlayed:'',position:'',entryMode:'',entryModeIndex:0,entryModes,
  },
  async onLoad(opts:{familyId?:string;id?:string}):Promise<void>{
    this.setData({familyId:opts.familyId||currentFamilyStore.value?.id||'',matchId:opts.id||''});
    try{await ensureRuntimeReady();}catch{}
    await this.refresh();
  },
  onShow():void{if(this.data.matchId&&!this.data.loading)void this.refresh();},
  async refresh():Promise<void>{
    const d=this.data;this.setData({loading:true,error:''});
    try{
      const [match,schema]=await Promise.all([
        getMatch(d.familyId,d.matchId),
        readPerformanceSchema(d.familyId).catch(e=>{this.setData({schemaError:statusError(e)});return null;}),
      ]);
      const ids=new Set(match.playerPersonIds||[]);
      const [a,b,comp,...people]=await Promise.all([
        getTeam(d.familyId,match.representativeTeamId).catch(()=>null),
        getTeam(d.familyId,match.opponentTeamId).catch(()=>null),
        match.competitionActivityId?import('../../services/domains').then(x=>x.getDomainRecord(d.familyId,'activities',match.competitionActivityId!)).catch(()=>null):Promise.resolve(null),
        ...[...ids].slice(0,50).map(id=>getFootballPerson(d.familyId,id).catch(()=>null)),
      ]);
      const roster=people.filter((p):p is FootballPerson=>Boolean(p));
      const current=roster.some(p=>p.id===this.data.selectedPersonId)?this.data.selectedPersonId:roster[0]?.id||'';
      const score=(typeof match.representativeTeamScore==='number'&&typeof match.opponentTeamScore==='number')
        ?match.representativeTeamScore+' : '+match.opponentTeamScore:'— : —';
      const types=schema?availableTypes(schema).map(key=>({key,name:typeLabels[key]||key})):[];
      this.setData({
        match,representative:a?.name||'代表球队',opponent:b?.name||'对方球队',competition:comp?.name||'',
        score,people:roster,selectedPersonId:current,selectedPersonIndex:Math.max(0,roster.findIndex(p=>p.id===current)),
        schema,allTypes:types,schemaError:schema? '':this.data.schemaError,
      });
      await this.loadPerformances(true);
    }catch(e){this.setData({error:statusError(e)});}
    finally{this.setData({loading:false});}
  },
  onRetry():void{void this.refresh();},
  async loadPerformances(reset:boolean):Promise<void>{
    if(this.data.performanceBusy)return;
    this.setData({performanceBusy:true});
    try{
      const result=await listPerformances(this.data.familyId,this.data.matchId,reset?undefined:this.data.performanceCursor||undefined);
      const names=new Map(this.data.people.map(p=>[p.id,p.displayName]));
      const format=(p:Performance):PerformanceView=>({
        ...p,typeText:typeLabels[p.performanceType]||p.performanceType,personName:names.get(p.playerPersonId)||'参赛球员',
        detailText:[p.minutesPlayed!==null&&p.minutesPlayed!==undefined?p.minutesPlayed+' 分钟':'',p.notes].filter(Boolean).join(' · '),
      });
      this.setData({performances:reset?result.items.map(format):[...this.data.performances,...result.items.map(format)],
        performanceCursor:result.nextCursor});
    }catch(e){this.setData({error:statusError(e)});}
    finally{this.setData({performanceBusy:false});}
  },
  onMorePerformance():void{if(this.data.performanceCursor)void this.loadPerformances(false);},
  onEditMatch():void{wx.navigateTo({url:'/pages/football/edit?kind=match&familyId='+this.data.familyId+'&id='+this.data.matchId});},
  onPlayer(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value),person=this.data.people[index];
    if(person)this.setData({selectedPersonId:person.id,selectedPersonIndex:index});
  },
  onOpenQuick(e:WechatMiniprogram.TouchEvent):void{this.openPerformance(String(e.currentTarget.dataset.type));},
  onChooseAllType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value);
    this.openPerformance(this.data.allTypes[index]?.key||'');
  },
  openPerformance(type:string,record?:Performance):void{
    if(!this.data.schema){wx.showToast({title:'表现模型暂不可用',icon:'none'});return;}
    if(!availableTypes(this.data.schema).includes(type)){wx.showToast({title:'该表现类型未发布',icon:'none'});return;}
    const playerId=record?.playerPersonId||this.data.selectedPersonId||this.data.people[0]?.id||'';
    if(!playerId){wx.showToast({title:'请先给比赛添加参赛球员',icon:'none'});return;}
    this.setData({formOpen:true,performanceType:type,performanceTypeIndex:Math.max(0,this.data.allTypes.findIndex(t=>t.key===type)),
      performanceId:record?.id||'',performanceVersion:record?.version||0,
      playerPersonId:playerId,playerIndex:Math.max(0,this.data.people.findIndex(p=>p.id===playerId)),
      notes:record?.notes||'',goalMethod:record?.goalMethod||'',shotOutcome:record?.shotOutcome||'',
      minutesPlayed:record?.minutesPlayed===undefined||record?.minutesPlayed===null?'':String(record.minutesPlayed),
      position:record?.position||'',entryMode:record?.entryMode||'',
      goalMethodIndex:Math.max(0,goalMethods.findIndex(o=>o.key===record?.goalMethod)),
      shotOutcomeIndex:Math.max(0,shotOutcomes.findIndex(o=>o.key===record?.shotOutcome)),
      entryModeIndex:Math.max(0,entryModes.findIndex(o=>o.key===record?.entryMode)),
    });
  },
  onPerformanceTap(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id||'');
    const record=this.data.performances.find(p=>p.id===id);
    if(record)this.openPerformance(record.performanceType,record);
  },
  onFormClose():void{this.setData({formOpen:false});},
  noop():void{},
  onFormValue(e:WechatMiniprogram.Input):void{
    const key=String(e.currentTarget.dataset.key||'');
    if(['notes','minutesPlayed','position'].includes(key))this.setData({[key]:e.detail.value});
  },
  onFormPicker(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const key=String(e.currentTarget.dataset.key||''),index=Number(e.detail.value);
    if(key==='player')this.setData({playerIndex:index,playerPersonId:this.data.people[index]?.id||''});
    if(key==='method')this.setData({goalMethodIndex:index,goalMethod:this.data.goalMethods[index]?.key||''});
    if(key==='outcome')this.setData({shotOutcomeIndex:index,shotOutcome:this.data.shotOutcomes[index]?.key||''});
    if(key==='entry')this.setData({entryModeIndex:index,entryMode:this.data.entryModes[index]?.key||''});
  },
  async onFormSave():Promise<void>{
    const d=this.data;if(!d.schema||d.busy)return;
    let payload:Record<string,unknown>;
    try{
      payload=validatePerformance({
        matchId:d.matchId,playerPersonId:d.playerPersonId,performanceType:d.performanceType,notes:d.notes,
        goalMethod:d.goalMethod,shotOutcome:d.shotOutcome,minutesPlayed:d.minutesPlayed,
        position:d.position,entryMode:d.entryMode,
      },d.schema);
    }catch(e){wx.showToast({title:statusError(e),icon:'none'});return;}
    this.setData({busy:true,error:''});
    try{
      await savePerformance(d.familyId,{...payload,...(d.performanceId?{version:d.performanceVersion}:{})},d.performanceId||undefined);
      this.setData({formOpen:false});await this.loadPerformances(true);
      wx.showToast({title:'记录成功',icon:'success'});
    }catch(e){this.setData({error:statusError(e)});}
    finally{this.setData({busy:false});}
  },
  onFormDelete():void{
    if(!this.data.performanceId)return;
    wx.showModal({title:'删除表现',content:'只删除这一条表现记录，确定继续？',confirmColor:'#E85A5A',
      success:async r=>{
        if(!r.confirm)return;
        this.setData({busy:true});
        try{
          await removePerformance(this.data.familyId,this.data.performanceId,this.data.performanceVersion);
          this.setData({formOpen:false});await this.loadPerformances(true);
        }catch(e){this.setData({error:statusError(e)});}
        finally{this.setData({busy:false});}
      }});
  },
});