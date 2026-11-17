// Family document transport only. LifeSpace owns the file, record, policy and lifecycle.
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_BYTES + 65536;
const fileId = /^fil_[a-f0-9]{32}$/u;
const recordId = /^rec_[A-Za-z0-9_-]+$/u;
const types = new Map([['pdf','application/pdf'],['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['webp','image/webp']]);
const allowedKeys = new Set(['file','title','documentType','issuedDate','issuerName','notes','eventId']);
const documentTypes = new Set(['lab_report','imaging_report','physical_exam','prescription','visit_note','discharge_summary','rehabilitation_plan','other']);
const json = (data,status,id) => Response.json(data,{status,headers:{'cache-control':'private, no-store','x-request-id':id}});
const fail = (status,code,id) => json({error:{code,message:'健康档案操作未完成，请检查权限或输入后再试。',requestId:id}},status,id);
const statusOf = response => response.status >= 400 && response.status < 500 ? response.status : 502;
function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
}
function readText(form,key,max,required=false) {
  const raw=form.get(key);
  if (raw===null && !required) return '';
  if (typeof raw!=='string' || raw.length>max || (required && !raw.trim()) || /\u0000/u.test(raw)) throw Error('invalid form');
  return raw.trim();
}
export function validHealthR2Url(value) {
  if (typeof value !== 'string') return false;
  try {
    const u=new URL(value);
    return u.protocol==='https:' && !u.port && /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/u.test(u.hostname) && !u.username && !u.password && !u.hash && u.pathname.length>1;
  } catch { return false; }
}
async function boundedForm(request) {
  const contentType=request.headers.get('content-type') || '';
  if (!/^multipart\/form-data;/iu.test(contentType) || Number(request.headers.get('content-length') || 0)>MAX_FORM_BYTES || !request.body) throw Error('invalid form');
  const reader=request.body.getReader();
  const chunks=[]; let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      size+=value.byteLength;
      if(size>MAX_FORM_BYTES) { await reader.cancel(); throw Error('too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), {headers:{'content-type':contentType}}).formData();
}
async function validateUpload(form) {
  if ([...form.keys()].some(k=>!allowedKeys.has(k) || form.getAll(k).length!==1)) throw Error('invalid keys');
  const file=form.get('file');
  if (!(file instanceof File) || !file.size || file.size>MAX_BYTES || !file.name || file.name.length>200 || /[\u0000-\u001f\u007f]/u.test(file.name)) throw Error('invalid file');
  const ext=file.name.toLowerCase().split('.').pop();
  const mime=types.get(ext);
  if (!mime || (file.type && file.type.toLowerCase()!==mime)) throw Error('invalid mime');
  const b=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const ascii=(from,to)=>String.fromCharCode(...b.slice(from,to));
  const magic=mime==='application/pdf' ? ascii(0,5)==='%PDF-' : mime==='image/png' ? [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v) : mime==='image/jpeg' ? b[0]===255&&b[1]===216&&b[2]===255 : ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
  if(!magic) throw Error('invalid file signature');
  const title=readText(form,'title',200,true), documentType=readText(form,'documentType',50,true);
  const issuedDate=readText(form,'issuedDate',10), issuerName=readText(form,'issuerName',200), notes=readText(form,'notes',4000), eventId=readText(form,'eventId',128);
  if (!documentTypes.has(documentType) || (issuedDate && !validDate(issuedDate)) || (eventId && !recordId.test(eventId))) throw Error('invalid metadata');
  return {file,mime,metadata:{title,documentType,issuedDate:issuedDate||null,issuerName:issuerName||null,notes:notes||null,eventId:eventId||null}};
}
export async function handleHealthDocumentFile(request,{fetcher,coreBase,bearer,spaceId,personId,documentId,id}) {
  const root=coreBase+'/api/v1/spaces/'+spaceId;
  const docRoot='/models/health_document/records';
  const core=(path,method='GET',body)=>fetcher(root+path,{method,redirect:'manual',headers:{authorization:'Bearer '+bearer,accept:'application/json','x-request-id':id,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=async response=>(await response.json().catch(()=>null))?.data;
  if(documentId) {
    if(request.method!=='GET')return fail(405,'HEALTH_FILE_METHOD',id);
    try {
      const lookup=await core(docRoot+'/'+documentId);
      if(!lookup.ok)return fail(statusOf(lookup),'HEALTH_DOCUMENT_READ_DENIED',id);
      const record=await data(lookup);
      if(record?.subjectPersonId!==personId || record?.id!==documentId || !fileId.test(record?.artifactRef||''))return fail(404,'HEALTH_FILE_NOT_FOUND',id);
      const signedResponse=await core('/file-downloads','POST',{modelKey:'health_document',recordId:documentId,fieldKey:'artifactRef',fileId:record.artifactRef});
      if(!signedResponse.ok)return fail(statusOf(signedResponse),'HEALTH_FILE_DOWNLOAD_DENIED',id);
      const signed=await data(signedResponse);
      if(signed?.id!==record.artifactRef || !validHealthR2Url(signed?.url))return fail(502,'HEALTH_FILE_DOWNLOAD_INVALID',id);
      const bytes=await fetcher(signed.url,{method:'GET',redirect:'manual'});
      if(!bytes.ok || !bytes.body)return fail(502,'HEALTH_FILE_DOWNLOAD_FAILED',id);
      const name=typeof signed.name==='string' && signed.name.length<=512 ? signed.name : 'health-document';
      const mime=[...types.values()].includes(signed.contentType)?signed.contentType:'application/octet-stream';
      // Attachments only: no same-origin execution of uploaded content or signed URL in browser.
      return new Response(bytes.body,{status:200,headers:{'content-type':mime,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name).replace(/['()*]/gu,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'cache-control':'private, no-store','x-content-type-options':'nosniff','x-request-id':id}});
    } catch { return fail(502,'HEALTH_FILE_DOWNLOAD_FAILED',id); }
  }
  if(request.method!=='POST')return fail(405,'HEALTH_FILE_METHOD',id);
  let input;
  try { input=await validateUpload(await boundedForm(request)); }
  catch { return fail(422,'HEALTH_FILE_INVALID',id); }
  const {file,mime,metadata}=input;
  let readyFile=null;
  let attached=false;
  try {
    // A linked event must belong to this same health subject. Core remains the authority.
    if(metadata.eventId) {
      const event=await core('/models/health_event/records/'+metadata.eventId);
      if(!event.ok)return fail(statusOf(event),'HEALTH_EVENT_LINK_DENIED',id);
      if((await data(event))?.subjectPersonId!==personId)return fail(422,'HEALTH_EVENT_SUBJECT_MISMATCH',id);
    }
    const init=await core('/file-uploads','POST',{modelKey:'health_document',fieldKey:'artifactRef',name:file.name,contentType:mime,size:file.size});
    if(!init.ok)return fail(statusOf(init),'HEALTH_FILE_UPLOAD_DENIED',id);
    const upload=await data(init);
    if(!/^upl_[a-f0-9]{32}$/u.test(upload?.id||'') || upload.destination!=='native' || upload.upload?.method!=='PUT' || !validHealthR2Url(upload.upload?.url))return fail(502,'HEALTH_FILE_UPLOAD_INVALID',id);
    const put=await fetcher(upload.upload.url,{method:'PUT',redirect:'manual',headers:{'content-type':mime},body:file});
    if(!put.ok)return fail(502,'HEALTH_FILE_TRANSFER_FAILED',id);
    const complete=await core('/file-uploads/'+upload.id+'/complete','POST');
    if(!complete.ok)return fail(statusOf(complete),'HEALTH_FILE_FINALIZE_FAILED',id);
    const completed=await data(complete);
    if(!fileId.test(completed?.id||''))return fail(502,'HEALTH_FILE_FINALIZE_INVALID',id);
    readyFile=completed.id;
    const create=await core(docRoot,'POST',{...metadata,subjectPersonId:personId,artifactRef:readyFile});
    if(!create.ok)return fail(statusOf(create),'HEALTH_DOCUMENT_CREATE_FAILED',id);
    // Never delete an attached file: Core also refuses deletion of referenced files.
    attached=true;
    const saved=await data(create);
    if(!recordId.test(saved?.id||'') || saved.subjectPersonId!==personId)return fail(502,'HEALTH_DOCUMENT_RESPONSE_INVALID',id);
    return json({data:saved},201,id);
  } catch { return fail(502,'HEALTH_FILE_UPLOAD_FAILED',id); }
  finally {
    // The platform's governed detached-file delete blocks deletion if a record
    // creation actually committed, including an ambiguous response outcome.
    if(readyFile && !attached) await core('/files/'+readyFile,'DELETE').catch(()=>{});
  }
}
