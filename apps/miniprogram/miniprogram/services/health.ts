/** Stable HomeMew Mini health product contract; no LifeSpace wire URLs or AST. */
import {request,downloadHealthTemporaryFile} from './api';
import {productQuery} from './product-routes';
import {UPLOAD_TIMEOUT} from './config';
import {buildMultipartBody} from './media';
import {healthFileType} from '../utils/health-file-type';

export type HealthKind='metrics'|'measurements'|'events'|'documents';
export type HealthTab='overview'|'metrics'|'events'|'documents';
export type ValueType='number'|'text'|'boolean';
export interface HealthRecord {id:string;version:number;subjectPersonId?:string}
export interface HealthMetric extends HealthRecord {name:string;valueType:ValueType;defaultUnit:string|null}
export interface HealthObservation extends HealthRecord {metricId:string;observedDate:string;valueNumber:number|null;valueText:string|null;valueBoolean:boolean|null;unit:string|null;notes:string|null}
export interface HealthEvent extends HealthRecord {summary:string;eventType:string;date:string;timed:boolean;timeLabel:string|null;status:string;location:string|null;description:string|null}
export interface HealthDocument extends HealthRecord {title:string;documentType:string;issuedDate:string|null;issuerName:string|null;notes:string|null;eventId:string|null;hasFile:boolean}
export interface HealthPage<T>{items:T[];nextCursor:string|null}
export interface HealthPerson {personId:string;userId:string;displayName:string;role:string}
export type HealthPermissions=Record<HealthKind,{read:boolean;write:boolean}>;
export interface HealthContext {people:HealthPerson[];permissions:HealthPermissions;eventTypes:string[];documentTypes:string[]}
export interface HealthTarget {id:string;title:string;date:string|null}
export interface HealthLink extends HealthTarget {type:'event'|'task';targetId:string}
export interface PickedHealthFile {path:string;name:string;size:number}
export const HEALTH_MAX_FILE=15*1024*1024;
const root=(familyId:string)=>'/api/v1/miniprogram/families/'+encodeURIComponent(familyId)+'/health';
const subject=(familyId:string,personId:string)=>root(familyId)+'/people/'+encodeURIComponent(personId);
const record=(familyId:string,personId:string,kind:HealthKind,id?:string)=>((kind==='metrics'?root(familyId):subject(familyId,personId))+'/'+kind)+(id?'/'+encodeURIComponent(id):'');
export const getHealthContext=(familyId:string)=>request<HealthContext>(root(familyId)+'/context');
export const listHealthMetrics=(familyId:string,cursor?:string|null)=>request<HealthPage<HealthMetric>>(root(familyId)+'/metrics'+productQuery({limit:40,cursor}));
export const listMeasurements=(familyId:string,personId:string,options:{limit?:number;cursor?:string|null;metricId?:string;since?:string}={})=>request<HealthPage<HealthObservation>>(subject(familyId,personId)+'/measurements'+productQuery(options));
export const listGrowth=(familyId:string,personId:string,heightId:string,weightId:string)=>request<HealthPage<HealthObservation>>(subject(familyId,personId)+'/growth'+productQuery({heightId,weightId}));
export const listHealthEvents=(familyId:string,personId:string,timezone:string,cursor?:string|null)=>request<HealthPage<HealthEvent>>(subject(familyId,personId)+'/events'+productQuery({timezone,limit:20,cursor}));
export const listHealthDocuments=(familyId:string,personId:string,documentType?:string,cursor?:string|null)=>request<HealthPage<HealthDocument>>(subject(familyId,personId)+'/documents'+productQuery({documentType,limit:20,cursor}));
export function saveHealth(familyId:string,personId:string,kind:HealthKind,data:Record<string,unknown>,existing?:HealthRecord,timezone?:string){
  return request<HealthRecord>(record(familyId,personId,kind,existing?.id)+(kind==='events'?productQuery({timezone}):''),{method:existing?'PATCH':'POST',data:{...data,...(existing?{version:existing.version}:{})},skipRetry:true});
}
export const deleteHealth=(familyId:string,personId:string,kind:Exclude<HealthKind,'metrics'>,existing:HealthRecord)=>request<void>(record(familyId,personId,kind,existing.id),{method:'DELETE',data:{version:existing.version},skipRetry:true});
export const saveGrowth=(familyId:string,personId:string,date:string,entries:{metricId:string;unit:'cm'|'kg';value:number}[])=>request<{saved:boolean}>(subject(familyId,personId)+'/growth',{method:'POST',data:{date,entries},skipRetry:true});
const links=(familyId:string,personId:string,eventId:string)=>record(familyId,personId,'events',eventId)+'/links';
export const listHealthLinks=(familyId:string,personId:string,eventId:string,timezone:string,cursor?:string|null)=>request<HealthPage<HealthLink>>(links(familyId,personId,eventId)+productQuery({timezone,cursor,limit:30}));
export const searchHealthTargets=(familyId:string,personId:string,eventId:string,type:'event'|'task',q:string,timezone:string,cursor?:string|null)=>request<HealthPage<HealthTarget>>(record(familyId,personId,'events',eventId)+'/candidates'+productQuery({type,q,timezone,cursor,limit:30}));
export const addHealthLink=(familyId:string,personId:string,eventId:string,type:'event'|'task',targetId:string)=>request(links(familyId,personId,eventId),{method:'POST',data:{type,targetId},skipRetry:true});
export const removeHealthLink=(familyId:string,personId:string,eventId:string,relationId:string)=>request(links(familyId,personId,eventId)+'/'+encodeURIComponent(relationId),{method:'DELETE',skipRetry:true});
export function readTemporaryFile(filePath:string):Promise<ArrayBuffer>{
  return new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath,success:r=>resolve(r.data as ArrayBuffer),fail:()=>reject(Error('无法读取所选文件'))}));
}
export { healthFileType } from '../utils/health-file-type';
export async function uploadHealthDocument(familyId:string,personId:string,file:PickedHealthFile,fields:Record<string,string>){
  if(!file.path||file.size<1||file.size>HEALTH_MAX_FILE)throw Error('请选择不超过15 MB的PDF或图片');
  const bytes=await readTemporaryFile(file.path),type=healthFileType(bytes);
  if(!type||!bytes.byteLength||bytes.byteLength>HEALTH_MAX_FILE)throw Error('文件格式或大小无效');
  const boundary='----HomeMewHealth'+Date.now()+Math.floor(Math.random()*1e9);
  // Content type is inferred from bytes; strip unsafe multipart header characters.
  const stem=file.name.replace(/\.[^.]+$/u,'').replace(/[\u0000-\u001f\u007f"\\\/]/gu,'_').slice(0,140)||'health-document';
  const payload=buildMultipartBody(bytes,stem+'.'+type.ext,type.mime,boundary,fields);
  return request<HealthDocument>(subject(familyId,personId)+'/documents',{method:'POST',data:payload,headers:{'Content-Type':'multipart/form-data; boundary='+boundary},skipRetry:true,timeout:Math.max(UPLOAD_TIMEOUT,60000)});
}
export const downloadHealthDocument=(familyId:string,personId:string,documentId:string)=>downloadHealthTemporaryFile(record(familyId,personId,'documents',documentId)+'/file',HEALTH_MAX_FILE);
export function removeTemporaryFile(filePath:string){if(filePath)wx.getFileSystemManager().unlink({filePath,fail:()=>{}});}
export async function openHealthTemporaryFile(path:string,allowExport=false){
  const bytes=await readTemporaryFile(path),type=healthFileType(bytes);
  if(!type||bytes.byteLength>HEALTH_MAX_FILE)throw Error('档案格式暂不支持');
  return new Promise<void>((resolve,reject)=>{
    const fail=()=>reject(Error('无法打开原始档案'));
    if(type.ext==='pdf')wx.openDocument({filePath:path,fileType:'pdf',showMenu:allowExport,success:()=>resolve(),fail});
    else wx.previewImage({urls:[path],current:path,showmenu:allowExport,success:()=>resolve(),fail});
  });
}
export const eventLabels:Record<string,string>={symptom:'不适症状',injury:'受伤',visit:'就诊',examination:'检查',procedure:'医疗操作',treatment:'治疗',medication_intake:'服药记录',vaccination:'疫苗接种',rehabilitation:'康复',other:'其他'};
export const documentLabels:Record<string,string>={lab_report:'化验报告',imaging_report:'影像报告',physical_exam:'体检报告',prescription:'处方',visit_note:'门诊病历',discharge_summary:'出院记录',rehabilitation_plan:'康复方案',other:'其他'};
export const valueTypeLabels:Record<ValueType,string>={number:'数值',text:'文本',boolean:'是/否'};
