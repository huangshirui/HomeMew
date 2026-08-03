/**
 * 日子（Day Records）相关 API 服务
 *
 * 严格按 /apps/core/openapi.yaml 的 Day Records 契约实现。
 *
 * - GET 请求允许 401 自动重试；
 * - 写操作（POST/PATCH/DELETE）显式 skipRetry: true，避免重复创建或重复推进 anchorDate；
 * - 列表服务返回 { items, nextCursor }，由页面自己控制分页，不在服务层自动拉全量。
 */

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

/** 分页结果 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListDayRecordsParams {
  /** 逗号分隔的 kind，例如 'elapsed,cycle'；不传表示全部 */
  kind?: DayRecordKind | string;
  /** 逗号分隔的 status，默认 active */
  status?: string;
  /** 活跃成员 ID 或 'me' */
  subjectUserId?: string;
  attentionOnly?: boolean;
  sort?: 'attention' | 'date_asc' | 'date_desc' | 'created_desc' | 'updated_desc';
  limit?: number;
  cursor?: string | null;
}

function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return '';
  return (
    '?' +
    entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
  );
}

/**
 * 列出日子记录（单页）
 * GET /api/v1/families/{familyId}/day-records
 */
export function listDayRecords(
  familyId: string,
  params: ListDayRecordsParams = {},
): Promise<Page<DayRecord>> {
  const qs = buildQuery({
    kind: params.kind,
    status: params.status,
    subjectUserId: params.subjectUserId,
    attentionOnly: params.attentionOnly === undefined ? undefined : params.attentionOnly,
    sort: params.sort,
    limit: params.limit,
    cursor: params.cursor,
  });
  return request<Page<DayRecord>>(`/api/v1/families/${familyId}/day-records${qs}`);
}

/**
 * 拉取全部「需要关注」的日子。
 *
 * 首页「需要关注」区域需要展示全部当前关注项，因此在此提供一个安全分页的
 * helper：遵循 cursor 分页，并设置条数与页数上限，避免异常 cursor 导致死循环。
 */
export async function listAttentionDayRecords(
  familyId: string,
  maxItems = 100,
): Promise<DayRecord[]> {
  const items: DayRecord[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  for (let page = 0; page < 10; page++) {
    const result: Page<DayRecord> = await listDayRecords(familyId, {
      status: 'active',
      attentionOnly: true,
      sort: 'attention',
      limit: 50,
      cursor,
    });
    items.push(...(result.items ?? []));
    if (items.length >= maxItems) return items.slice(0, maxItems);

    cursor = result.nextCursor;
    // 服务端返回重复 cursor 时立刻停止，防止死循环
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }
  return items;
}

/**
 * 获取日子详情
 * GET /api/v1/families/{familyId}/day-records/{dayRecordId}
 */
export function getDayRecord(familyId: string, dayRecordId: string): Promise<DayRecord> {
  return request<DayRecord>(`/api/v1/families/${familyId}/day-records/${dayRecordId}`);
}

/**
 * 创建日子
 * POST /api/v1/families/{familyId}/day-records
 */
export function createDayRecord(
  familyId: string,
  data: CreateDayRecordRequest,
): Promise<DayRecord> {
  return request<DayRecord>(`/api/v1/families/${familyId}/day-records`, {
    method: 'POST',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 更新日子（仅 active 记录）
 * PATCH /api/v1/families/{familyId}/day-records/{dayRecordId}
 *
 * 注意：elapsed / cycle 的 anchorDate 不能通过本接口修改，需新增 occurrence。
 */
export function updateDayRecord(
  familyId: string,
  dayRecordId: string,
  data: UpdateDayRecordRequest,
): Promise<DayRecord> {
  return request<DayRecord>(`/api/v1/families/${familyId}/day-records/${dayRecordId}`, {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 软删除日子
 * DELETE /api/v1/families/{familyId}/day-records/{dayRecordId}?version=N
 */
export function deleteDayRecord(
  familyId: string,
  dayRecordId: string,
  version: number,
): Promise<void> {
  return request<void>(
    `/api/v1/families/${familyId}/day-records/${dayRecordId}?version=${version}`,
    { method: 'DELETE', skipRetry: true },
  );
}

/**
 * 列出记录历史（Core 保证最新优先）
 * GET /api/v1/families/{familyId}/day-records/{dayRecordId}/occurrences
 */
export function listDayRecordOccurrences(
  familyId: string,
  dayRecordId: string,
  params: { limit?: number; cursor?: string | null } = {},
): Promise<Page<DayRecordOccurrence>> {
  const qs = buildQuery({ limit: params.limit, cursor: params.cursor });
  return request<Page<DayRecordOccurrence>>(
    `/api/v1/families/${familyId}/day-records/${dayRecordId}/occurrences${qs}`,
  );
}

/**
 * 记录一次发生（elapsed「今天又做了」/ cycle「今天已处理」）
 * POST /api/v1/families/{familyId}/day-records/{dayRecordId}/occurrences
 *
 * 返回值包含推进后的最新记录，调用方必须改用返回的 record.version。
 */
export function createDayRecordOccurrence(
  familyId: string,
  dayRecordId: string,
  data: CreateDayRecordOccurrenceRequest,
): Promise<CreateDayRecordOccurrenceResult> {
  return request<CreateDayRecordOccurrenceResult>(
    `/api/v1/families/${familyId}/day-records/${dayRecordId}/occurrences`,
    {
      method: 'POST',
      data: data as unknown as Record<string, unknown>,
      skipRetry: true,
    },
  );
}

/**
 * 归档日子
 * POST /api/v1/families/{familyId}/day-records/{dayRecordId}/archive
 */
export function archiveDayRecord(
  familyId: string,
  dayRecordId: string,
  version: number,
): Promise<DayRecord> {
  return request<DayRecord>(
    `/api/v1/families/${familyId}/day-records/${dayRecordId}/archive`,
    {
      method: 'POST',
      data: { version } as unknown as Record<string, unknown>,
      skipRetry: true,
    },
  );
}

/**
 * 恢复已归档的日子
 * POST /api/v1/families/{familyId}/day-records/{dayRecordId}/restore
 */
export function restoreDayRecord(
  familyId: string,
  dayRecordId: string,
  version: number,
): Promise<DayRecord> {
  return request<DayRecord>(
    `/api/v1/families/${familyId}/day-records/${dayRecordId}/restore`,
    {
      method: 'POST',
      data: { version } as unknown as Record<string, unknown>,
      skipRetry: true,
    },
  );
}
