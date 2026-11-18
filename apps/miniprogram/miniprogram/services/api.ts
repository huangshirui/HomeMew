/** Stable HomeMew Mini BFF request boundary. */

import { ErrorResponse } from '../types/index';
import {
  getApplicationBaseUrl,
  generateRequestId,
  REQUEST_TIMEOUT,
} from './config';
import { ensureAccessToken } from './auth';
import { shouldAutoRetry, extractData } from './request-utils';

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

/** Authenticated, bounded download of an existing Mini health document only.
 * Temporary wx.downloadFile path, never an arbitrary upstream/signed URL.
 */
export async function downloadHealthTemporaryFile(path:string, maxBytes=15*1024*1024):Promise<string> {
  if(!/^\/api\/v1\/miniprogram\/families\/spc_[A-Za-z0-9_-]+\/health\/people\/per_[A-Za-z0-9_-]+\/documents\/rec_[A-Za-z0-9_-]+\/file$/u.test(path))
    throw new AppError('INVALID_ROUTE','仅允许当前健康档案下载');
  const remove=(filePath:string)=>{if(filePath)wx.getFileSystemManager().unlink({filePath,fail:()=>{}});};
  async function once(token:string):Promise<{statusCode:number;tempFilePath:string;requestId:string}> {
    const requestId=generateRequestId();
    return new Promise((resolve,reject)=>{
      const task=wx.downloadFile({url:getApplicationBaseUrl()+path,header:{Authorization:'Bearer '+token,'x-request-id':requestId},timeout:60000,
        success:res=>resolve({statusCode:res.statusCode,tempFilePath:res.tempFilePath,requestId}),
        fail:err=>reject(new AppError('DOWNLOAD_FAILED',err.errMsg?.includes('timeout')?'档案读取超时':'档案读取未完成',requestId))});
      task.onProgressUpdate(p=>{if(p.totalBytesWritten>maxBytes||p.totalBytesExpectedToWrite>maxBytes){task.abort();reject(new AppError('HEALTH_FILE_TOO_LARGE','档案超过15 MB',requestId));}});
    });
  }
  let result=await once(await accessTokenOrThrow());
  if(result.statusCode===401){remove(result.tempFilePath);result=await once(await accessTokenOrThrow(true));}
  if(result.statusCode!==200||!result.tempFilePath){remove(result.tempFilePath);throw new AppError('HTTP_'+result.statusCode,'档案不可读取，请检查权限',result.requestId);}
  try{
    const size=await new Promise<number>((resolve,reject)=>wx.getFileSystemManager().getFileInfo({filePath:result.tempFilePath,success:r=>resolve(r.size),fail:()=>reject(new AppError('DOWNLOAD_FAILED','无法读取档案'))}));
    if(size<1||size>maxBytes)throw new AppError('HEALTH_FILE_TOO_LARGE','档案大小无效');
    return result.tempFilePath;
  }catch(cause){remove(result.tempFilePath);throw cause;}
}
