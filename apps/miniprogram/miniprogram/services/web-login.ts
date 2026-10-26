import { request, AppError } from './api';

export type WebLogin = { email: string|null; version: number; linked: boolean; status: 'unlinked'|'pending'|'linked'; available?:boolean };
export async function getWebLogin(): Promise<WebLogin> {
  try {
    return {...await request<WebLogin>('/api/v1/miniprogram/me/web-login'),available:true};
  } catch(error) {
    // Only the explicit absent-route response means a pre-email server release.
    // Authentication failures, timeouts and other errors must remain errors.
    if(error instanceof AppError && ['BFF_ROUTE_NOT_FOUND','NOT_FOUND'].includes(error.code))
      return {email:null,version:0,linked:false,status:'unlinked',available:false};
    throw error;
  }
}
export const saveWebLoginEmail = (email: string, version: number): Promise<WebLogin> =>
  request('/api/v1/miniprogram/me/web-login', {method:'PATCH',data:{email,version},skipRetry:true});
