import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
const src=(path:string)=>readFileSync(new URL('../miniprogram/'+path,import.meta.url),'utf8');
const route='/api/v1/miniprogram/families/spc_home/health/people/per_a/documents/rec_a/file';
const pdf=new Uint8Array([37,80,68,70,45,49,46,55]).buffer;
function harness(native:any,binary:any){
  const calls:any[]=[],writes:any[]=[],removed:string[]=[],refreshes:boolean[]=[];
  let seq=0;
  const requestTask={abort(){},onHeadersReceived(){}};
  const downloadTask={abort(){},onProgressUpdate(){}};
  const wx={
    env:{USER_DATA_PATH:'wxfile://usr'},
    downloadFile(o:any){calls.push(['download',o.url,o.header]);queueMicrotask(()=>native(o));return downloadTask;},
    request(o:any){calls.push(['request',o.url,o.header,o.responseType]);queueMicrotask(()=>binary(o));return requestTask;},
    getFileSystemManager(){return {getFileInfo(o:any){o.success({size:8});},writeFile(o:any){writes.push(o);o.success();},unlink(o:any){removed.push(o.filePath);},readdir(o:any){o.success({files:[]});}};}
  };
  const type=src('utils/health-file-type.ts').replace(/export function /g,'function ');
  const source=src('services/api.ts').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,'').replace(/export /g,'');
  const impl=runInNewContext(stripTypeScriptTypes(type+'\n'+source)+'\n({downloadHealthTemporaryFile})',{
    wx,ArrayBuffer,Uint8Array,console:{warn(){},error(){}},getApplicationBaseUrl:()=>'https://homemew.example',generateRequestId:()=>String(1700000000000+(++seq))+'-test',ensureAccessToken:async(o:any)=>{refreshes.push(o.forceRefresh);return o.forceRefresh?'fresh':'initial';}
  });
  return {...impl,calls,writes,removed,refreshes};
}
test('native success uses the existing temporary path without duplicate file request',async()=>{
  const h=harness((o:any)=>o.success({statusCode:200,tempFilePath:'wxfile://tmp/file'}),()=>assert.fail('unexpected fallback'));
  assert.equal(await h.downloadHealthTemporaryFile(route),'wxfile://tmp/file');
  assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);
});
test('generic native failure falls back once to the same authenticated route and validates PDF bytes',async()=>{
  const h=harness((o:any)=>o.fail({errMsg:'downloadFile:fail unknown'}),(o:any)=>o.success({statusCode:200,data:pdf}));
  const path=await h.downloadHealthTemporaryFile(route);
  assert.match(path,/homemew-health-preview-.*\.pdf$/);
  assert.equal(h.calls.length,2);assert.equal(h.calls[0][1],h.calls[1][1]);
  assert.equal(h.calls[1][2].Authorization,'Bearer initial');assert.equal(h.calls[1][3],'arraybuffer');
  assert.equal(h.writes[0].filePath,path);assert.equal(h.writes[0].data,pdf);
});
test('never falls back after explicit domain/TLS errors or authorization denial',async()=>{
  for(const error of ['downloadFile:fail url not in domain list','downloadFile:fail SSL handshake error']){
    const h=harness((o:any)=>o.fail({errMsg:error}),()=>assert.fail('unexpected fallback'));
    await assert.rejects(h.downloadHealthTemporaryFile(route));assert.equal(h.calls.length,1);
  }
  const h=harness((o:any)=>o.success({statusCode:403,tempFilePath:'wxfile://tmp/error'}),()=>assert.fail('unexpected fallback'));
  await assert.rejects(h.downloadHealthTemporaryFile(route),(e:any)=>e.code==='HTTP_403'&&!!e.requestId);
  assert.deepEqual(h.removed,['wxfile://tmp/error']);
});
test('fallback shares one 401 refresh and rejects nonfile content and oversize bytes',async()=>{
  let attempt=0;
  const h=harness((o:any)=>o.fail({errMsg:'downloadFile:fail unknown'}),(o:any)=>o.success(++attempt===1?{statusCode:401,data:new ArrayBuffer(0)}:{statusCode:200,data:pdf}));
  await h.downloadHealthTemporaryFile(route);assert.deepEqual(h.refreshes,[false,true]);assert.equal(h.calls[2][2].Authorization,'Bearer fresh');
  const invalid=harness((o:any)=>o.fail({errMsg:'downloadFile:fail unknown'}),(o:any)=>o.success({statusCode:200,data:new Uint8Array([60,104,116,109,108]).buffer}));
  await assert.rejects(invalid.downloadHealthTemporaryFile(route),(e:any)=>e.code==='HEALTH_FILE_INVALID');assert.equal(invalid.writes.length,0);
  const big=harness((o:any)=>o.fail({errMsg:'downloadFile:fail unknown'}),(o:any)=>o.success({statusCode:200,data:pdf}));
  await assert.rejects(big.downloadHealthTemporaryFile(route,4),(e:any)=>e.code==='HEALTH_FILE_TOO_LARGE');assert.equal(big.writes.length,0);
});
