/** Stable Mini family health product API. No client-supplied model key, upstream
 * path, query AST, raw TemporalRange write, file ID or credential substitution.
 * LifeSpace remains the authority; HomeMew restricts its family/subject UX scope.
 */
import { authorizationHeader, errorResponse, forwardLifeSpace, json } from './miniprogram-upstream.mjs';
import { handleHealthDocumentFile, validHealthR2Url } from './health-document-files.mjs';

const PREFIX='/api/v1/miniprogram/families/';
const SPACE=/^spc_[A-Za-z0-9_-]{1,180}$/u, PERSON=/^per_[A-Za-z0-9_-]{1,180}$/u;
const RECORD=/^rec_[A-Za-z0-9_-]{1,180}$/u, EDGE=/^[a-z]{2,8}_[A-Za-z0-9_-]{1,180}$/u;
const MODELS=Object.freeze({metrics:'health_metric',measurements:'health_observation',events:'health_event',documents:'health_document'});
const TYPES=['number','text','boolean'];
const EVENT_TYPES=['symptom','injury','visit','examination','procedure','treatment','medication_intake','vaccination','rehabilitation','other'];
const DOCUMENT_TYPES=['lab_report','imaging_report','physical_exam','prescription','visit_note','discharge_summary','rehabilitation_plan','other'];
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const validVersion=v=>Number.isInteger(v)&&v>=1;
const str=(v,max)=>typeof v==='string'&&v.length<=max&&!v.includes('\u0000');
const opt=(v,max)=>v==null||str(v,max);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>obj(v)&&Object.keys(v).every(k=>allowed.includes(k));
const clean=v=>typeof v==='string'?v.trim()||null:null;
const f=(field,op,value)=>({field,op,value});
const and=filters=>filters.length===1?filters[0]:{and:filters};
const ref=(modelKey,recordId)=>({kind:'record',modelKey,recordId});
const dayAfter=(date,days=1)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const col=(root,kind)=>root+'/models/'+MODELS[kind]+'/records';
const validZone=v=>{try{return typeof v==='string'&&v.length<=80&&!!new Intl.DateTimeFormat('en',{timeZone:v}).format(0);}catch{return false;}};
function dateFor(when,timezone) {
  if(when?.kind==='date')return when.start;
  if(when?.kind!=='instant'||!Number.isFinite(Date.parse(when.start)))return '';
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(when.start));
  return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-');
}
function row(kind,r,timezone='UTC') {
  const base={id:r.id,version:r.version};
  if(kind==='metrics')return {...base,name:r.name,valueType:r.valueType,defaultUnit:r.defaultUnit??null};
  const subject={...base,subjectPersonId:r.subjectPersonId};
  if(kind==='measurements')return {...subject,metricId:r.metricId,observedDate:r.observedDate,valueNumber:r.valueNumber??null,valueText:r.valueText??null,valueBoolean:r.valueBoolean??null,unit:r.unit??null,notes:r.notes??null};
  if(kind==='events')return {...subject,summary:r.summary,eventType:r.eventType,date:dateFor(r.when,timezone),timed:r.when?.kind==='instant',timeLabel:r.when?.kind==='instant'?new Date(r.when.start).toLocaleString('zh-CN',{timeZone:timezone}):null,status:r.status,location:r.location?.name??null,description:r.description??null};
  return {...subject,title:r.title,documentType:r.documentType,issuedDate:r.issuedDate??null,issuerName:r.issuerName??null,notes:r.notes??null,eventId:r.eventId??null,hasFile:!!r.artifactRef};
}
function targetRow(r,timezone){return {id:r.id,title:r.summary||r.name||'名称暂不可用',date:r.when?dateFor(r.when,timezone):r.dueDate??null};}
function linkRow(e,timezone){return {id:e.id,type:e.target.modelKey,targetId:e.target.recordId,title:e.targetRecord?targetRow(e.targetRecord,timezone).title:'名称暂不可用',date:e.targetRecord?targetRow(e.targetRecord,timezone).date:null};}
function params(url,allowed,max=40){
  const p=url.searchParams;
  if([...p.keys()].some(k=>!allowed.includes(k)||p.getAll(k).length!==1))return null;
  const limit=p.has('limit')?Number(p.get('limit')):max;
  const cursor=p.get('cursor')||null;
  if(!Number.isInteger(limit)||limit<1||limit>max||cursor&&cursor.length>2048)return null;
  return {p,limit,cursor};
}
async function body(request){
  try{if(Number(request.headers.get('content-length')||0)>65536||!request.body)return null;
    const reader=request.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return null;}chunks.push(value);}}
    finally{reader.releaseLock();}
    return JSON.parse(await new Blob(chunks).text());
  }catch{return null;}
}
function derived(request,method,data){
  const headers=new Headers();
  for(const k of ['authorization','accept','x-request-id']){const v=request.headers.get(k);if(v)headers.set(k,v);}
  if(data!==undefined)headers.set('content-type','application/json');
  return new Request(request.url,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
}
export async function handleMiniHealthBff(request,env,{externalFetch=fetch}={}){
  const url=new URL(request.url);
  if(!url.pathname.startsWith(PREFIX)||!/^\/api\/v1\/miniprogram\/families\/[^/]+\/health(?:\/|$)/u.test(url.pathname))return null;
  const id=request.headers.get('x-request-id')||crypto.randomUUID();
  const fail=(status,code,message)=>errorResponse(status,code,message,id);
  const bad=(message='健康请求参数无效')=>fail(400,'INVALID_HEALTH_REQUEST',message);
  const authorization=authorizationHeader(request);
  if(!authorization)return fail(401,'UNAUTHORIZED','请重新登录');
  const parts=url.pathname.slice(PREFIX.length).split('/');
  const [spaceId,health,...tail]=parts;
  if(health!=='health'||!SPACE.test(spaceId)||!tail.length)return bad();
  const root='/api/v1/spaces/'+spaceId;
  const ok=(value,status=200)=>json({data:value},status,id);
  const core=async(path,method='GET',data)=>forwardLifeSpace(derived(request,method,data),env,{target:'core',upstreamPath:path});
  const read=async(path,method='GET',data)=>{
    const response=await core(path,method,data);
    if(!response.ok)throw response;
    const value=(await response.json().catch(()=>null))?.data;
    if(value===undefined||value===null)throw fail(502,'INVALID_HEALTH_RESPONSE','健康数据暂时不可读取');
    return value;
  };
  const page=async(path,query,kind,timezone='UTC',personId)=>{
    const data=await read(path+'/query','POST',query);
    if(!Array.isArray(data.items)||data.items.some(r=>!RECORD.test(r?.id||'')||(personId&&r.subjectPersonId!==personId)))throw fail(502,'INVALID_HEALTH_RESPONSE','健康记录范围不匹配');
    return ok({items:data.items.map(r=>row(kind,r,timezone)),nextCursor:data.nextCursor??null});
  };
  const members=async()=>{
    const data=await read(root+'/members');
    if(!Array.isArray(data))throw fail(502,'INVALID_HEALTH_RESPONSE','家庭成员暂不可读取');
    return data.filter(m=>PERSON.test(m?.personId||'')&&/^usr_[A-Za-z0-9_-]+$/u.test(m?.userId||''));
  };
  // Product classification, not an authority source. No stored member copy.
  const requireFamily=async()=>{
    if(!env.HOMEMEW_BACKEND?.fetch)throw fail(503,'FAMILY_CATALOG_UNAVAILABLE','家庭目录暂不可用');
    const res=await env.HOMEMEW_BACKEND.fetch(new Request('https://homemew-backend.internal/internal/v1/family-catalog/reconcile',{method:'POST',headers:{'content-type':'application/json','x-request-id':id},body:JSON.stringify({spaceIds:[spaceId]})}));
    if(!res.ok)throw fail(503,'FAMILY_CATALOG_UNAVAILABLE','家庭目录暂不可用');
    const data=(await res.json().catch(()=>null))?.data;
    if(!Array.isArray(data?.familySpaceIds))throw fail(503,'FAMILY_CATALOG_UNAVAILABLE','家庭目录暂不可用');
    if(!data.familySpaceIds.includes(spaceId))throw fail(404,'HEALTH_FAMILY_NOT_FOUND','家庭不可用');
  };
  const sameSubject=async(kind,recordId,personId)=>{
    if(!RECORD.test(recordId||''))throw bad();
    const existing=await read(col(root,kind)+'/'+recordId);
    if(existing.id!==recordId||existing.subjectPersonId!==personId)throw fail(404,'HEALTH_SUBJECT_NOT_FOUND','健康记录不可用');
    return existing;
  };
  const metricName=async(name,except)=>{
    const normalized=name.trim().normalize('NFKC').toLowerCase();let cursor=null;
    for(let i=0;i<4;i++){
      const p=await read(col(root,'metrics')+'/query','POST',{search:{text:name},page:{limit:40,cursor}});
      if(!Array.isArray(p.items))throw fail(502,'INVALID_HEALTH_RESPONSE','指标检查失败');
      if(p.items.some(m=>m.id!==except&&m.name.trim().normalize('NFKC').toLowerCase()===normalized))throw fail(409,'HEALTH_METRIC_DUPLICATE','已存在同名指标，请复用');
      cursor=p.nextCursor;if(!cursor)return;
    }
    throw fail(409,'HEALTH_METRIC_CHECK_INCOMPLETE','同名指标检查未完成');
  };
  const mutation=async(path,method,data,kind,timezone='UTC')=>{
    const response=await core(path,method,data);
    if(!response.ok)return response;
    if(method==='DELETE')return new Response(null,{status:204,headers:{'cache-control':'no-store','x-request-id':id}});
    const saved=(await response.json().catch(()=>null))?.data;
    if(!saved||!RECORD.test(saved.id||''))return fail(502,'INVALID_HEALTH_RESPONSE','操作结果暂不可确认，请刷新');
    return ok(row(kind,saved,timezone),response.status);
  };
  try{
    await requireFamily();
    if(tail.length===1&&tail[0]==='context'){
      if(request.method!=='GET'||url.search)return bad();
      const [people,d]=await Promise.all([members(),read(root+'/_discovery')]);
      if(d.spaceId!==spaceId||!Array.isArray(d.models))return fail(502,'INVALID_HEALTH_RESPONSE','健康权限暂不可用');
      const permissions={};
      for(const [kind,model] of Object.entries(MODELS)){
        const m=d.models.find(x=>x.key===model);
        permissions[kind]={read:Array.isArray(m?.access)&&m.access.includes('read'),write:Array.isArray(m?.access)&&m.access.includes('write')};
      }
      const enums=(kind,field,allowed)=>{const v=d.models.find(m=>m.key===MODELS[kind])?.fields?.find(x=>x.key===field)?.values;return Array.isArray(v)?v.filter(x=>allowed.includes(x)):[];};
      return ok({people:people.map(m=>({userId:m.userId,personId:m.personId,displayName:m.displayName,role:m.role})),permissions,eventTypes:enums('events','eventType',EVENT_TYPES),documentTypes:enums('documents','documentType',DOCUMENT_TYPES)});
    }
    if(tail[0]==='metrics'&&tail.length<=2){
      const recordId=tail[1],path=col(root,'metrics')+(recordId?'/'+recordId:'');
      if(recordId&&!RECORD.test(recordId))return bad();
      if(!recordId&&request.method==='GET'){
        const q=params(url,['limit','cursor','q']);if(!q)return bad();
        const name=q.p.get('q')||'';if(!str(name,160))return bad();
        return await page(path,{...(name?{search:{text:name}}:{}),sort:[{field:'name',direction:'asc'}],page:{limit:q.limit,cursor:q.cursor}},'metrics');
      }
      if(url.search)return bad();
      const v=await body(request);
      if(!recordId&&request.method==='POST'&&keys(v,['name','valueType','defaultUnit'])&&str(v.name,160)&&v.name.trim()&&TYPES.includes(v.valueType)&&opt(v.defaultUnit,80)){
        await metricName(v.name);return mutation(path,'POST',{name:v.name.trim(),valueType:v.valueType,defaultUnit:clean(v.defaultUnit)},'metrics');
      }
      if(recordId&&request.method==='PATCH'&&keys(v,['name','version'])&&str(v.name,160)&&v.name.trim()&&validVersion(v.version)){
        await metricName(v.name,recordId);return mutation(path,'PATCH',{name:v.name.trim(),version:v.version},'metrics');
      }
      return bad('指标仅支持创建或名称修改');
    }
    const [people,personId,kind,recordId,action,edgeId]=tail;
    if(people!=='people'||!PERSON.test(personId||'')||!['measurements','growth','events','documents'].includes(kind)||tail.length>6)return bad();
    if(!(await members()).some(m=>m.personId===personId))return fail(404,'HEALTH_SUBJECT_NOT_FOUND','家庭成员不可用');
    const timezone=url.searchParams.get('timezone')||'UTC';
    if(!validZone(timezone))return bad('时区无效');
    if(kind==='growth'){
      if(recordId||action||edgeId)return bad();
      if(request.method==='GET'){
        const q=params(url,['heightId','weightId'],20);
        const h=q?.p.get('heightId'),w=q?.p.get('weightId');
        if(!q||!RECORD.test(h||'')||!RECORD.test(w||'')||h===w)return bad();
        return await page(col(root,'measurements'),{filter:and([f('subjectPersonId','contains',personId),{or:[f('metricId','contains',h),f('metricId','contains',w)]}]),sort:[{field:'observedDate',direction:'desc'}],page:{limit:20}},'measurements',timezone,personId);
      }
      if(request.method!=='POST'||url.search)return bad();
      const v=await body(request);
      if(!keys(v,['date','entries'])||!validDate(v.date)||!Array.isArray(v.entries)||v.entries.length<1||v.entries.length>2)return bad();
      const ids=new Set(),units=new Set(),operations=[];
      for(const e of v.entries){
        if(!keys(e,['metricId','value','unit'])||!RECORD.test(e.metricId||'')||!['cm','kg'].includes(e.unit)||typeof e.value!=='number'||!Number.isFinite(e.value)||e.value<=0||ids.has(e.metricId)||units.has(e.unit))return bad('身高体重数值无效');
        ids.add(e.metricId);units.add(e.unit);
        const metric=await read(col(root,'metrics')+'/'+e.metricId);
        if(metric.name!==(e.unit==='cm'?'身高':'体重')||metric.valueType!=='number'||metric.defaultUnit!==e.unit)return bad('成长指标定义不匹配');
        operations.push({operation:'create',modelKey:MODELS.measurements,data:{subjectPersonId:personId,metricId:e.metricId,observedDate:v.date,valueNumber:e.value,valueText:null,valueBoolean:null,unit:e.unit,notes:null}});
      }
      const response=await core(root+'/models/batch','POST',{atomicConsistency:true,operations});
      if(!response.ok)return response;
      const result=(await response.json().catch(()=>null))?.data;
      if(result?.atomicConsistency!==true||!Array.isArray(result.items)||result.items.length!==operations.length||result.items.some(item=>item.status!=='succeeded'))
        return fail(502,'HEALTH_GROWTH_UNCONFIRMED','保存结果暂不可确认，请刷新后核对');
      return ok({saved:true},201);
    }
    if(recordId&&!RECORD.test(recordId))return bad();
    const collection=col(root,kind),path=recordId?collection+'/'+recordId:collection;
    if(kind==='documents'&&((!recordId&&!action&&request.method==='POST')||(recordId&&action==='file'&&request.method==='GET'&&!edgeId))){
      if(url.search)return bad();
      // Existing Web File lifecycle, but use only this request's Mini bearer and
      // trusted Core Service Binding. R2 URL validated by the shared helper.
      const coreBase='https://lifespace.internal';
      const fetcher=(u,init)=>u.startsWith(coreBase+'/api/v1/spaces/'+spaceId+'/')
        ? env.LIFESPACE_CORE.fetch(new Request(u,init))
        : validHealthR2Url(u)?externalFetch(u,init):Promise.reject(Error('invalid destination'));
      if(!env.LIFESPACE_CORE?.fetch)return fail(503,'BFF_NOT_CONFIGURED','健康服务暂不可用');
      const res=await handleHealthDocumentFile(request,{fetcher,coreBase,bearer:authorization.slice(7),spaceId,personId,documentId:recordId,id});
      if(recordId||!res.ok)return res;
      const saved=(await res.json().catch(()=>null))?.data;
      if(!saved||saved.subjectPersonId!==personId)return fail(502,'INVALID_HEALTH_RESPONSE','档案保存结果暂不可确认');
      return ok(row('documents',saved),201);
    }
    if(kind==='events'&&recordId&&['links','candidates'].includes(action)){
      await sameSubject('events',recordId,personId);
      const relations=root+'/semantic-relations';
      if(action==='candidates'&&!edgeId&&request.method==='GET'){
        const q=params(url,['type','q','cursor','limit','timezone'],30);
        const type=q?.p.get('type'),search=q?.p.get('q')?.trim();
        if(!q||!['event','task'].includes(type)||!search||!str(search,120))return bad();
        const result=await read(root+'/models/'+type+'/records/query','POST',{search:{text:search},page:{limit:q.limit,cursor:q.cursor}});
        if(!Array.isArray(result.items))return fail(502,'INVALID_HEALTH_RESPONSE','关联搜索失败');
        return ok({items:result.items.map(r=>targetRow(r,timezone)),nextCursor:result.nextCursor??null});
      }
      if(action!=='links')return bad();
      if(edgeId){
        if(!EDGE.test(edgeId)||request.method!=='DELETE'||url.search)return bad();
        const edge=await read(relations+'/'+edgeId);
        if(edge.source?.modelKey!==MODELS.events||edge.source?.recordId!==recordId||edge.predicate!=='relates_to'||!['event','task'].includes(edge.target?.modelKey))return fail(404,'HEALTH_LINK_NOT_FOUND','关联不可用');
        return core(relations+'/'+edgeId,'DELETE');
      }
      if(request.method==='GET'){
        const q=params(url,['cursor','limit','timezone'],30);if(!q)return bad();
        const p=new URLSearchParams({sourceModelKey:MODELS.events,sourceRecordId:recordId,predicate:'relates_to',hydrate:'target',limit:String(q.limit)});
        if(q.cursor)p.set('cursor',q.cursor);
        const data=await read(relations+'?'+p.toString());
        if(!Array.isArray(data.items))return fail(502,'INVALID_HEALTH_RESPONSE','关联读取失败');
        return ok({items:data.items.filter(e=>['event','task'].includes(e.target?.modelKey)).map(e=>linkRow(e,timezone)),nextCursor:data.nextCursor??null});
      }
      if(request.method==='POST'&&!url.search){
        const v=await body(request);
        if(!keys(v,['type','targetId'])||!['event','task'].includes(v.type)||!RECORD.test(v.targetId||''))return bad();
        const result=await core(relations,'POST',{source:ref(MODELS.events,recordId),predicate:'relates_to',target:ref(v.type,v.targetId)});
        return result.ok?ok({saved:true},201):result;
      }
      return bad();
    }
    if(action||edgeId)return bad();
    if(!recordId&&request.method==='GET'){
      const allowed=kind==='measurements'?['limit','cursor','metricId','since']:kind==='events'?['limit','cursor','timezone']:['limit','cursor','documentType'];
      const q=params(url,allowed,kind==='measurements'?30:20);if(!q)return bad();
      const clauses=[f('subjectPersonId','contains',personId)];
      const metricId=q.p.get('metricId'),since=q.p.get('since'),documentType=q.p.get('documentType');
      if(metricId){if(!RECORD.test(metricId))return bad();clauses.push(f('metricId','contains',metricId));}
      if(since){if(!validDate(since))return bad();clauses.push(f('observedDate','gte',since));}
      if(documentType){if(!DOCUMENT_TYPES.includes(documentType))return bad();clauses.push(f('documentType','eq',documentType));}
      return await page(collection,{filter:and(clauses),sort:[{field:kind==='measurements'?'observedDate':kind==='events'?'when':'issuedDate',direction:'desc'}],...(kind==='events'?{context:{viewingTimezone:timezone}}:{}),page:{limit:q.limit,cursor:q.cursor}},kind,timezone,personId);
    }
    if(url.search&&!(kind==='events'&&[...url.searchParams.keys()].every(k=>k==='timezone')))return bad();
    if(recordId&&request.method==='GET')return ok(row(kind,await sameSubject(kind,recordId,personId),timezone));
    if(recordId&&request.method==='DELETE'){
      const v=await body(request);if(!keys(v,['version'])||!validVersion(v.version))return bad();
      await sameSubject(kind,recordId,personId);return mutation(path,'DELETE',{version:v.version},kind,timezone);
    }
    const editing=!!recordId;
    if(request.method!==(editing?'PATCH':'POST'))return bad();
    const v=await body(request);
    if(!obj(v)||(editing?!validVersion(v.version):'version'in v))return bad();
    const existing=editing?await sameSubject(kind,recordId,personId):null;
    let data;
    if(kind==='measurements'){
      if(!keys(v,['metricId','observedDate','valueNumber','valueText','valueBoolean','unit','notes','version'])||!RECORD.test(v.metricId||'')||!validDate(v.observedDate)||!opt(v.unit,80)||!opt(v.notes,4000)||existing&&existing.metricId!==v.metricId)return bad();
      const values=[v.valueNumber,v.valueText,v.valueBoolean].filter(x=>x!==null&&x!==undefined);
      if(values.length!==1||(v.valueNumber!=null&&(typeof v.valueNumber!=='number'||!Number.isFinite(v.valueNumber)))||(v.valueText!=null&&(!str(v.valueText,4000)||!v.valueText.trim()))||(v.valueBoolean!=null&&typeof v.valueBoolean!=='boolean'))return bad('测量值无效');
      data={metricId:v.metricId,observedDate:v.observedDate,valueNumber:v.valueNumber??null,valueText:clean(v.valueText),valueBoolean:v.valueBoolean??null,unit:clean(v.unit),notes:clean(v.notes)};
    }else if(kind==='events'){
      if(!keys(v,['summary','eventType','date','location','description','version'])||!str(v.summary,200)||!v.summary.trim()||!EVENT_TYPES.includes(v.eventType)||!validDate(v.date)||!opt(v.location,300)||!opt(v.description,4000))return bad();
      let when=existing?.when;
      if(when?.kind!=='instant'){
        const duration=when?.kind==='date'&&validDate(when.start)&&validDate(when.endExclusive)?Math.max(1,(Date.parse(when.endExclusive)-Date.parse(when.start))/86400000):1;
        when={kind:'date',start:v.date,endExclusive:dayAfter(v.date,duration)};
      }
      const name=clean(v.location);
      data={summary:v.summary.trim(),eventType:v.eventType,when,location:name?(existing?.location?.name===name?existing.location:{name}):null,description:clean(v.description),...(editing?{}:{status:'active'})};
    }else if(kind==='documents'&&editing){
      if(!keys(v,['title','documentType','issuedDate','issuerName','notes','eventId','version'])||!str(v.title,200)||!v.title.trim()||!DOCUMENT_TYPES.includes(v.documentType)||(v.issuedDate!=null&&v.issuedDate!==''&&!validDate(v.issuedDate))||!opt(v.issuerName,200)||!opt(v.notes,4000)||(v.eventId!=null&&!RECORD.test(v.eventId)))return bad();
      if(Object.hasOwn(v,'eventId')&&v.eventId&&v.eventId!==existing.eventId)await sameSubject('events',v.eventId,personId);
      data={title:v.title.trim(),documentType:v.documentType,issuedDate:v.issuedDate||null,issuerName:clean(v.issuerName),notes:clean(v.notes),...(Object.hasOwn(v,'eventId')?{eventId:v.eventId??null}:{})};
    }else return bad();
    return mutation(path,request.method,{...data,...(editing?{version:v.version}:{subjectPersonId:personId})},kind,timezone);
  }catch(cause){
    if(cause instanceof Response)return cause;
    return fail(502,'HEALTH_SERVICE_UNAVAILABLE','健康服务暂不可用，请重试');
  }
}
