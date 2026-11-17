import assert from 'node:assert/strict';
import test from 'node:test';
import {handleHealthDocumentFile,validHealthR2Url} from './health-document-files.mjs';
const signed='https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com/synthetic/path?X-Amz-Signature=synthetic';
const fileId='fil_'+'b'.repeat(32),uploadId='upl_'+'c'.repeat(32),documentId='rec_synthetic';
const ctx={coreBase:'https://core.example.com',bearer:'synthetic-user-token',spaceId:'spc_synthetic',personId:'per_synthetic',id:'synthetic-request'};
const envelope=(value,status=200)=>Response.json({data:value},{status});
function uploadRequest(content='%PDF-1.7 synthetic',type='application/pdf') {
  const form=new FormData();
  form.set('file',new File([content],'synthetic.pdf',{type}));
  form.set('title','Synthetic report');form.set('documentType','physical_exam');form.set('issuedDate','2026-01-01');
  return new Request('https://app.example.com/api/health',{method:'POST',body:form});
}
test('health transfer denies arbitrary host, credentials, port, HTTP and invalid bytes',async()=>{
  assert.equal(validHealthR2Url(signed),true);
  for(const url of ['https://example.com/a','https://'+ 'a'.repeat(32)+'.r2.cloudflarestorage.com.evil/a','http://'+ 'a'.repeat(32)+'.r2.cloudflarestorage.com/a','https://user@'+ 'a'.repeat(32)+'.r2.cloudflarestorage.com/a','https://'+ 'a'.repeat(32)+'.r2.cloudflarestorage.com:8443/a'])assert.equal(validHealthR2Url(url),false);
  let calls=0;
  const res=await handleHealthDocumentFile(uploadRequest('not pdf'),{...ctx,fetcher:async()=>{calls++;throw Error('unexpected');}});
  assert.equal(res.status,422);assert.equal(calls,0);
});
test('upload uses fixed native file field, no bearer to signed R2, and actual subject',async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push([url,init]);
    if(url.endsWith('/file-uploads'))return envelope({id:uploadId,destination:'native',upload:{method:'PUT',url:signed}},201);
    if(url===signed){assert.equal(init.headers.authorization,undefined);assert.equal(init.redirect,'manual');return new Response(null,{status:200});}
    if(url.endsWith('/complete'))return envelope({id:fileId});
    if(url.endsWith('/models/health_document/records'))return envelope({id:documentId,subjectPersonId:ctx.personId},201);
    throw Error('unexpected');
  };
  const res=await handleHealthDocumentFile(uploadRequest(),{...ctx,fetcher});
  assert.equal(res.status,201);assert.equal(calls.length,4);
  assert.equal(JSON.parse(calls[0][1].body).fieldKey,'artifactRef');
  const payload=JSON.parse(calls[3][1].body);
  assert.equal(payload.subjectPersonId,ctx.personId);assert.equal(payload.artifactRef,fileId);
  assert.equal(calls[3][1].headers.authorization,'Bearer '+ctx.bearer);
  assert.equal(res.headers.get('cache-control'),'private, no-store');
});
test('failed attachment creation attempts governed detached-file cleanup',async()=>{
  const paths=[];
  const res=await handleHealthDocumentFile(uploadRequest(),{...ctx,fetcher:async(url,init)=>{
    paths.push([url,init.method]);
    if(url.endsWith('/file-uploads'))return envelope({id:uploadId,destination:'native',upload:{method:'PUT',url:signed}},201);
    if(url===signed)return new Response(null,{status:200});
    if(url.endsWith('/complete'))return envelope({id:fileId});
    if(url.endsWith('/models/health_document/records'))return new Response(null,{status:403});
    if(url.endsWith('/files/'+fileId))return new Response(null,{status:204});
    throw Error('unexpected');
  }});
  assert.equal(res.status,403);assert.deepEqual(paths.at(-1),[ctx.coreBase+'/api/v1/spaces/'+ctx.spaceId+'/files/'+fileId,'DELETE']);
});
test('download rechecks record and selected subject, never signs wrong subject',async()=>{
  let calls=0;
  const request=new Request('https://app.example.com/api/health');
  const res=await handleHealthDocumentFile(request,{...ctx,documentId,fetcher:async()=>{calls++;return envelope({id:documentId,subjectPersonId:'per_other',artifactRef:fileId});}});
  assert.equal(res.status,404);assert.equal(calls,1);
  const result=await handleHealthDocumentFile(request,{...ctx,documentId,fetcher:async(url,init)=>{
    if(url.endsWith('/records/'+documentId))return envelope({id:documentId,subjectPersonId:ctx.personId,artifactRef:fileId});
    if(url.endsWith('/file-downloads')){assert.deepEqual(JSON.parse(init.body),{modelKey:'health_document',recordId:documentId,fieldKey:'artifactRef',fileId});return envelope({id:fileId,url:signed,contentType:'application/pdf',name:'synthetic.pdf'});}
    assert.equal(url,signed);assert.equal(init.headers,undefined);return new Response('%PDF-test');
  }});
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.match(result.headers.get('content-disposition'),/^attachment;/u);
  assert.equal(await result.text(),'%PDF-test');
});
