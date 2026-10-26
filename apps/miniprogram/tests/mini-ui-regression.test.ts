import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function source(path:string):string {
  return readFileSync(new URL(`../miniprogram/${path}.ts`,import.meta.url),'utf8');
}
function executable(path:string):string {
  return stripTypeScriptTypes(source(path).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,''));
}
function loadPage(path:string,globals:Record<string,unknown>) {
  let page:any;
  runInNewContext(executable(path),{...globals,Page:(value:any)=>{page=value;}});
  page.setData=(patch:any)=>Object.assign(page.data,patch);
  return page;
}

test('About unlocks diagnostics after five consecutive taps without starting requests',async()=>{
  let clock=10_000,calls=0;
  const page=loadPage('pages/about/about',{
    Date:class extends Date {static now(){return clock;}},
    runCoreLatencyTest:async()=>{calls++;},
  });
  await page.runLatencyTest();assert.equal(calls,0);
  for(let n=0;n<4;n++){page.onLogoTap();clock+=200;}
  assert.equal(page.data.diagnosticsVisible,false);
  page.onLogoTap();assert.equal(page.data.diagnosticsVisible,true);assert.equal(calls,0);
});

test('About resets a partial logo sequence after a pause or leaving the page',()=>{
  let clock=10_000;
  const page=loadPage('pages/about/about',{Date:class extends Date{static now(){return clock;}}});
  for(let n=0;n<4;n++){page.onLogoTap();clock+=100;}
  clock+=2000;page.onLogoTap();assert.equal(page.data.diagnosticsVisible,false);
  page.onHide();
  for(let n=0;n<4;n++){page.onLogoTap();clock+=100;}
  assert.equal(page.data.diagnosticsVisible,false);
  page.onLogoTap();assert.equal(page.data.diagnosticsVisible,true);
});

class AppError extends Error {
  code:string;
  constructor(code:string){super(code);this.code=code;}
}
function webLoginService(request:(...args:any[])=>Promise<unknown>) {
  return runInNewContext(executable('services/web-login').replace(/\bexport /g,'')+';({getWebLogin})',{request,AppError});
}

test('missing mailbox route keeps legacy login usable but never swallows authorization or network errors',async()=>{
  const absent=webLoginService(async()=>{throw new AppError('BFF_ROUTE_NOT_FOUND');});
  assert.equal((await absent.getWebLogin()).available,false);
  for(const code of ['UNAUTHORIZED','FORBIDDEN','USER_NOT_FOUND','TIMEOUT','NETWORK_ERROR']){
    const service=webLoginService(async()=>{throw new AppError(code);});
    await assert.rejects(service.getWebLogin(),(error:any)=>error.code===code);
  }
  const current=webLoginService(async()=>({email:'me@example.com',version:3,linked:true}));
  const account=await current.getWebLogin();
  assert.equal(account.available,true);assert.equal(account.email,'me@example.com');
});

test('Settings keeps profile usable when mailbox loading fails and distinguishes an older server',async()=>{
  const user={id:'usr_one',displayName:'新昵称'};
  let available=true,fail=false;
  const page=loadPage('pages/settings/settings',{
    userStore:{value:null},ensureRuntimeReady:async()=>{},loadCurrentUser:async()=>user,
    getWebLogin:async()=>{if(fail)throw new AppError('TIMEOUT');return{email:null,linked:false,available};},
  });
  fail=true;await page.loadAccount();
  assert.equal(page.data.user,user);assert.equal(page.data.accountError,true);
  fail=false;available=false;await page.loadAccount();
  assert.equal(page.data.accountError,false);assert.equal(page.data.accountLoaded,true);assert.equal(page.data.emailAvailable,false);
});
