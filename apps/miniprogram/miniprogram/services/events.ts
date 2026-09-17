/** Stable HomeMew Event DTOs through the final Mini BFF. */
import { request } from './api';
import { familyCollection, productQuery } from './product-routes';
import { Event, CreateEventRequest, UpdateEventRequest } from '../types/index';

export interface ListEventsParams {
  startDate: string;
  endDateExclusive: string;
  timezone: string;
  attendeeId?: string;
  status?: 'active' | 'cancelled';
  q?: string;
  cursor?: string;
  limit?: number;
}
export interface EventsPage { items: Event[]; nextCursor: string | null }
const collection = (familyId: string) => familyCollection(familyId, 'events');
const record = (familyId: string, eventId: string) => `${collection(familyId)}/${encodeURIComponent(eventId)}`;

export function fetchEventsPage(familyId: string, params: ListEventsParams): Promise<EventsPage> {
  return request(`${collection(familyId)}${productQuery({ ...params, limit: params.limit ?? 100 })}`);
}
export async function listEvents(familyId: string, params: Omit<ListEventsParams, 'cursor' | 'limit'>): Promise<Event[]> {
  const items: Event[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await fetchEventsPage(familyId, { ...params, cursor, limit: 100 });
    items.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return items;
}
export function getEvent(familyId: string, eventId: string): Promise<Event> {
  return request(record(familyId, eventId));
}
export function createEvent(familyId: string, data: CreateEventRequest): Promise<Event> {
  return request(collection(familyId), { method: 'POST', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function updateEvent(familyId: string, eventId: string, data: UpdateEventRequest): Promise<Event> {
  return request(record(familyId, eventId), { method: 'PATCH', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function deleteEvent(familyId: string, eventId: string, version: number): Promise<void> {
  return request(record(familyId, eventId), { method: 'DELETE', data: { version }, skipRetry: true });
}

export interface BatchCreateItemResult {
  index: number;
  payload: CreateEventRequest;
  event: Event | null;
  error: { code?: string; message?: string; requestId?: string } | null;
}
export interface BatchCreateEventsResult { succeeded: Event[]; failed: BatchCreateItemResult[]; total: number }
export interface CreateEventsBatchOptions { concurrency?: number; onProgress?: (done: number, total: number) => void }
export async function createEventsBatch(familyId: string, payloads: CreateEventRequest[], options: CreateEventsBatchOptions = {}): Promise<BatchCreateEventsResult> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const total = payloads.length;
  const results: BatchCreateItemResult[] = payloads.map((payload, index) => ({ index, payload, event: null, error: null }));
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const current = cursor;
      if (current >= total) return;
      cursor += 1;
      try { results[current].event = await createEvent(familyId, payloads[current]); }
      catch (error: unknown) {
        const err = error as { code?: string; message?: string; requestId?: string };
        results[current].error = { code: err.code, message: err.message, requestId: err.requestId };
      } finally { done += 1; options.onProgress?.(done, total); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { succeeded: results.filter(item => item.event).map(item => item.event as Event), failed: results.filter(item => !item.event), total };
}
