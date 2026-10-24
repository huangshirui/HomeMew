import { request } from './api';
import type { LocationDetail } from '../types/index';
export type PlaceSearchResponse = { items: LocationDetail[]; available: boolean; structured: boolean };
export function searchPlaces(query: string): Promise<PlaceSearchResponse> {
  return request(`/api/v1/miniprogram/places/search?q=${encodeURIComponent(query.trim())}`);
}
