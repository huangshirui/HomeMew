import { currentFamilyStore,userStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import type { DomainIcon } from '../../services/domains';
import { rememberFootballPerson } from '../../utils/football-scope';
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
    representativeIcon:null as DomainIcon|null,opponentIcon:null as DomainIcon|null,representative:'代表球队',opponent:'对方球队',competition:'',score:'— : —',
    people:[] as FootballPerson[],selectedPersonId:'',selectedPersonIndex:0,
    performances:[] as PerformanceView[],performanceCursor:null as string|null,performanceBusy:false,performancesLoaded:false,
    schema:null as FootballSchema|null,schemaError:'',quickTypes:quickTypes.map(t=>({...t,count:0})),allTypes:[] as FieldOption[],
    eventsError:'',formError:'',appearanceAvailable:false,hasShotOutcome:false,moreOpen:false,moreTypes:[] as FieldOption[],
    formOpen:false,performanceId:'',performanceVersion:0,performanceType:'',performanceTypeIndex:0,
    playerPersonId:'',playerIndex:0,notes:'',goalMethod:'',goalMethodIndex:0,goalMethods,
    shotOutcome:'',shotOutcomeIndex:0,shotOutcomes,minutesPlayed:'',position:'',entryMode:'',entryModeIndex:0,entryModes,
  },
  _eventsGeneration:0,
  _refreshing:false,
  onUnload():void{this._eventsGeneration++;},
  async onLoad(opts:{familyId?:string;id?:string;personId?:string}):Promise<void>{
    this.setData({familyId:opts.familyId||currentFamilyStore.value?.id||'',matchId:opts.id||'',selectedPersonId:opts.personId||''});
    try{await ensureRuntimeReady();}catch{}
    await this.refresh();
  },
  onShow():void{if(this.data.matchId&&!this.data.loading)void this.refresh();},
  async refresh():Promise<void>{
    if(this._refreshing)return;
    this._refreshing=true;
    const d=this.data;this.setData({loading:!d.match,error:''});
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
        match,representativeIcon:a?.presentation?.icon||null,opponentIcon:b?.presentation?.icon||null,representative:a?.name||'代表球队',opponent:b?.name||'对方球队',competition:comp?.name||'',
        score,people:roster,selectedPersonId:current,selectedPersonIndex:Math.max(0,roster.findIndex(p=>p.id===current)),
        schema,allTypes:types,schemaError:schema? '':this.data.schemaError,
        moreTypes:types.filter(t=>t.key!=='appearance'&&!quickTypes.some(q=>q.key===t.key)),
        appearanceAvailable:types.some(t=>t.key==='appearance'),
        hasShotOutcome:Boolean(schema?.fields.some(f=>f.key==='shotOutcome')),
        goalMethods:[{key:'',name:'未填写'},...(schema?.fields.find(f=>f.key==='goalMethod')?.values||[]).map(key=>({key,name:goalMethods.find(o=>o.key===key)?.name||key}))],
        shotOutcomes:[{key:'',name:'未填写'},...(schema?.fields.find(f=>f.key==='shotOutcome')?.values||[]).map(key=>({key,name:shotOutcomes.find(o=>o.key===key)?.name||key}))],
        entryModes:[{key:'',name:'未填写'},...(schema?.fields.find(f=>f.key==='entryMode')?.values||[]).map(key=>({key,name:entryModes.find(o=>o.key===key)?.name||key}))],
      });
      await this.loadPerformances(true);
    }catch(e){this.setData({error:statusError(e)});}
    finally{this._refreshing=false;this.setData({loading:false});}
  },
  onRetry():void{void this.refresh();},
  async loadPerformances(_reset:boolean):Promise<void>{
    const generation=++this._eventsGeneration;
    const personId=this.data.selectedPersonId;
    if(!personId){this.setData({performances:[],eventsError:'请先编辑比赛，添加参赛球员'});return;}
    this.setData({performanceBusy:!this.data.performancesLoaded,eventsError:''});
    try{
      const items:Performance[]=[];let cursor:string|undefined;
      for(let page=0;page<8;page++){
        const result=await listPerformances(this.data.familyId,this.data.matchId,cursor,personId);
        items.push(...result.items);cursor=result.nextCursor||undefined;if(!cursor)break;
      }
      if(cursor)throw Error('本场表现超过 800 条，暂时无法显示完整计数');
      if(generation!==this._eventsGeneration)return;
      const names=new Map(this.data.people.map(p=>[p.id,p.displayName]));
      const format=(p:Performance):PerformanceView=>({
        ...p,typeText:typeLabels[p.performanceType]||p.performanceType,personName:names.get(p.playerPersonId)||'参赛球员',
        detailText:[
          p.performanceType==='goal'?this.data.goalMethods.find(o=>o.key===p.goalMethod)?.name||p.goalMethod:'',
          p.performanceType==='shot'?this.data.shotOutcomes.find(o=>o.key===p.shotOutcome)?.name||p.shotOutcome:'',
          p.performanceType==='appearance'?[p.minutesPlayed!==null&&p.minutesPlayed!==undefined?p.minutesPlayed+' 分钟':'时长可补充',p.position,this.data.entryModes.find(o=>o.key===p.entryMode)?.name||p.entryMode].filter(Boolean).join(' · '):'',p.notes
        ].filter(Boolean).join(' · '),
      });
      this.setData({performances:items.map(format),performanceCursor:null,performancesLoaded:true,
        quickTypes:quickTypes.filter(t=>!this.data.schema||availableTypes(this.data.schema).includes(t.key)).map(t=>({...t,count:items.filter(p=>(t.key==='shot'?['goal','shot']:t.key==='key_pass'?['assist','key_pass']:[t.key]).includes(p.performanceType)).length}))});
    }catch(e){if(generation===this._eventsGeneration)this.setData({eventsError:statusError(e)});}
    finally{if(generation===this._eventsGeneration)this.setData({performanceBusy:false});}
  },
  onMorePerformance():void{if(this.data.performanceCursor)void this.loadPerformances(false);},
  onEditMatch():void{wx.navigateTo({url:'/pages/football/edit?kind=match&familyId='+this.data.familyId+'&id='+this.data.matchId});},
  onPlayer(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    const index=Number(e.detail.value),person=this.data.people[index];
    if(person){rememberFootballPerson(userStore.value?.id||'',this.data.familyId,person.id);this.setData({selectedPersonId:person.id,selectedPersonIndex:index,performances:[],performancesLoaded:false});void this.loadPerformances(true);}
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
    this.setData({formError:'',formOpen:true,performanceType:type,performanceTypeIndex:Math.max(0,this.data.allTypes.findIndex(t=>t.key===type)),
      performanceId:record?.id||'',performanceVersion:record?.version||0,
      playerPersonId:playerId,playerIndex:Math.max(0,this.data.people.findIndex(p=>p.id===playerId)),
      notes:record?.notes||'',goalMethod:record?.goalMethod||'',shotOutcome:record?.shotOutcome||'',
      minutesPlayed:record?.minutesPlayed===undefined||record?.minutesPlayed===null?'':String(record.minutesPlayed),
      position:record?.position||'',entryMode:record?.entryMode||'',
      goalMethodIndex:Math.max(0,this.data.goalMethods.findIndex(o=>o.key===record?.goalMethod)),
      shotOutcomeIndex:Math.max(0,this.data.shotOutcomes.findIndex(o=>o.key===record?.shotOutcome)),
      entryModeIndex:Math.max(0,this.data.entryModes.findIndex(o=>o.key===record?.entryMode)),
    });
  },
  onPerformanceTap(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id||'');
    const record=this.data.performances.find(p=>p.id===id);
    if(record)this.openPerformance(record.performanceType,record);
  },
  onToggleMore():void{this.setData({moreOpen:!this.data.moreOpen});},
  onFormType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    if(this.data.busy)return;
    const index=Number(e.detail.value),type=this.data.allTypes[index]?.key;if(!type)return;
    this.setData({performanceTypeIndex:index,performanceType:type,goalMethod:'',goalMethodIndex:0,shotOutcome:'',shotOutcomeIndex:0,
      minutesPlayed:'',position:'',entryMode:'',entryModeIndex:0});
  },
  onFormClose():void{if(!this.data.busy)this.setData({formOpen:false});},
  noop():void{},
  onFormValue(e:WechatMiniprogram.Input):void{
    const key=String(e.currentTarget.dataset.key||'');
    if(['notes','minutesPlayed','position'].includes(key))this.setData({[key]:e.detail.value});
  },
  onFormPicker(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    if(this.data.busy)return;
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
    this.setData({busy:true,formError:''});
    try{
      await savePerformance(d.familyId,{...payload,...(d.performanceId?{version:d.performanceVersion}:{})},d.performanceId||undefined);
      this.setData({formOpen:false,selectedPersonId:d.playerPersonId,selectedPersonIndex:Math.max(0,d.people.findIndex(p=>p.id===d.playerPersonId))});await this.loadPerformances(true);
      wx.showToast({title:'记录成功',icon:'success'});
    }catch(e){this.setData({formError:statusError(e)});}
    finally{this.setData({busy:false});}
  },
  onFormDelete():void{
    if(!this.data.performanceId||this.data.busy)return;
    wx.showModal({title:'删除表现',content:'只删除这一条表现记录，确定继续？',confirmColor:'#E85A5A',
      success:async r=>{
        if(!r.confirm||this.data.busy)return;
        this.setData({busy:true});
        try{
          await removePerformance(this.data.familyId,this.data.performanceId,this.data.performanceVersion);
          this.setData({formOpen:false});await this.loadPerformances(true);
        }catch(e){this.setData({formError:statusError(e)});}
        finally{this.setData({busy:false});}
      }});
  },
});