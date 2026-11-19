/** Stable HomeMew Mini BFF request boundary. */

import { ErrorResponse } from '../types/index';
import {
  getApplicationBaseUrl,
  generateRequestId,
  REQUEST_TIMEOUT,
} from './config';
import { ensureAccessToken } from './auth';
import { shouldAutoRetry, extractData } from './request-utils';
import {healthFileType} from '../utils/health-file-type';

export class AppError extends Error {
  constructor(public code: string, message: string, public requestId?: string) {
    super(message);
    this.name = 'AppError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  data?: Record<string, unknown> | unknown[] | ArrayBuffer;
  headers?: Record<string, string>;
  skipRetry?: boolean;
  timeout?: number;
}

interface WxRequestResult { statusCode: number; data: unknown; requestId: string }

function doRequest(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  data: Record<string, unknown> | unknown[] | ArrayBuffer | undefined,
  headers: Record<string, string>,
  timeout: number,
): Promise<WxRequestResult> {
  const requestId = generateRequestId();
  return new Promise((resolve, reject) => wx.request({
    url,
    method: method as WechatMiniprogram.RequestOption['method'],
    data,
    header: { 'Content-Type': 'application/json', ...headers, 'x-request-id': requestId },
    timeout,
    success: res => resolve({ statusCode: res.statusCode, data: res.data, requestId }),
    fail: err => reject(new AppError(
      err.errMsg?.includes('timeout') ? 'TIMEOUT' : 'NETWORK_ERROR',
      err.errMsg?.includes('timeout') ? '请求超时，请稍后重试' : '网络请求失败，请检查网络连接',
      requestId,
    )),
  }));
}

async function accessTokenOrThrow(forceRefresh = false): Promise<string> {
  try {
    return await ensureAccessToken({ forceRefresh });
  } catch (error) {
    console.error('[API] Silent identity recovery failed:', error);
    throw new AppError('UNAUTHORIZED', '暂时无法验证身份，请稍后重试');
  }
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/api/v1/miniprogram/') || path.includes('://') || path.includes('..')) {
    return Promise.reject(new AppError('INVALID_ROUTE', '仅允许 HomeMew Mini BFF 请求'));
  }
  const { method = 'GET', data, headers = {}, skipRetry = false, timeout = REQUEST_TIMEOUT } = options;
  const url = `${getApplicationBaseUrl()}${path}`;

  return (async () => {
    const token = await accessTokenOrThrow();
    const requestHeaders = { ...headers, Authorization: `Bearer ${token}` };
    const res = await doRequest(url, method, data, requestHeaders, timeout);
    if (res.statusCode >= 200 && res.statusCode < 300) return extractData(res.statusCode, res.data) as T;

    if (res.statusCode === 401 && shouldAutoRetry(method, skipRetry)) {
      const newToken = await accessTokenOrThrow(true);
      const retry = await doRequest(
        url,
        method,
        data,
        { ...requestHeaders, Authorization: `Bearer ${newToken}` },
        timeout,
      );
      if (retry.statusCode >= 200 && retry.statusCode < 300) return extractData(retry.statusCode, retry.data) as T;
      throw buildError(retry.data, retry.statusCode, retry.requestId);
    }

    if (res.statusCode === 401) {
      // Never replay a non-idempotent write blindly. Refresh silently so the
      // user's explicit retry uses a fresh token, then report only that this
      // request did not complete.
      try {
        await ensureAccessToken({ forceRefresh: true });
      } catch (error) {
        console.error('[API] Post-401 identity recovery failed:', error);
      }
    }

    throw buildError(res.data, res.statusCode, res.requestId);
  })();
}

function buildError(responseData: unknown, statusCode: number, requestId: string): AppError {
  const response = responseData as ErrorResponse;
  if (statusCode === 401) {
    return new AppError(
      response?.error?.code || 'UNAUTHORIZED',
      '请求未完成，请重试',
      response?.error?.requestId || requestId,
    );
  }
  if (response?.error) return new AppError(response.error.code, response.error.message, response.error.requestId || requestId);
  const messages: Record<number, string> = {
    400: '请求参数有误', 403: '没有权限执行此操作',
    404: '内容不存在或已被删除', 409: '操作冲突，请刷新后重试',
    422: '提交的数据不符合要求', 500: '服务器内部错误',
  };
  return new AppError(`HTTP_${statusCode}`, messages[statusCode] || `请求失败 (${statusCode})`, requestId);
}

/** Health-only file transport; no generic URL, no raw native errors in logs. */
const HEALTH_FILE_LIMIT=15*1024*1024;
const PREVIEW_PREFIX='homemew-health-preview-';
function nativeReadError(errMsg:string|undefined,requestId:string,transport:'download'|'request'):AppError{
  const msg=(errMsg||'').toLowerCase();
  const prefix=transport==='download'?'DOWNLOAD':'BINARY_REQUEST';
  if(/domain|url not in/.test(msg))return new AppError(prefix+'_DOMAIN','档案读取域名校验失败',requestId);
  if(/ssl|tls|certificat/.test(msg))return new AppError(prefix+'_TLS','档案读取安全连接失败',requestId);
  if(/timeout|timed out/.test(msg))return new AppError(prefix+'_TIMEOUT','档案读取超时',requestId);
  if(/abort|interrupt|cancel/.test(msg))return new AppError(prefix+'_CANCELLED','档案读取已中断',requestId);
  if(/too large|exceed|max size|file size/.test(msg))return new AppError('HEALTH_FILE_TOO_LARGE','档案超过15 MB',requestId);
  return new AppError(prefix+'_FAILED','档案读取未完成',requestId);
}
const removePreviewFile=(filePath:string)=>{if(filePath)wx.getFileSystemManager().unlink({filePath,fail:()=>{}});};
function clearStalePreviewFiles(){
  const root=wx.env.USER_DATA_PATH;
  // Only our own expired scratch files, never other application/user files.
  wx.getFileSystemManager().readdir({dirPath:root,success:r=>{
    for(const name of r.files){
      const match=/^homemew-health-preview-(\d+)-[a-z0-9]+\.(pdf|png|jpg|webp)$/u.exec(name);
      if(match&&Date.now()-Number(match[1])>60*60*1000)removePreviewFile(root+'/'+name);
    }
  },fail:()=>{}});
}
function statusError(status:number,requestId:string):AppError{
  const message=status===403?'没有权限读取档案':status===404?'档案不存在或已被删除':status===401?'暂时无法验证身份，请重试':status===413?'档案超过15 MB':status>=500?'档案服务暂不可用，请稍后重试':'档案读取失败（HTTP '+status+'）';
  return new AppError('HTTP_'+status,message,requestId);
}
export async function downloadHealthTemporaryFile(path:string,maxBytes=HEALTH_FILE_LIMIT):Promise<string>{
  if(!/^\/api\/v1\/miniprogram\/families\/spc_[A-Za-z0-9_-]+\/health\/people\/per_[A-Za-z0-9_-]+\/documents\/rec_[A-Za-z0-9_-]+\/file$/u.test(path))
    throw new AppError('INVALID_ROUTE','仅允许当前健康档案下载');
  maxBytes=Math.min(HEALTH_FILE_LIMIT,maxBytes);
  const url=getApplicationBaseUrl()+path;
  let token=await accessTokenOrThrow(),refreshed=false;
  const refresh=async()=>{refreshed=true;token=await accessTokenOrThrow(true);};
  const header=(requestId:string)=>({Authorization:'Bearer '+token,'x-request-id':requestId,Accept:'application/pdf, image/png, image/jpeg, image/webp','Cache-Control':'no-store'});
  async function nativeOnce():Promise<{statusCode:number;tempFilePath:string;requestId:string}>{
    const requestId=generateRequestId();
    return new Promise((resolve,reject)=>{
      let oversized=false;
      const task=wx.downloadFile({url,header:header(requestId),timeout:60000,
        success:res=>{if(oversized){removePreviewFile(res.tempFilePath);return;}resolve({statusCode:res.statusCode,tempFilePath:res.tempFilePath,requestId});},
        fail:err=>{if(!oversized)reject(nativeReadError(err.errMsg,requestId,'download'));}});
      task.onProgressUpdate(p=>{if(!oversized&&(p.totalBytesWritten>maxBytes||p.totalBytesExpectedToWrite>maxBytes)){
        oversized=true;reject(new AppError('HEALTH_FILE_TOO_LARGE','档案超过15 MB',requestId));task.abort();
      }});
    });
  }
  async function binaryOnce():Promise<{statusCode:number;data:unknown;requestId:string}>{
    const requestId=generateRequestId();
    return new Promise((resolve,reject)=>{
      let oversized=false;
      const task=wx.request({url,method:'GET',header:header(requestId),responseType:'arraybuffer',dataType:'other',timeout:60000,enableCache:false,
        success:res=>{if(!oversized)resolve({statusCode:res.statusCode,data:res.data,requestId});},
        fail:err=>{if(!oversized)reject(nativeReadError(err.errMsg,requestId,'request'));}});
      task.onHeadersReceived?.(res=>{
        const length=Number(Object.entries(res.header||{}).find(([key])=>key.toLowerCase()==='content-length')?.[1]||0);
        if(length>maxBytes&&!oversized){oversized=true;reject(new AppError('HEALTH_FILE_TOO_LARGE','档案超过15 MB',requestId));task.abort();}
      });
    });
  }
  async function binaryFallback():Promise<string>{
    let result=await binaryOnce();
    if(result.statusCode===401&&!refreshed){await refresh();result=await binaryOnce();}
    if(result.statusCode!==200)throw statusError(result.statusCode,result.requestId);
    if(!(result.data instanceof ArrayBuffer)||!result.data.byteLength)throw new AppError('HEALTH_FILE_INVALID','档案返回内容无效',result.requestId);
    if(result.data.byteLength>maxBytes)throw new AppError('HEALTH_FILE_TOO_LARGE','档案超过15 MB',result.requestId);
    const type=healthFileType(result.data);
    if(!type)throw new AppError('HEALTH_FILE_INVALID','档案格式暂不支持',result.requestId);
    clearStalePreviewFiles();
    const filePath=wx.env.USER_DATA_PATH+'/'+PREVIEW_PREFIX+result.requestId+'.'+type.ext;
    const bytes=result.data;
    try{
      await new Promise<void>((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:bytes,success:()=>resolve(),fail:()=>reject(new AppError('HEALTH_FILE_LOCAL_WRITE','无法保存预览临时文件，请检查微信存储空间',result.requestId))}));
      return filePath;
    }catch(cause){removePreviewFile(filePath);throw cause;}
  }
  let result;
  try{
    result=await nativeOnce();
    if(result.statusCode===401&&!refreshed){removePreviewFile(result.tempFilePath);await refresh();result=await nativeOnce();}
  }catch(cause){
    // One alternate transport for native compatibility failure only. Never retry
    // explicit domain/TLS/cancellation/size errors or an HTTP authorization denial.
    if(!(cause instanceof AppError)||cause.code!=='DOWNLOAD_FAILED')throw cause;
    console.warn('[Health file transport]',cause.code,cause.requestId);
    return binaryFallback();
  }
  if(result.statusCode!==200||!result.tempFilePath){removePreviewFile(result.tempFilePath);throw statusError(result.statusCode,result.requestId);}
  try{
    const size=await new Promise<number>((resolve,reject)=>wx.getFileSystemManager().getFileInfo({filePath:result.tempFilePath,success:r=>resolve(r.size),fail:()=>reject(new AppError('HEALTH_FILE_LOCAL_READ','无法读取档案临时文件',result.requestId))}));
    if(size<1||size>maxBytes)throw new AppError('HEALTH_FILE_TOO_LARGE','档案大小无效',result.requestId);
    return result.tempFilePath;
  }catch(cause){removePreviewFile(result.tempFilePath);throw cause;}
}
