/** HomeMew 日程 -> LifeSpace event Calendar capability。 */

import { request } from './api';
import { Event, CreateEventRequest, UpdateEventRequest } from '../types/index';
import {
  ResourceBase,
  LifeSpacePage,
  auditActor,
  getSpaceMembers,
  modelCollectionPath,
  modelRecordPath,
  personRefs,
  userIdToPersonId,
  userIdsToPersonIds,
} from './lifespace';

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

export interface EventsPage {
  items: Event[];
  nextCursor: string | null;
}

type TemporalRange =
  | { kind: 'instant'; start: string; endExclusive: string }
  | { kind: 'date'; start: string; endExclusive: string };

type EventResource = ResourceBase & {
  summary: string;
  description: string | null;
  location: string | null;
  status: 'active' | 'cancelled';
  attendeePersonIds: string[];
  when: TemporalRange;
};

async function toEvent(spaceId: string, raw: EventResource): Promise<Event> {
  const members = await getSpaceMembers(spaceId);
  const common = {
    id: raw.id,
    familyId: raw.spaceId,
    summary: raw.summary,
    description: raw.description ?? null,
    location: raw.location ?? null,
    status: raw.status,
    attendees: personRefs(raw.attendeePersonIds, members),
    createdBy: auditActor(raw.createdBy),
    updatedBy: auditActor(raw.updatedBy),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (raw.when.kind === 'date') {
    return {
      ...common,
      isAllDay: true,
      startDate: raw.when.start,
      endDateExclusive: raw.when.endExclusive,
    };
  }
  return {
    ...common,
    isAllDay: false,
    startAt: raw.when.start,
    endAt: raw.when.endExclusive,
    startTimezone: null,
    endTimezone: null,
  };
}

export async function fetchEventsPage(
  familyId: string,
  params: ListEventsParams,
): Promise<EventsPage> {
  const attendeePersonId = params.attendeeId
    ? await userIdToPersonId(familyId, params.attendeeId)
    : null;
  const filters: Array<Record<string, unknown>> = [{
    field: 'when',
    op: 'overlaps',
    value: {
      kind: 'local_date_window',
      startDate: params.startDate,
      endDateExclusive: params.endDateExclusive,
      timezone: params.timezone,
    },
  }];
  if (attendeePersonId) filters.push({ field: 'attendeePersonIds', op: 'contains', value: attendeePersonId });
  if (params.status) filters.push({ field: 'status', op: 'eq', value: params.status });
  const raw = await request<LifeSpacePage<EventResource>>(
    `${modelCollectionPath(familyId, 'event')}/query`,
    {
      method: 'POST',
      data: {
        ...(params.q ? { search: { text: params.q } } : {}),
        filter: { and: filters },
        sort: [{ field: 'when', direction: 'asc' }],
        page: { limit: params.limit ?? 100, ...(params.cursor ? { cursor: params.cursor } : {}) },
        context: { viewingTimezone: params.timezone },
      },
    },
  );
  return {
    items: await Promise.all((raw.items ?? []).map(item => toEvent(familyId, item))),
    nextCursor: raw.nextCursor,
  };
}

export async function listEvents(
  familyId: string,
  params: Omit<ListEventsParams, 'cursor' | 'limit'>,
): Promise<Event[]> {
  const items: Event[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const data = await fetchEventsPage(familyId, { ...params, cursor, limit: 100 });
    items.push(...data.items);
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return items;
}

export async function getEvent(familyId: string, eventId: string): Promise<Event> {
  return toEvent(familyId, await request<EventResource>(modelRecordPath(familyId, 'event', eventId)));
}

function eventPayload(data: CreateEventRequest | UpdateEventRequest, attendeePersonIds?: string[]): Record<string, unknown> {
  const {
    attendeeIds,
    isAllDay,
    startAt,
    endAt,
    startDate,
    endDateExclusive,
    startTimezone: _startTimezone,
    endTimezone: _endTimezone,
    ...rest
  } = data;
  const when = isAllDay === true
    ? { kind: 'date', start: startDate, endExclusive: endDateExclusive }
    : isAllDay === false
      ? { kind: 'instant', start: startAt, endExclusive: endAt }
      : undefined;
  return {
    ...rest,
    ...(when ? { when } : {}),
    ...(attendeeIds !== undefined ? { attendeePersonIds: attendeePersonIds ?? [] } : {}),
  };
}

export async function createEvent(familyId: string, data: CreateEventRequest): Promise<Event> {
  const attendeePersonIds = await userIdsToPersonIds(familyId, data.attendeeIds);
  const raw = await request<EventResource>(modelCollectionPath(familyId, 'event'), {
    method: 'POST',
    data: eventPayload(data, attendeePersonIds),
    skipRetry: true,
  });
  return toEvent(familyId, raw);
}

export async function updateEvent(
  familyId: string,
  eventId: string,
  data: UpdateEventRequest,
): Promise<Event> {
  const attendeePersonIds = data.attendeeIds === undefined
    ? undefined
    : await userIdsToPersonIds(familyId, data.attendeeIds);
  const raw = await request<EventResource>(modelRecordPath(familyId, 'event', eventId), {
    method: 'PATCH',
    data: eventPayload(data, attendeePersonIds),
    skipRetry: true,
  });
  return toEvent(familyId, raw);
}

export function deleteEvent(familyId: string, eventId: string, version: number): Promise<void> {
  return request<void>(modelRecordPath(familyId, 'event', eventId), {
    method: 'DELETE',
    data: { version },
    skipRetry: true,
  });
}

export interface BatchCreateItemResult {
  index: number;
  payload: CreateEventRequest;
  event: Event | null;
  error: { code?: string; message?: string; requestId?: string } | null;
}

export interface BatchCreateEventsResult {
  succeeded: Event[];
  failed: BatchCreateItemResult[];
  total: number;
}

export interface CreateEventsBatchOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function createEventsBatch(
  familyId: string,
  payloads: CreateEventRequest[],
  options: CreateEventsBatchOptions = {},
): Promise<BatchCreateEventsResult> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const total = payloads.length;
  const results: BatchCreateItemResult[] = payloads.map((payload, index) => ({
    index, payload, event: null, error: null,
  }));
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const current = cursor;
      if (current >= total) return;
      cursor += 1;
      try {
        results[current].event = await createEvent(familyId, payloads[current]);
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string; requestId?: string };
        results[current].error = { code: err.code, message: err.message, requestId: err.requestId };
      } finally {
        done += 1;
        options.onProgress?.(done, total);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  const succeeded = results.filter(item => item.event).map(item => item.event as Event);
  const failed = results.filter(item => !item.event);
  return { succeeded, failed, total };
}
