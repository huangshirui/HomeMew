/** Stable HomeMew Day DTOs through the final Mini BFF. */
import { request } from './api';
import { familyCollection, productQuery } from './product-routes';
import {
  DayRecord, DayRecordKind, DayRecordOccurrence, CreateDayRecordRequest,
  UpdateDayRecordRequest, CreateDayRecordOccurrenceRequest, CreateDayRecordOccurrenceResult,
} from '../types/index';

export interface Page<T> { items: T[]; nextCursor: string | null }
export interface ListDayRecordsParams {
  kind?: DayRecordKind | string;
  status?: string;
  subjectUserId?: string;
  attentionOnly?: boolean;
  sort?: 'attention' | 'date_asc' | 'date_desc' | 'created_desc' | 'updated_desc';
  limit?: number;
  cursor?: string | null;
}
const collection = (familyId: string) => familyCollection(familyId, 'day-records');
const record = (familyId: string, dayRecordId: string) => `${collection(familyId)}/${encodeURIComponent(dayRecordId)}`;
export function listDayRecords(familyId: string, params: ListDayRecordsParams = {}): Promise<Page<DayRecord>> {
  return request(`${collection(familyId)}${productQuery(params)}`);
}
export async function listAttentionDayRecords(familyId: string, subjectUserId?: string, maxItems = 100): Promise<DayRecord[]> {
  const items: DayRecord[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const result = await listDayRecords(familyId, { status: 'active', attentionOnly: true, sort: 'attention', limit: 50, cursor, ...(subjectUserId ? { subjectUserId } : {}) });
    items.push(...result.items);
    if (items.length >= maxItems) return items.slice(0, maxItems);
    cursor = result.nextCursor;
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }
  return items;
}
export function getDayRecord(familyId: string, dayRecordId: string): Promise<DayRecord> { return request(record(familyId, dayRecordId)); }
export function createDayRecord(familyId: string, data: CreateDayRecordRequest): Promise<DayRecord> {
  return request(collection(familyId), { method: 'POST', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function updateDayRecord(familyId: string, dayRecordId: string, data: UpdateDayRecordRequest): Promise<DayRecord> {
  return request(record(familyId, dayRecordId), { method: 'PATCH', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function deleteDayRecord(familyId: string, dayRecordId: string, version: number): Promise<void> {
  return request(record(familyId, dayRecordId), { method: 'DELETE', data: { version }, skipRetry: true });
}
export function listDayRecordOccurrences(familyId: string, dayRecordId: string, params: { limit?: number; cursor?: string | null } = {}): Promise<Page<DayRecordOccurrence>> {
  return request(`${record(familyId, dayRecordId)}/occurrences${productQuery(params)}`);
}
export function createDayRecordOccurrence(familyId: string, dayRecordId: string, data: CreateDayRecordOccurrenceRequest): Promise<CreateDayRecordOccurrenceResult> {
  return request(`${record(familyId, dayRecordId)}/occurrences`, { method: 'POST', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function archiveDayRecord(familyId: string, dayRecordId: string, version: number): Promise<DayRecord> {
  return request(`${record(familyId, dayRecordId)}/archive`, { method: 'POST', data: { version }, skipRetry: true });
}
export function restoreDayRecord(familyId: string, dayRecordId: string, version: number): Promise<DayRecord> {
  return request(`${record(familyId, dayRecordId)}/restore`, { method: 'POST', data: { version }, skipRetry: true });
}

