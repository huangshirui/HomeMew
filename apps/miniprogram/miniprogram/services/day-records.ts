/** HomeMew “日子” -> LifeSpace day_record Temporal capability。 */

import { request } from './api';
import {
  DayRecord,
  DayRecordKind,
  DayRecordOccurrence,
  CreateDayRecordRequest,
  UpdateDayRecordRequest,
  CreateDayRecordOccurrenceRequest,
  CreateDayRecordOccurrenceResult,
} from '../types/index';
import {
  ResourceBase,
  LifeSpacePage,
  auditActor,
  getSpaceMembers,
  modelRecordPath,
  personRef,
  queryString,
  spacePath,
  userIdToPersonId,
} from './lifespace';

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

type TemporalComputed = {
  today: string;
  state: string;
  attentionLevel: string;
  isAttentionRequired: boolean;
  elapsedDays?: number;
  remainingDays?: number | null;
  progressRatio?: number;
  nextDueDate?: string;
};

type DayRecordResource = ResourceBase & {
  kind: 'elapsed' | 'countdown' | 'cycle';
  name: string;
  description: string | null;
  anchorDate: string;
  subjectPersonId: string | null;
  icon: string | null;
  status: 'active' | 'archived';
  attentionAfterDays: number | null;
  attentionBeforeDays: number | null;
  cycleDays: number | null;
  computed?: { temporal?: TemporalComputed };
};

type OccurrenceResource = {
  id: string;
  recordId: string;
  occurredOn: string;
  note: string | null;
  source: 'initial' | 'manual';
  intervalDays: number | null;
  recordedBy: { type: 'user' | 'service' | 'device'; id: string; displayName: string };
  createdAt: string;
};

function dateDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

async function toDayRecord(spaceId: string, raw: DayRecordResource): Promise<DayRecord> {
  const members = await getSpaceMembers(spaceId);
  const computed = raw.computed?.temporal as DayRecord['computed'];
  const common = {
    id: raw.id,
    familyId: raw.spaceId,
    name: raw.name,
    description: raw.description ?? null,
    subject: personRef(raw.subjectPersonId, members),
    icon: raw.icon ?? null,
    status: raw.status,
    version: raw.version,
    createdBy: auditActor(raw.createdBy),
    updatedBy: auditActor(raw.updatedBy),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (raw.kind === 'elapsed') {
    return {
      ...common,
      kind: 'elapsed',
      anchorDate: raw.anchorDate,
      attentionAfterDays: raw.attentionAfterDays,
      computed: computed as Extract<DayRecord, { kind: 'elapsed' }>['computed'],
    };
  }
  if (raw.kind === 'countdown') {
    return {
      ...common,
      kind: 'countdown',
      anchorDate: raw.anchorDate,
      attentionBeforeDays: raw.attentionBeforeDays,
      computed: computed as Extract<DayRecord, { kind: 'countdown' }>['computed'],
    };
  }
  return {
    ...common,
    kind: 'cycle',
    anchorDate: raw.anchorDate,
    cycleDays: raw.cycleDays ?? 1,
    nextDueDate: raw.computed?.temporal?.nextDueDate ?? raw.anchorDate,
    attentionBeforeDays: raw.attentionBeforeDays,
    computed: computed as Extract<DayRecord, { kind: 'cycle' }>['computed'],
  };
}

export async function listDayRecords(
  familyId: string,
  params: ListDayRecordsParams = {},
): Promise<Page<DayRecord>> {
  const subjectPersonId = params.subjectUserId
    ? await userIdToPersonId(familyId, params.subjectUserId)
    : null;
  const sortMap = {
    attention: 'attention:desc',
    date_asc: 'effectiveDate:asc',
    date_desc: 'effectiveDate:desc',
    created_desc: 'createdAt:desc',
    updated_desc: 'updatedAt:desc',
  } as const;
  const raw = await request<LifeSpacePage<DayRecordResource>>(
    `${spacePath(familyId, 'day-records')}${queryString({
      kind: params.kind,
      status: params.status,
      subjectPersonId: subjectPersonId ?? undefined,
      attentionOnly: params.attentionOnly,
      sort: params.sort ? sortMap[params.sort] : undefined,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
  );
  return {
    items: await Promise.all(raw.items.map(item => toDayRecord(familyId, item))),
    nextCursor: raw.nextCursor,
  };
}

export async function listAttentionDayRecords(familyId: string, maxItems = 100): Promise<DayRecord[]> {
  const items: DayRecord[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const result = await listDayRecords(familyId, {
      status: 'active', attentionOnly: true, sort: 'attention', limit: 50, cursor,
    });
    items.push(...result.items);
    if (items.length >= maxItems) return items.slice(0, maxItems);
    cursor = result.nextCursor;
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }
  return items;
}

export async function getDayRecord(familyId: string, dayRecordId: string): Promise<DayRecord> {
  return toDayRecord(familyId, await request<DayRecordResource>(modelRecordPath(familyId, 'day-records', dayRecordId)));
}

async function writePayload(
  familyId: string,
  data: CreateDayRecordRequest | UpdateDayRecordRequest,
): Promise<Record<string, unknown>> {
  const { subjectUserId, ...rest } = data;
  return {
    ...rest,
    ...(subjectUserId !== undefined ? { subjectPersonId: await userIdToPersonId(familyId, subjectUserId) } : {}),
  } as unknown as Record<string, unknown>;
}

export async function createDayRecord(familyId: string, data: CreateDayRecordRequest): Promise<DayRecord> {
  const raw = await request<DayRecordResource>(spacePath(familyId, 'day-records'), {
    method: 'POST', data: await writePayload(familyId, data), skipRetry: true,
  });
  return toDayRecord(familyId, raw);
}

export async function updateDayRecord(
  familyId: string,
  dayRecordId: string,
  data: UpdateDayRecordRequest,
): Promise<DayRecord> {
  const raw = await request<DayRecordResource>(modelRecordPath(familyId, 'day-records', dayRecordId), {
    method: 'PATCH', data: await writePayload(familyId, data), skipRetry: true,
  });
  return toDayRecord(familyId, raw);
}

export function deleteDayRecord(familyId: string, dayRecordId: string, version: number): Promise<void> {
  return request<void>(modelRecordPath(familyId, 'day-records', dayRecordId), {
    method: 'DELETE', data: { version }, skipRetry: true,
  });
}

export async function listDayRecordOccurrences(
  familyId: string,
  dayRecordId: string,
  params: { limit?: number; cursor?: string | null } = {},
): Promise<Page<DayRecordOccurrence>> {
  const raw = await request<LifeSpacePage<OccurrenceResource>>(
    `${modelRecordPath(familyId, 'day-records', dayRecordId)}/occurrences${queryString(params)}`,
  );
  return {
    items: raw.items.map(item => ({
      id: item.id,
      dayRecordId: item.recordId,
      occurredOn: item.occurredOn,
      note: item.note,
      source: item.source,
      intervalDays: item.intervalDays,
      recordedBy: {
        type: item.recordedBy.type === 'user' ? 'user' : 'system',
        id: item.recordedBy.id,
        name: item.recordedBy.displayName,
        avatarUrl: null,
      },
      createdAt: item.createdAt,
    })),
    nextCursor: raw.nextCursor,
  };
}

export async function createDayRecordOccurrence(
  familyId: string,
  dayRecordId: string,
  data: CreateDayRecordOccurrenceRequest,
): Promise<CreateDayRecordOccurrenceResult> {
  const previous = await getDayRecord(familyId, dayRecordId);
  const raw = await request<DayRecordResource>(
    `${modelRecordPath(familyId, 'day-records', dayRecordId)}/actions/record-occurrence`,
    { method: 'POST', data: data as unknown as Record<string, unknown>, skipRetry: true },
  );
  return {
    previousAnchorDate: previous.anchorDate,
    intervalDays: dateDays(previous.anchorDate, data.occurredOn),
    record: await toDayRecord(familyId, raw),
  };
}

async function stateAction(
  familyId: string,
  dayRecordId: string,
  action: 'archive' | 'restore',
  version: number,
): Promise<DayRecord> {
  const raw = await request<DayRecordResource>(
    `${modelRecordPath(familyId, 'day-records', dayRecordId)}/actions/${action}`,
    { method: 'POST', data: { version }, skipRetry: true },
  );
  return toDayRecord(familyId, raw);
}

export function archiveDayRecord(familyId: string, dayRecordId: string, version: number): Promise<DayRecord> {
  return stateAction(familyId, dayRecordId, 'archive', version);
}
export function restoreDayRecord(familyId: string, dayRecordId: string, version: number): Promise<DayRecord> {
  return stateAction(familyId, dayRecordId, 'restore', version);
}
