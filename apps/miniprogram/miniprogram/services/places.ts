import { request } from './api';
import type { LocationDetail } from '../types/index';
export type PlaceSearchResponse={items:LocationDetail[];available:boolean;structured:boolean};
export type RecentPlacesResult={items:{location:LocationDetail;lastUsedAt:string;useCount:number}[];
  enabled:boolean;structured:boolean};
export function searchPlaces(query:string):Promise<PlaceSearchResponse>{
 return request('/api/v1/miniprogram/places/search?q='+encodeURIComponent(query.trim()));
}
export function listRecentPlaces():Promise<RecentPlacesResult>{
 return request('/api/v1/miniprogram/places/recent');
}
export function rememberRecentPlace(location:LocationDetail):Promise<RecentPlacesResult>{
 return request('/api/v1/miniprogram/places/recent',{method:'POST',
  data:{location} as unknown as Record<string,unknown>,skipRetry:true});
}
