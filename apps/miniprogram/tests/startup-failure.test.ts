import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=(p:string)=>readFileSync(new URL('../miniprogram/'+p,import.meta.url),'utf8');
const executable=(p:string)=>stripTypeScriptTypes(source(p).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,''));
function home(){
  let page:any;let failure:any=null;
  const user={value:null as any},current={value:null as any},families={value:[] as any[]};
  let calls=0,requests=0,navs=0;
  runInNewContext(executable('pages/home/home.ts'),{
    Page:(p:any)=>page=p,AutoRefreshGate:class{},userStore:user,currentFamilyStore:current,familiesStore:families,
    ensureRuntimeReady:async()=>{calls++;if(failure)throw failure;user.value={id:'usr_me',status:'active'};},
    loadFamilies:async()=>{if(failure)throw failure;return families.value;},
    refreshFamilyState:(list:any[])=>{current.value=list[0]||null;return current.value;},
    loadHomeScope:()=> 'me',wx:{navigateTo:()=>navs++,setNavigationBarTitle:()=>{}},
  });
  page.setData=(p:any,cb?:()=>void)=>{Object.assign(page.data,p);cb?.();};
  page._resetFamilyData=()=>{};page._hydrateHomeStartupCache=()=>{};
  page.loadTodayEvents=()=>{requests++;};page.loadTasks=()=>{requests++;};page.loadAttentionDays=()=>{requests++;};page.loadLife=async()=>{requests++;};
  return {page,user,current,families,fail:(e:any)=>failure=e,counts:()=>({calls,requests,navs})};
}
test('cold quota failure cannot render or navigate into no-family onboarding; retry recovers',async()=>{
  const h=home();h.fail({code:'HTTP_503',requestId:'req_quota'});await h.page.loadData();
  assert.equal(h.page.data.contextError,true);assert.equal(h.page.data.loaded,false);assert.equal(h.page.data.loading,false);assert.equal(h.page.data.contextRequestId,'req_quota');
  h.page.onCreateFamily();h.page.onJoinFamily();assert.equal(h.counts().navs,0);assert.equal(h.counts().requests,0);
  h.fail(null);h.families.value=[{id:'spc_home',name:'Synthetic'}];await h.page.loadData(true);
  assert.equal(h.page.data.contextError,false);assert.equal(h.page.data.loaded,true);assert.equal(h.page.data.currentFamily.id,'spc_home');assert.equal(h.counts().requests,4);
});
test('only successful empty bootstrap enables onboarding; later outage hides it',async()=>{
  const h=home();await h.page.loadData();assert.equal(h.page.data.loaded,true);assert.equal(h.page.data.currentFamily,null);
  h.page.onCreateFamily();assert.equal(h.counts().navs,1);
  h.fail({code:'NETWORK_ERROR'});await h.page.loadData(true);
  assert.equal(h.page.data.loaded,false);assert.equal(h.page.data.contextError,true);
  h.page.onCreateFamily();assert.equal(h.counts().navs,1);
});
test('same-scope transient refresh retains view, permission failure clears it',async()=>{
  const h=home();h.families.value=[{id:'spc_home',name:'Synthetic'}];await h.page.loadData();
  h.fail({code:'HTTP_503'});await h.page.loadData(true);
  assert.equal(h.page.data.loaded,true);assert.equal(h.page.data.contextError,true);assert.equal(h.page.data.currentFamily.id,'spc_home');assert.equal(h.counts().requests,4);
  h.fail({code:'FORBIDDEN'});await h.page.loadData(true);assert.equal(h.page.data.currentFamily,null);assert.equal(h.page.data.loaded,false);
});
test('home first-load UI uses mutually exclusive error and confirmed empty branches',()=>{
  const w=source('pages/home/home.wxml');
  assert.match(w,/wx:elif="\{\{contextError\}\}"/);assert.match(w,/wx:elif="\{\{loaded && !loading && !contextError\}\}"/);
});

test('all direct-entry startup failure branches outrank no-family onboarding',()=>{
  for(const p of ['tasks/tasks','events/events','domains/list','football/list']){
    const ts=source('pages/'+p+'.ts'),w=source('pages/'+p+'.wxml');
    assert.match(ts,/initError:\s*true/);
    assert.match(w,/系统暂时不可用/);
    if(p!=='football/list')assert.ok(w.indexOf('{{initError}}')<w.indexOf('{{noFamily}}'));
  }
  assert.match(source('pages/more/more.wxml'),/contextReady/);
});
