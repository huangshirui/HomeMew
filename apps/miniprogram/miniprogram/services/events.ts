/**
 * 日程相关 API 服务
 *
 * - GET 请求允许 401 自动重试
 * - 写操作（POST/PATCH/DELETE）显式 skipRetry: true，避免重复创建
 */

import { request } from './api';
import {
  Event,
  CreateEventRequest,
  UpdateEventRequest,
} from '../types/index';

/** 事件列表查询参数（时间窗口 + 窗口内游标） */
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

/** 单页结果：items + 窗口内翻页游标 */
export interface EventsPage {
  items: Event[];
  nextCursor: string | null;
}

/**
 * 拉取一页日程（不做内部循环，游标由调用方管理）
 *
 * GET /api/v1/families/{familyId}/events
 *
 * @param params.startDate 日历查询窗口起始日期
 * @param params.endDateExclusive 日历查询窗口结束日期（不包含）
 * @param params.attendeeId 仅看指定参与人；传 'me' 表示仅看自己
 * @param params.q 搜索标题、描述和地点
 * @param params.cursor 窗口内翻页游标（仅在同一日期窗口内有效）
 */
export function fetchEventsPage(
  familyId: string,
  params: ListEventsParams,
): Promise<EventsPage> {
  const query: Record<string, string> = {
    startDate: params.startDate,
    endDateExclusive: params.endDateExclusive,
    timezone: params.timezone,
    limit: String(params.limit ?? 100),
  };
  if (params.attendeeId) query.attendeeId = params.attendeeId;
  if (params.status) query.status = params.status;
  if (params.q) query.q = params.q;
  if (params.cursor) query.cursor = params.cursor;

  const qs = '?' + Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return request<EventsPage>(`/api/v1/families/${familyId}/events${qs}`);
}

/**
 * 列出家庭日程（按时间范围，自动拉满窗口内所有分页）
 *
 * 注意：跨窗口的多日事件会同时命中相邻窗口（Core 是重叠查询），
 * 调用方若合并多个窗口结果，必须按 event id 去重。
 */
export async function listEvents(
  familyId: string,
  params: Omit<ListEventsParams, 'cursor' | 'limit'>,
): Promise<Event[]> {
  const items: Event[] = [];
  let cursor: string | undefined;
  // 循环拉取所有分页，保证日历圆点与列表数量完整。
  for (let page = 0; page < 50; page++) {
    const data = await fetchEventsPage(familyId, { ...params, cursor, limit: 100 });
    items.push(...(data.items ?? []));
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return items;
}

/**
 * 获取单个日程详情
 * GET /api/v1/families/{familyId}/events/{eventId}
 */
export function getEvent(familyId: string, eventId: string): Promise<Event> {
  return request<Event>(`/api/v1/families/${familyId}/events/${eventId}`);
}

/**
 * 创建日程
 * POST /api/v1/families/{familyId}/events
 */
export function createEvent(familyId: string, data: CreateEventRequest): Promise<Event> {
  return request<Event>(`/api/v1/families/${familyId}/events`, {
    method: 'POST',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 更新日程
 * PATCH /api/v1/families/{familyId}/events/{eventId}
 */
export function updateEvent(
  familyId: string,
  eventId: string,
  data: UpdateEventRequest,
): Promise<Event> {
  return request<Event>(`/api/v1/families/${familyId}/events/${eventId}`, {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 删除日程（软删除）
 * DELETE /api/v1/families/{familyId}/events/{eventId}?version=N
 */
export function deleteEvent(familyId: string, eventId: string, version: number): Promise<void> {
  return request<void>(
    `/api/v1/families/${familyId}/events/${eventId}?version=${version}`,
    {
      method: 'DELETE',
      skipRetry: true,
    },
  );
}

/** 单条批量创建的结果 */
export interface BatchCreateItemResult {
  index: number;
  payload: CreateEventRequest;
  event: Event | null;
  error: { code?: string; message?: string; requestId?: string } | null;
}

/** 批量创建日程的汇总结果 */
export interface BatchCreateEventsResult {
  succeeded: Event[];
  failed: BatchCreateItemResult[];
  /** 总条数 */
  total: number;
}

export interface CreateEventsBatchOptions {
  /** 最大并发数，默认 3 */
  concurrency?: number;
  /** 每完成一条（无论成功失败）的进度回调 */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 批量创建多个独立日程（Core 当前无批量端点，此处为客户端多次独立 create）。
 *
 * - 仅使用 implemented 的 event create 路由；
 * - 每条都是独立的非幂等写操作，失败项绝不自动重试，避免重复创建；
 * - 失败项保留其原始 payload，供调用方在全部跑完后让用户显式重试；
 * - 写请求已 skipRetry，这里也不对网络错误盲目重试。
 */
export async function createEventsBatch(
  familyId: string,
  payloads: CreateEventRequest[],
  options: CreateEventsBatchOptions = {},
): Promise<BatchCreateEventsResult> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const total = payloads.length;
  const results: BatchCreateItemResult[] = payloads.map((payload, index) => ({
    index,
    payload,
    event: null,
    error: null,
  }));

  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const current = cursor;
      if (current >= total) return;
      cursor += 1;
      try {
        const event = await createEvent(familyId, payloads[current]);
        results[current].event = event;
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string; requestId?: string };
        results[current].error = {
          code: err.code,
          message: err.message,
          requestId: err.requestId,
        };
      } finally {
        done += 1;
        options.onProgress?.(done, total);
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, total) },
    () => worker(),
  );
  await Promise.all(workers);

  const succeeded: Event[] = [];
  const failed: BatchCreateItemResult[] = [];
  for (const r of results) {
    if (r.event) succeeded.push(r.event);
    else failed.push(r);
  }
  return { succeeded, failed, total };
}
