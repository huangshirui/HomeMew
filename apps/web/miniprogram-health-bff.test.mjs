import assert from 'node:assert/strict';
import test from 'node:test';
import {handleMiniHealthBff} from './miniprogram-health-bff.mjs';
const root='/api/v1/miniprogram/families/spc_home/health';
const subject=root+'/people/per_me';
const reply=(data,status=200)=>Response.json({data},{status});
const req=(path,method='GET',data,token=true)=>new Request('https://app.test'+path,{method,headers:{...(token?{authorization:'Bearer synthetic-user-token'}:{}),'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
function setup(impl=()=>reply({items:[],nextCursor:null}),family=true){
  const calls=[];
  const env={HOMEMEW_BACKEND:{fetch:async()=>reply({familySpaceIds:family?['spc_home']:[]})},LIFESPACE_CORE:{fetch:async r=>{
    const url=new URL(r.url);assert.equal(r.headers.get('authorization'),'Bearer synthetic-user-token');
    const data=['GET','HEAD'].includes(r.method)?null:await r.json().catch(()=>null);
    calls.push({path:url.pathname,search:url.search,method:r.method,data});
    if(url.pathname.endsWith('/members'))return reply([{personId:'per_me',userId:'usr_me',displayName:'Synthetic',role:'editor'}]);
    return impl(url.pathname,r.method,data,url.search);
  }}};
  return {env,calls};
}
test('health context exposes only four product capabilities and current household members',async()=>{
  const {env,calls}=setup(path=>{assert.ok(path.endsWith('/_discovery'));return reply({spaceId:'spc_home',models:[{key:'health_event',access:['read','write'],fields:[{key:'eventType',values:['visit','unknown']} ]},{key:'task',access:['read'],fields:[]}]});});
  const r=await handleMiniHealthBff(req(root+'/context'),env);
  assert.equal(r.status,200);const d=(await r.json()).data;
  assert.deepEqual(Object.keys(d.permissions),['metrics','measurements','events','documents']);
  assert.deepEqual(d.eventTypes,['visit']);assert.equal(d.people[0].personId,'per_me');assert.equal(d.permissions.events.write,true);assert.equal(d.permissions.documents.read,false);assert.equal(calls.length,2);
});
test('bounded subject query filters server-side and denies wrong subjects, arbitrary paths and query AST',async()=>{
  const {env,calls}=setup(()=>reply({items:[{id:'rec_a',subjectPersonId:'per_me',version:1,metricId:'rec_h',observedDate:'2026-01-01',valueNumber:0}],nextCursor:null}));
  let r=await handleMiniHealthBff(req(subject+'/measurements?limit=12&metricId=rec_h&since=2026-01-01'),env);
  assert.equal(r.status,200);assert.equal((await r.json()).data.items[0].valueNumber,0);
  assert.deepEqual(calls.at(-1).data.filter,{and:[{field:'subjectPersonId',op:'contains',value:'per_me'},{field:'metricId',op:'contains',value:'rec_h'},{field:'observedDate',op:'gte',value:'2026-01-01'}]});
  assert.equal(calls.at(-1).data.page.limit,12);
  for(const path of [subject+'/measurements?limit=100',subject+'/measurements?filter=evil',subject+'/measurements?metricId=bad',root+'/people/per_other/events',root+'/models/task'])assert.ok((await handleMiniHealthBff(req(path),env)).status>=400);
  assert.equal((await handleMiniHealthBff(req(subject+'/events','GET',undefined,false),env)).status,401);
  assert.equal((await handleMiniHealthBff(req(subject+'/events'),setup(undefined,false).env)).status,404);
});
test('scope rejects mismatched returned record and cross-subject edit/delete before writing',async()=>{
  const {env,calls}=setup((p,m)=>m==='GET'?reply({id:'rec_a',subjectPersonId:'per_other',version:1}):reply({items:[{id:'rec_a',subjectPersonId:'per_other'}]}));
  assert.equal((await handleMiniHealthBff(req(subject+'/events'),env)).status,502);
  assert.equal((await handleMiniHealthBff(req(subject+'/events/rec_a','DELETE',{version:1}),env)).status,404);
  assert.equal(calls.filter(c=>c.method==='DELETE').length,0);
});
test('metric rename is bounded, no type/unit update or delete, duplicates rejected',async()=>{
  const {env,calls}=setup(()=>reply({items:[{id:'rec_existing',name:'体重'}],nextCursor:null}));
  assert.equal((await handleMiniHealthBff(req(root+'/metrics','POST',{name:'体重',valueType:'number',defaultUnit:'kg'}),env)).status,409);
  assert.equal((await handleMiniHealthBff(req(root+'/metrics/rec_existing','PATCH',{name:'新名',valueType:'text',version:1}),env)).status,400);
  assert.equal((await handleMiniHealthBff(req(root+'/metrics/rec_existing','DELETE',{version:1}),env)).status,400);
  assert.equal(calls.filter(c=>c.method==='PATCH'||c.method==='DELETE').length,0);
});
test('measurement false is preserved, immutable subject and stale version passed to authority',async()=>{
  const {env,calls}=setup((p,m,d)=>m==='GET'?reply({id:'rec_a',subjectPersonId:'per_me',metricId:'rec_m',version:3}):reply({id:'rec_a',subjectPersonId:'per_me',version:4,...d}));
  const r=await handleMiniHealthBff(req(subject+'/measurements/rec_a','PATCH',{metricId:'rec_m',observedDate:'2026-01-01',valueBoolean:false,version:3}),env);
  assert.equal(r.status,200);assert.equal(calls.at(-1).data.valueBoolean,false);assert.equal(calls.at(-1).data.version,3);assert.ok(!('subjectPersonId'in calls.at(-1).data));
});
test('growth uses one atomic batch and fixed metrics, and event edit preserves precise time',async()=>{
  const when={kind:'instant',start:'2026-01-01T10:00:00Z',endExclusive:'2026-01-01T11:00:00Z'};
  const {env,calls}=setup((p,m,d)=>p.endsWith('/rec_h')?reply({name:'身高',valueType:'number',defaultUnit:'cm'}):p.endsWith('/rec_w')?reply({name:'体重',valueType:'number',defaultUnit:'kg'}):p.endsWith('/batch')?reply({atomicConsistency:true,items:[{status:'succeeded'},{status:'succeeded'}]}):m==='GET'?reply({id:'rec_e',subjectPersonId:'per_me',when,version:2}):reply({id:'rec_e',subjectPersonId:'per_me',version:3,...d}));
  assert.equal((await handleMiniHealthBff(req(subject+'/growth','POST',{date:'2026-01-01',entries:[{metricId:'rec_h',value:150,unit:'cm'},{metricId:'rec_w',value:40,unit:'kg'}]}),env)).status,201);
  assert.equal(calls.at(-1).data.atomicConsistency,true);assert.equal(calls.at(-1).data.operations.length,2);
  assert.equal((await handleMiniHealthBff(req(subject+'/events/rec_e','PATCH',{summary:'Synthetic',eventType:'visit',date:'2026-02-01',version:2}),env)).status,200);
  assert.deepEqual(calls.at(-1).data.when,when);
});
test('document immutable attachment and other subject event rejected',async()=>{
  const {env,calls}=setup(p=>p.includes('health_document')?reply({id:'rec_d',subjectPersonId:'per_me',version:1,artifactRef:'fil_x'}):reply({id:'rec_e',subjectPersonId:'per_other'}));
  assert.equal((await handleMiniHealthBff(req(subject+'/documents/rec_d','PATCH',{title:'Synthetic',documentType:'physical_exam',version:1,artifactRef:'fil_other'}),env)).status,400);
  assert.equal((await handleMiniHealthBff(req(subject+'/documents/rec_d','PATCH',{title:'Synthetic',documentType:'physical_exam',version:1,eventId:'rec_e'}),env)).status,404);
  assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
});
test('health link deletion validates source and target',async()=>{
  const {env,calls}=setup(p=>p.includes('/semantic-relations/')?reply({id:'rel_x',source:{modelKey:'health_event',recordId:'rec_other'},predicate:'relates_to',target:{modelKey:'task',recordId:'rec_task'}}):reply({id:'rec_e',subjectPersonId:'per_me',version:1}));
  assert.equal((await handleMiniHealthBff(req(subject+'/events/rec_e/links/rel_x','DELETE'),env)).status,404);
  assert.equal(calls.filter(c=>c.method==='DELETE').length,0);
});
test('non-health route is not intercepted',async()=>assert.equal(await handleMiniHealthBff(req('/api/v1/miniprogram/families/spc_home/tasks'),{}),null));

test('Mini health file upload/download uses trusted Core binding and does not forward bearer to R2',async()=>{
  const signed='https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com/synthetic/health.pdf?sig=synthetic';
  const fileId='fil_'+'b'.repeat(32),uploadId='upl_'+'c'.repeat(32);
  const calls=[];
  const env={HOMEMEW_BACKEND:{fetch:async()=>reply({familySpaceIds:['spc_home']})},LIFESPACE_CORE:{fetch:async r=>{
    assert.equal(r.headers.get('authorization'),'Bearer synthetic-user-token');
    assert.equal(new URL(r.url).hostname,'lifespace.internal');
    const path=new URL(r.url).pathname;
    const data=r.method==='GET'?null:await r.json().catch(()=>null);
    calls.push({path,method:r.method,data});
    if(path.endsWith('/members'))return reply([{personId:'per_me',userId:'usr_me',displayName:'Synthetic',role:'editor'}]);
    if(path.endsWith('/file-uploads'))return reply({id:uploadId,destination:'native',upload:{method:'PUT',url:signed}},201);
    if(path.endsWith('/complete'))return reply({id:fileId});
    if(path.endsWith('/file-downloads'))return reply({id:fileId,url:signed,contentType:'application/pdf',name:'synthetic.pdf'});
    if(path.endsWith('/records')&&r.method==='POST'){assert.equal(data.subjectPersonId,'per_me');assert.equal(data.artifactRef,fileId);return reply({id:'rec_d',version:1,...data},201);}
    if(path.endsWith('/records/rec_d'))return reply({id:'rec_d',version:1,subjectPersonId:'per_me',artifactRef:fileId,title:'Synthetic',documentType:'physical_exam'});
    throw Error('unexpected '+path);
  }}};
  const externalFetch=async(url,init)=>{assert.equal(url,signed);assert.equal(init.headers?.authorization,undefined);assert.equal(init.redirect,'manual');return init.method==='PUT'?new Response(null,{status:200}):new Response('%PDF-1.7 synthetic',{headers:{'content-type':'application/pdf'}});};
  const form=new FormData();form.set('file',new File(['%PDF-1.7 synthetic'],'synthetic.pdf',{type:'application/pdf'}));form.set('title','Synthetic');form.set('documentType','physical_exam');
  const upload=new Request('https://app.test'+subject+'/documents',{method:'POST',headers:{authorization:'Bearer synthetic-user-token'},body:form});
  const saved=await handleMiniHealthBff(upload,env,{externalFetch});assert.equal(saved.status,201);
  const data=(await saved.json()).data;assert.equal(data.hasFile,true);assert.ok(!('artifactRef'in data));assert.ok(!JSON.stringify(data).includes(signed));
  const download=await handleMiniHealthBff(req(subject+'/documents/rec_d/file'),env,{externalFetch});
  assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'private, no-store');assert.equal(await download.text(),'%PDF-1.7 synthetic');
  assert.ok(calls.some(c=>c.path.endsWith('/file-downloads')&&c.data.recordId==='rec_d'));
});
test('growth response cannot report success when the atomic result is incomplete',async()=>{
  const {env}=setup(p=>p.endsWith('/rec_h')?reply({name:'身高',valueType:'number',defaultUnit:'cm'}):reply({atomicConsistency:true,items:[]}));
  const r=await handleMiniHealthBff(req(subject+'/growth','POST',{date:'2026-01-01',entries:[{metricId:'rec_h',value:150,unit:'cm'}]}),env);
  assert.equal(r.status,502);
});
