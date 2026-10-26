import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const source=(p:string)=>readFileSync(new URL('../miniprogram/'+p,import.meta.url),'utf8');
function page(path:string,globals:Record<string,unknown>){let result:any;runInNewContext(stripTypeScriptTypes(source(path).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,'')),{...globals,Page:(p:any)=>{result=p;}});result.setData=(patch:any)=>Object.assign(result.data,patch);return result;}
test('settings shows the same mailbox for code-linked and pre-linked accounts',async()=>{
 let state={email:'me@example.com',version:2,linked:true,status:'linked'};
 const settings=page('pages/settings/settings.ts',{ensureRuntimeReady:async()=>{},getWebLogin:async()=>state});
 await settings.loadAccount();assert.equal(settings.data.loginEmail,'m***@example.com');assert.equal(settings.data.linkStatus,'linked');
 state={...state,linked:false,status:'pending'};await settings.loadAccount();assert.equal(settings.data.linkStatus,'pending');assert.equal(settings.data.accountError,false);
});
test('code linking remains reachable independently of an email declaration',()=>{
 const settings=source('pages/settings/settings.wxml');
 assert.match(settings,/<navigator class="settings-link" url="\/pages\/account-link\/account-link"/);
 assert.doesNotMatch(source('pages/account-link/account-link.ts'),/getWebLogin|redirectTo|EMAIL_LOGIN_CONFIGURED/);
});
test('saving email projects pending proof rather than claiming a completed binding',async()=>{
 let confirmation:any,toast='';
 const form=page('pages/account-email/account-email.ts',{ensureRuntimeReady:async()=>{},getWebLogin:async()=>({email:null,version:0,linked:false,status:'unlinked'}),saveWebLoginEmail:async(email:string,version:number)=>{assert.equal(email,'me@example.com');assert.equal(version,0);return{email,version:1,linked:false,status:'pending'};},AppError:Error,wx:{showModal:(options:any)=>{confirmation=options;options.success({confirm:true});},showToast:(options:any)=>{toast=options.title;},navigateBack:()=>{}}});
 await form.loadAccount();form.data.email='me@example.com';await form.onSave();assert.equal(form.data.linkStatus,'pending');assert.equal(toast,'邮箱已设置');assert.match(confirmation.content,/Web 登录验证后/);
});
