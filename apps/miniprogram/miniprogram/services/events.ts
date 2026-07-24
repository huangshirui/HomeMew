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

/**
 * 列出家庭日程（按时间范围）
 *
 * GET /api/v1/families/{familyId}/events
 *
 * @param start 起始时间（日期 YYYY-MM-DD 或 RFC 3339），与 end 配对
 * @param end 结束时间（不包含），与 start 配对
 * @param attendeeId 仅看指定参与人；传 'me' 表示仅看自己
 */
export function listEvents(
  familyId: string,
  params?: { start?: string; end?: string; attendeeId?: string; status?: 'active' | 'cancelled' },
): Promise<Event[]> {
  const query: Record<string, string> = {};
  if (params?.start) query.start = params.start;
  if (params?.end) query.end = params.end;
  if (params?.attendeeId) query.attendeeId = params.attendeeId;
  if (params?.status) query.status = params.status;

  const qs = Object.keys(query).length
    ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';

  return request<{ items: Event[]; nextCursor: string | null }>(
    `/api/v1/families/${familyId}/events${qs}`,
  ).then(data => data.items ?? []);
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