import {currentFamilyStore,userStore} from '../../stores/index';
import {ensureRuntimeReady} from '../../services/runtime-bootstrap';
import {AppError} from '../../services/api';
import {AutoRefreshGate,markRefreshDirty} from '../../services/refresh-policy';
import {
  getHealthContext,listHealthMetrics,listMeasurements,listGrowth,listHealthEvents,listHealthDocuments,
  saveHealth,deleteHealth,saveGrowth,listHealthLinks,searchHealthTargets,addHealthLink,removeHealthLink,
  uploadHealthDocument,downloadHealthDocument,openHealthTemporaryFile,removeTemporaryFile,HEALTH_MAX_FILE,
  eventLabels,documentLabels,valueTypeLabels,
  type HealthKind,type HealthTab,type HealthMetric,type HealthObservation,type HealthEvent,type HealthDocument,
  type HealthRecord,type HealthPerson,type HealthPermissions,type HealthTarget,type HealthLink,type PickedHealthFile,type ValueType,
} from '../../services/health';
import {derivedBmi,growthMetrics,healthSince,healthMonth,familyToday,observationValue,measurementFields,trendSeries,validDate} from '../../utils/health-values';

type Option={key:string;label:string};
type ObservationRow=HealthObservation&{valueLabel:string;metricName:string};
type EventRow=HealthEvent&{typeLabel:string;monthLabel:string;dateLabel:string};
type DocumentRow=HealthDocument&{typeLabel:string};
type GrowthCard={label:string;value:string;unit:string;date:string;metricId:string};
type Modal=''|'manage'|'metric'|'measure'|'growth'|'event'|'document'|'detail'|'links';
type Detail=HealthEvent|HealthDocument;
type Form={name:string;type:string;typeIndex:number;date:string;raw:string;unit:string;notes:string;height:string;weight:string;location:string;description:string;issuer:string;eventId:string;eventLabel:string;timeLabel:string};
const formDefault=():Form=>({name:'',type:'',typeIndex:0,date:'',raw:'',unit:'',notes:'',height:'',weight:'',location:'',description:'',issuer:'',eventId:'',eventLabel:'不关联',timeLabel:''});
const noPermissions=():HealthPermissions=>({metrics:{read:false,write:false},measurements:{read:false,write:false},events:{read:false,write:false},documents:{read:false,write:false}});
const options=(keys:string[],labels:Record<string,string>):Option[]=>keys.map(key=>({key,label:labels[key]||key}));
const merge=<T extends {id:string}>(a:T[],b:T[]):T[]=>{const seen=new Set(a.map(x=>x.id));return [...a,...b.filter(x=>!seen.has(x.id))];};
const describe=(e:unknown)=>e instanceof Error?e.message:'操作未完成，请重试';
const confirm=(title:string,content:string)=>new Promise<boolean>(resolve=>wx.showModal({title,content,confirmColor:'#c2413b',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
const scopeNow=()=>[userStore.value?.id||'',currentFamilyStore.value?.id||''].join(':');
const values=options(['number','text','boolean'],valueTypeLabels);
const emptyCards=():GrowthCard[]=>[{label:'身高',value:'—',unit:'cm',date:'近期未找到',metricId:''},{label:'体重',value:'—',unit:'kg',date:'近期未找到',metricId:''},{label:'BMI',value:'—',unit:'kg/m²',date:'需同日身高体重',metricId:''}];

Page({
  data:{
    familyId:'',userId:'',timezone:'Asia/Shanghai',personId:'',personName:'',people:[] as HealthPerson[],
    tab:'overview' as HealthTab,tabs:[{key:'overview',label:'概览'},{key:'metrics',label:'指标'},{key:'events',label:'事件'},{key:'documents',label:'档案'}],
    permissions:noPermissions(),viewer:true,contextReady:false,contextLoading:true,contextError:'',
    eventTypeOptions:[] as Option[],documentTypeOptions:[] as Option[],docFilters:[{key:'',label:'全部'}] as Option[],
    metrics:[] as HealthMetric[],metricCursor:null as string|null,metricError:'',metricLoading:false,selectedMetricId:'',selectedMetric:null as HealthMetric|null,
    canMeasure:false,canManage:false,canEvent:false,canDocument:false,canGrow:false,
    loading:false,loaded:false,loadingMore:false,error:'',tabMessage:'',nextCursor:null as string|null,
    observations:[] as ObservationRow[],events:[] as EventRow[],documents:[] as DocumentRow[],
    growthCards:emptyCards(),recent:[] as ObservationRow[],latestValue:'—',latestUnit:'',latestDate:'暂无测量',deltaLabel:'',
    ranges:[{key:90,label:'近90天'},{key:365,label:'近一年'},{key:0,label:'全部'}],range:365,documentFilter:'',
    trendReady:false,trendMessage:'',trendCount:0,
    modal:'' as Modal,modalTitle:'',form:formDefault(),formError:'',editing:false,busy:false,formValueType:'number' as ValueType,
    valueTypeOptions:values,booleanOptions:[{key:'true',label:'是'},{key:'false',label:'否'}],
    fileName:'',shared:false,chooseEvent:false,eventChoices:[] as EventRow[],eventChoiceCursor:null as string|null,eventChoiceLoading:false,
    detailKind:'events' as 'events'|'documents',detailTitle:'',detailDate:'',detailMeta:'',detailLocation:'',detailDescription:'',detailHasFile:false,detailLinked:false,detailWritable:false,
    linkType:'event' as 'event'|'task',linkTypeIndex:0,linkTypes:[{key:'event',label:'日程'},{key:'task',label:'待办'}],linkQuery:'',
    links:[] as HealthLink[],linkCursor:null as string|null,linkCandidates:[] as HealthTarget[],candidateCursor:null as string|null,linkLoading:false,
  },
  _alive:true,_scope:'',_generation:0,_workspaceGeneration:0,_modalGeneration:0,_metricGeneration:0,
  _workspacePending:'',_tabPending:'',_refreshGate:new AutoRefreshGate(),
  _editing:undefined as HealthRecord|undefined,_detail:null as Detail|null,_picked:null as PickedHealthFile|null,_previewPath:'',_linkEventId:'',
  onLoad():void{this._alive=true;},
  async onShow():Promise<void>{
    try{await ensureRuntimeReady();}catch(cause){if(this._alive){this.resetScope('');this.setData({contextLoading:false,contextError:describe(cause)});}return;}
    if(!this._alive)return;
    const scope=scopeNow();
    if(scope!==this._scope){this.resetScope(scope);await this.loadWorkspace();return;}
    if(this.data.modal||this.data.busy)return;
    if(this._refreshGate.shouldRefresh(scope,'health',this.data.contextReady))await this.loadWorkspace();
  },
  onUnload():void{
    this._alive=false;++this._generation;++this._workspaceGeneration;++this._modalGeneration;++this._metricGeneration;
    this.releasePreview();this._picked=null;this._editing=undefined;this._detail=null;
  },
  validScope():boolean{return this._alive&&this._scope===scopeNow()&&!!this.data.familyId&&!!this.data.userId;},
  validModal(g:number):boolean{return this.validScope()&&g===this._modalGeneration;},
  resetScope(scope:string):void{
    ++this._generation;++this._workspaceGeneration;++this._metricGeneration;this._workspacePending='';this._tabPending='';
    this._scope=scope;this.closeModal(true);
    const family=currentFamilyStore.value,user=userStore.value;
    this.setData({familyId:family?.id||'',userId:user?.id||'',timezone:family?.timezone||'Asia/Shanghai',personId:'',personName:'',people:[],
      tab:'overview',permissions:noPermissions(),viewer:true,contextReady:false,contextLoading:true,contextError:'',
      metrics:[],metricCursor:null,metricError:'',metricLoading:false,selectedMetricId:'',selectedMetric:null,
      canMeasure:false,canManage:false,canEvent:false,canDocument:false,canGrow:false,eventTypeOptions:[],documentTypeOptions:[],docFilters:[{key:'',label:'全部'}],
      range:365,documentFilter:'',...this.clearedRows()});
  },
  clearedRows(){return {loading:false,loaded:false,loadingMore:false,error:'',tabMessage:'',nextCursor:null,observations:[] as ObservationRow[],events:[] as EventRow[],documents:[] as DocumentRow[],recent:[] as ObservationRow[],growthCards:emptyCards(),latestValue:'—',latestUnit:'',latestDate:'暂无测量',deltaLabel:'',trendReady:false,trendMessage:'',trendCount:0};},
  async loadWorkspace():Promise<void>{
    if(!this.validScope()){this.setData({contextLoading:false,contextError:'请先创建或加入家庭'});return;}
    const scope=this._scope;if(this._workspacePending===scope)return;
    this._workspacePending=scope;const gen=++this._workspaceGeneration;
    ++this._metricGeneration;this.setData({metricLoading:false});
    ++this._generation;this._tabPending='';this._refreshGate.noteRequest(scope,'health');
    this.setData({contextLoading:!this.data.contextReady,contextError:'',loading:false,loadingMore:false});
    try{
      const context=await getHealthContext(this.data.familyId);
      if(!this.validScope()||gen!==this._workspaceGeneration)return;
      const person=context.people.find(p=>p.personId===this.data.personId)||context.people.find(p=>p.userId===this.data.userId)||context.people[0];
      const me=context.people.find(p=>p.userId===this.data.userId);
      const viewer=!me||me.role==='viewer';
      const perms=context.permissions;const changed=person?.personId!==this.data.personId;
      this.setData({people:context.people,personId:person?.personId||'',personName:person?.displayName||'',permissions:perms,viewer,
        canMeasure:!viewer&&perms.measurements.write&&perms.metrics.read,canManage:!viewer&&perms.metrics.write,
        canEvent:!viewer&&perms.events.write,canDocument:!viewer&&perms.documents.write,
        eventTypeOptions:options(context.eventTypes,eventLabels),documentTypeOptions:options(context.documentTypes,documentLabels),
        docFilters:[{key:'',label:'全部'},...options(context.documentTypes,documentLabels)],
        ...(changed?this.clearedRows():{})});
      if(perms.metrics.read){
        try{const p=await listHealthMetrics(this.data.familyId);if(!this.validScope()||gen!==this._workspaceGeneration)return;this.applyMetrics(p.items,p.nextCursor);}
        catch(cause){if(!this.validScope()||gen!==this._workspaceGeneration)return;this.applyMetrics([],null,describe(cause));}
      }else this.applyMetrics([],null);
      if(!this.validScope()||gen!==this._workspaceGeneration)return;
      this.setData({contextReady:true,contextLoading:false});
      if(person)await this.loadTab(false);
      else this.setData({tabMessage:'暂无有效家庭成员',loaded:true});
    }catch(cause){
      if(this.validScope()&&gen===this._workspaceGeneration){
        this.setData({contextReady:false,contextLoading:false,contextError:describe(cause),permissions:noPermissions(),people:[],personId:'',personName:'',metrics:[],metricCursor:null,selectedMetric:null,selectedMetricId:'',canMeasure:false,canManage:false,canEvent:false,canDocument:false,canGrow:false,...this.clearedRows()});
      }
    }finally{if(gen===this._workspaceGeneration)this._workspacePending='';}
  },
  applyMetrics(items:HealthMetric[],cursor:string|null,error=''):void{
    const rank=(m:HealthMetric)=>m.name==='身高'?0:m.name==='体重'?1:2;
    const metrics=items.slice().sort((a,b)=>rank(a)-rank(b));
    const selectedMetric=metrics.find(m=>m.id===this.data.selectedMetricId)||metrics[0]||null;
    const growth=growthMetrics(metrics,!cursor&&!error);
    this.setData({metrics,metricCursor:cursor,metricError:error,selectedMetric,selectedMetricId:selectedMetric?.id||'',canGrow:!!growth.height&&!!growth.weight&&this.data.canMeasure});
  },
  async loadMoreMetrics():Promise<void>{
    if(!this.validScope()||this._workspacePending||this.data.metricLoading||!this.data.metricCursor)return;
    const gen=++this._metricGeneration,scope=this._scope,cursor=this.data.metricCursor;
    this.setData({metricLoading:true,metricError:''});
    try{const p=await listHealthMetrics(this.data.familyId,cursor);if(this.validScope()&&scope===this._scope&&gen===this._metricGeneration)this.applyMetrics(merge(this.data.metrics,p.items),p.nextCursor);}
    catch(cause){if(this.validScope()&&gen===this._metricGeneration)this.applyMetrics([],null,describe(cause));}
    finally{if(this.validScope()&&gen===this._metricGeneration)this.setData({metricLoading:false});}
  },
  canReadTab():boolean{
    const p=this.data.permissions,t=this.data.tab;
    return t==='overview'?true:t==='metrics'?p.metrics.read&&p.measurements.read:t==='events'?p.events.read:p.documents.read;
  },
  observationRows(rows:HealthObservation[]):ObservationRow[]{
    const names=new Map(this.data.metrics.map(m=>[m.id,m.name]));
    return rows.map(r=>({...r,metricName:names.get(r.metricId)||'健康指标',valueLabel:observationValue(r)}));
  },
  eventRows(rows:HealthEvent[]):EventRow[]{
    return rows.map((r,i)=>({...r,typeLabel:eventLabels[r.eventType]||r.eventType,dateLabel:r.timeLabel||r.date,monthLabel:i===0||healthMonth(r.date)!==healthMonth(rows[i-1].date)?healthMonth(r.date):''}));
  },
  growthView(rows:HealthObservation[],bmi:{date:string;value:number}|null):GrowthCard[]{
    const {height,weight}=growthMetrics(this.data.metrics,!this.data.metricCursor&&!this.data.metricError);
    const card=(label:string,unit:string,metric:HealthMetric|undefined):GrowthCard=>{
      const latest=metric?rows.find(r=>r.metricId===metric.id&&r.unit===unit&&typeof r.valueNumber==='number'):undefined;
      return {label,unit,value:latest?observationValue(latest):'—',date:latest?.observedDate||'近期未找到',metricId:metric?.id||''};
    };
    return [card('身高','cm',height),card('体重','kg',weight),{label:'BMI',unit:'kg/m²',value:bmi?String(bmi.value):'—',date:bmi?.date||'需同日身高体重',metricId:''}];
  },
  async loadTab(append=false):Promise<void>{
    if(!this.validScope()||!this.data.contextReady||!this.data.personId)return;
    if(!this.canReadTab()){this.setData({...this.clearedRows(),loaded:true,tabMessage:'当前没有访问权限'});return;}
    const d=this.data,person=d.personId,tab=d.tab,metric=d.selectedMetric,range=d.range,filter=d.documentFilter,cursor=append?d.nextCursor:null;
    if(append&&!cursor)return;
    const key=JSON.stringify([this._scope,person,tab,metric?.id,range,filter,cursor]);
    if(this._tabPending===key)return;this._tabPending=key;
    const gen=++this._generation,valid=()=>this.validScope()&&gen===this._generation;
    this.setData({loading:!append&&!d.loaded,loadingMore:append,error:'',tabMessage:''});
    try{
      if(tab==='overview'){
        if(!d.permissions.measurements.read){if(valid())this.setData({recent:[],growthCards:emptyCards(),loaded:true});return;}
        const p=await listMeasurements(d.familyId,person,{limit:12});
        if(!valid())return;
        const {height,weight}=growthMetrics(d.metrics,!d.metricCursor&&!d.metricError);
        const boundary=p.nextCursor?p.items[p.items.length-1]?.observedDate:undefined;
        let bmi=height&&weight?derivedBmi(p.items,height.id,weight.id,person,boundary):null;
        let rows=p.items;
        if(height&&weight&&p.nextCursor&&!bmi){
          try{const extra=await listGrowth(d.familyId,person,height.id,weight.id);if(!valid())return;
            rows=merge(rows,extra.items).sort((a,b)=>b.observedDate.localeCompare(a.observedDate));
            bmi=derivedBmi(extra.items,height.id,weight.id,person,extra.nextCursor?extra.items[extra.items.length-1]?.observedDate:undefined);
          }catch{if(!valid())return;}
        }
        if(valid())this.setData({growthCards:this.growthView(rows,bmi),recent:this.observationRows(p.items.slice(0,6)),nextCursor:null,loaded:true});
      }else if(tab==='metrics'){
        if(!metric){if(valid())this.setData({observations:[],nextCursor:null,loaded:true,trendReady:false});return;}
        const p=await listMeasurements(d.familyId,person,{limit:30,cursor,metricId:metric.id,since:range?healthSince(familyToday(d.timezone),range):undefined});
        if(!valid())return;
        const observations=this.observationRows(append?merge(this.data.observations,p.items):p.items);
        const first=observations[0],prev=observations[1];
        const delta=first&&prev&&typeof first.valueNumber==='number'&&typeof prev.valueNumber==='number'&&first.unit===prev.unit?first.valueNumber-prev.valueNumber:null;
        const series=trendSeries(observations);
        this.setData({observations,nextCursor:p.nextCursor,loaded:true,latestValue:first?observationValue(first):'—',latestUnit:first?.unit??metric.defaultUnit??'',latestDate:first?.observedDate||'暂无测量',
          deltaLabel:delta===null?'':'较上次 '+(delta>0?'+':'')+Number(delta.toPrecision(5))+' '+(first?.unit||''),
          trendReady:metric.valueType==='number'&&series.points.length>=2,trendCount:series.points.length,trendMessage:metric.valueType==='number'?series.message:''},
          ()=>{if(valid()&&this.data.trendReady)this.drawTrend();});
      }else if(tab==='events'){
        const p=await listHealthEvents(d.familyId,person,d.timezone,cursor);
        if(valid())this.setData({events:this.eventRows(append?merge(this.data.events,p.items):p.items),nextCursor:p.nextCursor,loaded:true});
      }else{
        const p=await listHealthDocuments(d.familyId,person,filter,cursor);
        if(valid())this.setData({documents:(append?merge(this.data.documents,p.items):p.items).map(x=>({...x,typeLabel:documentLabels[x.documentType]||x.documentType})),nextCursor:p.nextCursor,loaded:true});
      }
    }catch(cause){if(valid())this.setData({...this.clearedRows(),loaded:true,error:describe(cause)});}
    finally{if(valid()){this.setData({loading:false,loadingMore:false});this._tabPending='';}}
  },
  drawTrend():void{
    const gen=this._generation,series=trendSeries(this.data.observations);
    if(series.points.length<2)return;
    wx.createSelectorQuery().select('#healthTrend').boundingClientRect(rect=>{
      const box=Array.isArray(rect)?rect[0]:rect;
      if(!box||!box.width||!box.height||!this.validScope()||gen!==this._generation||this.data.tab!=='metrics')return;
      const ctx=wx.createCanvasContext('healthTrend');
      const w=box.width,h=box.height,left=42,right=w-12,top=22,bottom=h-25;
      const x0=series.points[0].x,x1=series.points[series.points.length-1].x;
      const x=(v:number)=>left+(x1===x0 ? .5 :(v-x0)/(x1-x0))*(right-left);
      const y=(v:number)=>bottom-(v-series.low)/(series.high-series.low)*(bottom-top);
      ctx.setFontSize(10);ctx.setFillStyle('#78716c');ctx.setTextAlign('left');ctx.fillText(series.unit,4,12);
      for(let i=0;i<4;i++){const yy=top+(bottom-top)*i/3;ctx.setStrokeStyle('#e7e5e4');ctx.setLineWidth(1);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.setTextAlign('right');ctx.fillText(String(Number((series.high-(series.high-series.low)*i/3).toPrecision(4))),left-4,yy+3);}
      ctx.setStrokeStyle('#047857');ctx.setLineWidth(2);ctx.beginPath();
      series.points.forEach((p,i)=>{if(i===0)ctx.moveTo(x(p.x),y(p.y));else ctx.lineTo(x(p.x),y(p.y));});ctx.stroke();
      ctx.setFillStyle('#047857');for(const p of series.points){ctx.beginPath();ctx.arc(x(p.x),y(p.y),3,0,2*Math.PI);ctx.fill();}
      ctx.setFillStyle('#78716c');ctx.setTextAlign('left');ctx.fillText(series.points[0].date,left,h-6);ctx.setTextAlign('right');ctx.fillText(series.points[series.points.length-1].date,right,h-6);ctx.draw();
    }).exec();
  },
  onPerson(e:WechatMiniprogram.TouchEvent):void{
    if(this.data.busy||this._workspacePending||!this.validScope())return;
    const id=String(e.currentTarget.dataset.id||''),person=this.data.people.find(p=>p.personId===id);
    if(!person||id===this.data.personId)return;
    ++this._generation;this._tabPending='';this.closeModal(true);
    this.setData({personId:id,personName:person.displayName,...this.clearedRows()});void this.loadTab();
  },
  switchTab(tab:HealthTab,metricId?:string):void{
    if(this.data.busy||this._workspacePending||!this.validScope())return;
    if(!['overview','metrics','events','documents'].includes(tab))return;
    ++this._generation;this._tabPending='';this.closeModal(true);
    const selectedMetric=this.data.metrics.find(m=>m.id===(metricId||this.data.selectedMetricId))||this.data.metrics[0]||null;
    this.setData({tab,selectedMetric,selectedMetricId:selectedMetric?.id||'',...this.clearedRows()});void this.loadTab();
  },
  onTab(e:WechatMiniprogram.TouchEvent):void{const tab=e.currentTarget.dataset.tab as HealthTab;if(tab!==this.data.tab)this.switchTab(tab);},
  onMetric(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id||'');if(!this.data.metrics.some(m=>m.id===id))return;
    if(this.data.tab==='metrics'&&id===this.data.selectedMetricId)return;this.switchTab('metrics',id);
  },
  onRange(e:WechatMiniprogram.TouchEvent):void{
    const range=Number(e.currentTarget.dataset.range);if(![0,90,365].includes(range)||range===this.data.range||this._workspacePending||this.data.busy)return;
    this.setData({range,...this.clearedRows()});void this.loadTab();
  },
  onDocFilter(e:WechatMiniprogram.TouchEvent):void{
    const filter=String(e.currentTarget.dataset.key||'');if(filter===this.data.documentFilter||this._workspacePending||this.data.busy||!this.data.docFilters.some(x=>x.key===filter))return;
    this.setData({documentFilter:filter,...this.clearedRows()});void this.loadTab();
  },
  onLoadMore():void{if(!this.data.loading&&!this.data.loadingMore&&!this.data.error&&this.data.nextCursor)void this.loadTab(true);},
  async onRefresh():Promise<void>{if(this.data.modal||this.data.busy)return;try{await ensureRuntimeReady();if(!this._alive)return;if(scopeNow()!==this._scope)this.resetScope(scopeNow());await this.loadWorkspace();}catch(cause){if(this._alive)this.setData({contextLoading:false,contextError:describe(cause)});}},
  onPullDownRefresh():void{if(this.data.modal||this.data.busy){wx.stopPullDownRefresh();return;}void this.onRefresh().then(()=>wx.stopPullDownRefresh(),()=>wx.stopPullDownRefresh());},
  releasePreview():void{if(this._previewPath){removeTemporaryFile(this._previewPath);this._previewPath='';}},
  closeModal(force=false):void{
    if(this.data.busy&&!force)return;
    ++this._modalGeneration;this.releasePreview();this._picked=null;this._editing=undefined;this._detail=null;this._linkEventId='';
    this.setData({modal:'',modalTitle:'',editing:false,form:formDefault(),formError:'',busy:false,fileName:'',shared:false,chooseEvent:false,eventChoices:[],eventChoiceCursor:null,eventChoiceLoading:false,
      links:[],linkCursor:null,linkCandidates:[],candidateCursor:null,linkLoading:false,linkQuery:''});
    if(this.data.trendReady&&this.data.tab==='metrics')wx.nextTick(()=>this.drawTrend());
  },
  onCloseModal():void{this.closeModal();},
  openForm(modal:Modal,title:string,form:Form,existing?:HealthRecord):void{
    if(!this.validScope()||this.data.busy||this._workspacePending)return;
    this.closeModal(true);this._editing=existing;this.setData({modal,modalTitle:title,form,editing:!!existing});
  },
  onManage():void{if(this.data.canManage&&!this.data.busy&&this.validScope()){this.closeModal(true);this.setData({modal:'manage',modalTitle:'家庭指标管理'});}},
  onNewMetric():void{if(!this.data.canManage)return;this.openForm('metric','新增指标',{...formDefault(),type:'number'});},
  onEditMetric(e:WechatMiniprogram.TouchEvent):void{
    const metric=this.data.metrics.find(m=>m.id===e.currentTarget.dataset.id);if(!metric||!this.data.canManage)return;
    this.openForm('metric','编辑指标',{...formDefault(),name:metric.name,type:metric.valueType,typeIndex:values.findIndex(x=>x.key===metric.valueType),unit:metric.defaultUnit||''},metric);
  },
  openMeasurement(record?:HealthObservation):void{
    const metric=this.data.metrics.find(m=>m.id===(record?.metricId||this.data.selectedMetricId));if(!this.data.canMeasure||!metric)return;
    const raw=record?(typeof record.valueNumber==='number'?String(record.valueNumber):typeof record.valueBoolean==='boolean'?String(record.valueBoolean):record.valueText||''):'';
    this.openForm('measure',record?'编辑测量':'记录'+metric.name,{...formDefault(),name:metric.name,date:record?.observedDate||familyToday(this.data.timezone),raw,unit:record?.unit??metric.defaultUnit??'',notes:record?.notes||''},record);
    this.setData({formValueType:metric.valueType});
  },
  onNewMeasurement():void{this.openMeasurement();},
  onMeasurementMenu(e:WechatMiniprogram.TouchEvent):void{
    const record=this.data.observations.find(r=>r.id===e.currentTarget.dataset.id);if(!record||!this.data.canMeasure||this.data.busy)return;
    const scope=this._scope,person=this.data.personId;
    wx.showActionSheet({itemList:['编辑','删除'],success:r=>{if(this.validScope()&&scope===this._scope&&person===this.data.personId){if(r.tapIndex===0)this.openMeasurement(record);else if(r.tapIndex===1)void this.removeRecord('measurements',record);}}});
  },
  onGrowth():void{
    if(!this.validScope()||!this.data.canMeasure)return;
    const {height,weight}=growthMetrics(this.data.metrics,!this.data.metricCursor&&!this.data.metricError);
    if(!height||!weight){this.switchTab('metrics');return;}
    this.openForm('growth','记录身高体重',{...formDefault(),date:familyToday(this.data.timezone)});
  },
  openEvent(record?:HealthEvent):void{
    if(!this.data.canEvent||!this.data.eventTypeOptions.length)return;
    const opts=this.data.eventTypeOptions,type=record?.eventType||(opts.some(x=>x.key==='visit')?'visit':opts[0].key);
    this.openForm('event',record?'编辑健康事件':'记录健康事件',{...formDefault(),name:record?.summary||'',type,typeIndex:Math.max(0,opts.findIndex(x=>x.key===type)),date:record?.date||familyToday(this.data.timezone),timeLabel:record?.timeLabel||'',location:record?.location||'',description:record?.description||''},record);
  },
  onNewEvent():void{this.openEvent();},
  openDocument(record?:HealthDocument):void{
    if(!this.data.canDocument||!this.data.documentTypeOptions.length)return;
    const opts=this.data.documentTypeOptions,type=record?.documentType||opts[0].key;
    this.openForm('document',record?'编辑档案':'上传健康档案',{...formDefault(),name:record?.title||'',type,typeIndex:Math.max(0,opts.findIndex(x=>x.key===type)),date:record?.issuedDate||'',issuer:record?.issuerName||'',notes:record?.notes||'',eventId:record?.eventId||'',eventLabel:record?.eventId?'保留已有事件':'不关联'},record);
  },
  onNewDocument():void{this.openDocument();},
  onField(e:WechatMiniprogram.Input):void{
    const key=String(e.currentTarget.dataset.key||'');
    if(!this.data.busy&&['name','raw','unit','notes','height','weight','location','description','issuer'].includes(key))this.setData({['form.'+key]:e.detail.value});
  },
  onDate(e:WechatMiniprogram.CustomEvent<{value:string}>):void{if(!this.data.busy)this.setData({'form.date':e.detail.value});},
  onClearDate():void{if(!this.data.busy&&this.data.modal==='document')this.setData({'form.date':''});},
  onType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    if(this.data.busy)return;
    const opts=this.data.modal==='metric'?values:this.data.modal==='event'?this.data.eventTypeOptions:this.data.documentTypeOptions;
    const index=Number(e.detail.value),option=opts[index];if(option)this.setData({'form.type':option.key,'form.typeIndex':index});
  },
  onBoolean(e:WechatMiniprogram.TouchEvent):void{const raw=String(e.currentTarget.dataset.value||'');if(!this.data.busy&&['true','false'].includes(raw))this.setData({'form.raw':raw});},
  onShared(e:WechatMiniprogram.CustomEvent<{value:string[]}>):void{if(!this.data.busy)this.setData({shared:e.detail.value.includes('shared')});},
  chooseFile():void{
    if(!this.validScope()||this.data.busy||this.data.editing||this.data.modal!=='document')return;
    const gen=this._modalGeneration;
    const accept=(path:string,name:string,size:number)=>{
      if(!this.validModal(gen))return;
      if(!path||size<1||size>HEALTH_MAX_FILE){this.setData({formError:'请选择不超过15 MB的 PDF 或图片'});return;}
      this._picked={path,name,size};this.setData({fileName:name,formError:'',...(!this.data.form.name.trim()?{'form.name':name.replace(/\.[^.]+$/u,'')}: {})});
    };
    wx.showActionSheet({itemList:['相册或拍照','微信文件（PDF/图片）'],success:r=>{
      if(!this.validModal(gen))return;
      if(r.tapIndex===0)wx.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:v=>{const f=v.tempFiles[0];if(f)accept(f.path,'健康图片.jpg',f.size);}});
      else wx.chooseMessageFile({count:1,type:'file',extension:['pdf','png','jpg','jpeg','webp'],success:v=>{const f=v.tempFiles[0];if(f)accept(f.path,f.name,f.size);}});
    }});
  },
  onToggleEventChooser():void{
    if(this.data.busy||!this.validScope())return;
    const open=!this.data.chooseEvent;this.setData({chooseEvent:open});if(open&&!this.data.eventChoices.length)void this.loadEventChoices(false);
  },
  async loadEventChoices(append=false):Promise<void>{
    if(!this.validScope()||!this.data.chooseEvent||this.data.eventChoiceLoading||this.data.modal!=='document')return;
    if(append&&!this.data.eventChoiceCursor)return;
    const gen=this._modalGeneration;this.setData({eventChoiceLoading:true,formError:''});
    try{const p=await listHealthEvents(this.data.familyId,this.data.personId,this.data.timezone,append?this.data.eventChoiceCursor:null);
      if(this.validModal(gen))this.setData({eventChoices:this.eventRows(append?merge(this.data.eventChoices,p.items):p.items),eventChoiceCursor:p.nextCursor});}
    catch(cause){if(this.validModal(gen))this.setData({formError:describe(cause),eventChoices:[],eventChoiceCursor:null});}
    finally{if(this.validModal(gen))this.setData({eventChoiceLoading:false});}
  },
  onMoreEventChoices():void{void this.loadEventChoices(true);},
  onChooseEvent(e:WechatMiniprogram.TouchEvent):void{
    const id=String(e.currentTarget.dataset.id||''),record=this.data.eventChoices.find(r=>r.id===id);
    if(!this.data.busy&&(!id||record))this.setData({'form.eventId':id,'form.eventLabel':record?record.summary+' · '+record.date:'不关联',chooseEvent:false});
  },
  async onSave():Promise<void>{
    if(!this.validScope()||this.data.busy)return;
    const {familyId,personId,timezone,modal,form:f}=this.data,existing=this._editing,gen=this._modalGeneration;
    this.setData({busy:true,formError:''});
    try{
      if(modal==='metric'){
        if(!this.data.canManage||!f.name.trim()||!values.some(v=>v.key===f.type))throw Error('请填写指标名称及类型');
        await saveHealth(familyId,personId,'metrics',existing?{name:f.name.trim()}:{name:f.name.trim(),valueType:f.type,defaultUnit:f.unit.trim()||null},existing);
      }else if(modal==='measure'){
        const metric=this.data.metrics.find(m=>m.id===((existing as HealthObservation|undefined)?.metricId||this.data.selectedMetricId));
        if(!metric||!this.data.canMeasure)throw Error('指标不可用');
        await saveHealth(familyId,personId,'measurements',measurementFields(metric,f.date,f.raw,f.unit,f.notes),existing);
      }else if(modal==='growth'){
        const {height,weight}=growthMetrics(this.data.metrics,!this.data.metricCursor&&!this.data.metricError);
        if(!this.data.canMeasure||!height||!weight||!validDate(f.date))throw Error('成长指标或日期无效');
        const entries:{metricId:string;unit:'cm'|'kg';value:number}[]=[];
        if(f.height.trim())entries.push({metricId:height.id,unit:'cm',value:Number(f.height)});
        if(f.weight.trim())entries.push({metricId:weight.id,unit:'kg',value:Number(f.weight)});
        if(!entries.length||entries.some(e=>!Number.isFinite(e.value)||e.value<=0))throw Error('至少填写一项有效身高或体重');
        await saveGrowth(familyId,personId,f.date,entries);
      }else if(modal==='event'){
        if(!this.data.canEvent||!f.name.trim()||!validDate(f.date)||!this.data.eventTypeOptions.some(x=>x.key===f.type))throw Error('请填写标题、日期和类型');
        await saveHealth(familyId,personId,'events',{summary:f.name.trim(),eventType:f.type,date:f.date,location:f.location.trim()||null,description:f.description.trim()||null},existing,timezone);
      }else if(modal==='document'){
        if(!this.data.canDocument||!f.name.trim()||!this.data.documentTypeOptions.some(x=>x.key===f.type)||f.date&&!validDate(f.date))throw Error('请填写有效档案名称、类型和日期');
        const fields={title:f.name.trim(),documentType:f.type,issuedDate:f.date,issuerName:f.issuer.trim(),notes:f.notes.trim(),eventId:f.eventId};
        if(existing){const old=existing as HealthDocument;const {eventId,...rest}=fields;
          await saveHealth(familyId,personId,'documents',{...rest,issuedDate:f.date||null,...(eventId!==(old.eventId||'')?{eventId:eventId||null}:{})},existing);
        }else{
          if(!this._picked||!this.data.shared)throw Error('请选择文件并确认该档案适合在当前家庭共享');
          await uploadHealthDocument(familyId,personId,this._picked,fields);
        }
      }else return;
      if(!this.validModal(gen))return;
      markRefreshDirty('health');this.closeModal(true);wx.showToast({title:'已保存',icon:'success'});
      if(modal==='metric'){await this.loadWorkspace();if(this.validScope()&&this.data.canManage)this.onManage();}
      else if(modal==='event'&&this.data.tab==='overview')this.switchTab('events');
      else if(modal==='document'&&this.data.tab==='overview')this.switchTab('documents');
      else {this._refreshGate.noteRequest(this._scope,'health');await this.loadTab(false);}
    }catch(cause){if(this.validModal(gen))this.setData({formError:describe(cause)});}
    finally{if(this.validModal(gen))this.setData({busy:false});}
  },
  onDetail(e:WechatMiniprogram.TouchEvent):void{
    if(this.data.busy||this._workspacePending||!this.validScope())return;
    const id=String(e.currentTarget.dataset.id||''),kind=this.data.tab==='events'?'events':'documents';
    const record=kind==='events'?this.data.events.find(x=>x.id===id):this.data.documents.find(x=>x.id===id);
    if(!record)return;
    this.closeModal(true);this._detail=record;
    if(kind==='events'){
      const r=record as EventRow;
      this.setData({modal:'detail',modalTitle:r.summary,detailKind:kind,detailTitle:r.summary,detailDate:r.dateLabel,detailMeta:r.typeLabel+(r.status==='cancelled'?' · 已取消':''),detailLocation:r.location||'',detailDescription:r.description||'',detailHasFile:false,detailLinked:false,detailWritable:this.data.canEvent});
    }else{
      const r=record as DocumentRow;
      this.setData({modal:'detail',modalTitle:r.title,detailKind:kind,detailTitle:r.title,detailDate:r.issuedDate||'日期未记录',detailMeta:r.typeLabel,detailLocation:r.issuerName||'',detailDescription:r.notes||'',detailHasFile:r.hasFile,detailLinked:!!r.eventId,detailWritable:this.data.canDocument});
    }
  },
  onEditDetail():void{
    const record=this._detail;if(!record||!this.data.detailWritable||this.data.busy||!this.validScope())return;
    if(this.data.detailKind==='events')this.openEvent(record as HealthEvent);else this.openDocument(record as HealthDocument);
  },
  async removeRecord(kind:Exclude<HealthKind,'metrics'>,record:HealthRecord):Promise<void>{
    if(!this.validScope()||this.data.busy||!(kind==='measurements'?this.data.canMeasure:kind==='events'?this.data.canEvent:this.data.canDocument))return;
    const scope=this._scope,person=this.data.personId;
    if(!await confirm('确认删除','删除这条健康记录？')||!this.validScope()||scope!==this._scope||person!==this.data.personId)return;
    this.setData({busy:true,formError:''});
    try{await deleteHealth(this.data.familyId,person,kind,record);if(!this.validScope()||scope!==this._scope)return;
      markRefreshDirty('health');this.closeModal(true);this._refreshGate.noteRequest(scope,'health');await this.loadTab(false);wx.showToast({title:'已删除',icon:'success'});}
    catch(cause){if(this.validScope()&&scope===this._scope){this.setData({formError:describe(cause)});wx.showToast({title:'删除未完成，请刷新核对',icon:'none'});}}
    finally{if(this.validScope()&&scope===this._scope)this.setData({busy:false});}
  },
  onDeleteDetail():void{if(this._detail)void this.removeRecord(this.data.detailKind,this._detail);},
  async onPreviewFile(e:WechatMiniprogram.TouchEvent):Promise<void>{
    if(!this.validScope()||this.data.busy||this.data.detailKind!=='documents'||!this._detail||!this.data.detailHasFile)return;
    const gen=this._modalGeneration,id=this._detail.id,allowExport=e.currentTarget.dataset.export===true||e.currentTarget.dataset.export==='true';
    this.releasePreview();this.setData({busy:true,formError:''});
    try{
      const path=await downloadHealthDocument(this.data.familyId,this.data.personId,id);
      if(!this.validModal(gen)){removeTemporaryFile(path);return;}
      this._previewPath=path;await openHealthTemporaryFile(path,allowExport);
    }catch(cause){if(this.validModal(gen)){this.releasePreview();const diagnostic=cause instanceof AppError?'（'+cause.code+(cause.requestId?' · '+cause.requestId:'')+'）':'';this.setData({formError:describe(cause)+diagnostic});}}
    finally{if(this.validModal(gen))this.setData({busy:false});}
  },
  onOpenLinks():void{
    if(!this.validScope()||this.data.busy||this.data.detailKind!=='events'||!this._detail)return;
    const id=this._detail.id;this.closeModal(true);this._linkEventId=id;
    this.setData({modal:'links',modalTitle:'相关日程与待办',linkType:'event',linkTypeIndex:0});void this.loadLinks(false);
  },
  async loadLinks(append=false):Promise<void>{
    if(!this.validScope()||this.data.linkLoading||!this._linkEventId||append&&!this.data.linkCursor)return;
    const gen=this._modalGeneration;this.setData({linkLoading:true,formError:''});
    try{const p=await listHealthLinks(this.data.familyId,this.data.personId,this._linkEventId,this.data.timezone,append?this.data.linkCursor:null);
      if(this.validModal(gen))this.setData({links:append?merge(this.data.links,p.items):p.items,linkCursor:p.nextCursor});}
    catch(cause){if(this.validModal(gen))this.setData({formError:describe(cause),links:[],linkCursor:null});}
    finally{if(this.validModal(gen))this.setData({linkLoading:false});}
  },
  onMoreLinks():void{void this.loadLinks(true);},
  onLinkType(e:WechatMiniprogram.CustomEvent<{value:string}>):void{
    if(this.data.linkLoading||this.data.busy)return;const index=Number(e.detail.value);if(index===0||index===1)this.setData({linkType:index===0?'event':'task',linkTypeIndex:index,linkCandidates:[],candidateCursor:null});
  },
  onLinkQuery(e:WechatMiniprogram.Input):void{if(!this.data.linkLoading&&!this.data.busy)this.setData({linkQuery:e.detail.value,linkCandidates:[],candidateCursor:null});},
  async searchLinks(append=false):Promise<void>{
    if(!this.validScope()||this.data.linkLoading||this.data.busy||!this.data.canEvent||!this._linkEventId||!this.data.linkQuery.trim()||append&&!this.data.candidateCursor)return;
    const gen=this._modalGeneration;this.setData({linkLoading:true,formError:''});
    try{const p=await searchHealthTargets(this.data.familyId,this.data.personId,this._linkEventId,this.data.linkType,this.data.linkQuery.trim(),this.data.timezone,append?this.data.candidateCursor:null);
      if(this.validModal(gen))this.setData({linkCandidates:append?merge(this.data.linkCandidates,p.items):p.items,candidateCursor:p.nextCursor});}
    catch(cause){if(this.validModal(gen))this.setData({formError:describe(cause),linkCandidates:[],candidateCursor:null});}
    finally{if(this.validModal(gen))this.setData({linkLoading:false});}
  },
  onSearchLinks():void{void this.searchLinks();},
  onMoreCandidates():void{void this.searchLinks(true);},
  async onAddLink(e:WechatMiniprogram.TouchEvent):Promise<void>{
    const id=String(e.currentTarget.dataset.id||'');if(this.data.busy||this.data.linkLoading||!this.data.canEvent||!this.validScope()||!this._linkEventId||!this.data.linkCandidates.some(x=>x.id===id)||this.data.links.some(x=>x.type===this.data.linkType&&x.targetId===id))return;
    const gen=this._modalGeneration;this.setData({busy:true,formError:''});
    try{await addHealthLink(this.data.familyId,this.data.personId,this._linkEventId,this.data.linkType,id);if(this.validModal(gen))await this.loadLinks(false);}
    catch(cause){if(this.validModal(gen))this.setData({formError:describe(cause)});}
    finally{if(this.validModal(gen))this.setData({busy:false});}
  },
  async onRemoveLink(e:WechatMiniprogram.TouchEvent):Promise<void>{
    const id=String(e.currentTarget.dataset.id||'');if(this.data.busy||this.data.linkLoading||!this.data.canEvent||!this.validScope()||!this._linkEventId||!this.data.links.some(x=>x.id===id))return;
    const gen=this._modalGeneration;if(!await confirm('解除关联','仅解除关联，不删除原记录。')||!this.validModal(gen))return;
    this.setData({busy:true,formError:''});
    try{await removeHealthLink(this.data.familyId,this.data.personId,this._linkEventId,id);if(this.validModal(gen))await this.loadLinks(false);}
    catch(cause){if(this.validModal(gen))this.setData({formError:describe(cause)});}
    finally{if(this.validModal(gen))this.setData({busy:false});}
  },
  stopTap():void{},
});
