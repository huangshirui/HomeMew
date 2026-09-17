/** Stable HomeMew Wish DTOs through the final Mini BFF. */
import { request } from './api';
import { familyCollection, productQuery } from './product-routes';
import { Wish, CreateWishRequest, UpdateWishRequest } from '../types/index';

export interface Page<T> { items: T[]; nextCursor: string | null }
export interface ListWishesParams {
  status?: 'open' | 'fulfilled';
  ownerUserId?: string;
  desiredFrom?: string;
  desiredTo?: string;
  sort?: 'default' | 'desired_asc' | 'created_desc' | 'updated_desc';
  limit?: number;
  cursor?: string | null;
}
const collection = (familyId: string) => familyCollection(familyId, 'wishes');
const record = (familyId: string, wishId: string) => `${collection(familyId)}/${encodeURIComponent(wishId)}`;
export function listWishes(familyId: string, params: ListWishesParams = {}): Promise<Page<Wish>> {
  return request(`${collection(familyId)}${productQuery(params)}`);
}
export function getWish(familyId: string, wishId: string): Promise<Wish> { return request(record(familyId, wishId)); }
export function createWish(familyId: string, data: CreateWishRequest): Promise<Wish> {
  return request(collection(familyId), { method: 'POST', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function updateWish(familyId: string, wishId: string, data: UpdateWishRequest): Promise<Wish> {
  return request(record(familyId, wishId), { method: 'PATCH', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function deleteWish(familyId: string, wishId: string, version: number): Promise<void> {
  return request(record(familyId, wishId), { method: 'DELETE', data: { version }, skipRetry: true });
}
export function fulfillWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return request(`${record(familyId, wishId)}/fulfill`, { method: 'POST', data: { version }, skipRetry: true });
}
export function reopenWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return request(`${record(familyId, wishId)}/reopen`, { method: 'POST', data: { version }, skipRetry: true });
}
