/**
 * 许愿池（Wishes）相关 API 服务
 *
 * 严格按 /apps/core/openapi.yaml 的 Wishes 契约实现。
 *
 * - GET 请求允许 401 自动重试；
 * - 写操作（POST/PATCH/DELETE）显式 skipRetry: true；
 *   认领 / 放弃认领 / 标记实现等状态动作尤其不能重试，避免误覆盖他人的并发操作；
 * - 列表服务返回 { items, nextCursor }，由页面自己控制分页。
 *
 * owner 始终由 Core 设为当前登录用户，客户端不提交 owner / claimant / status。
 */

import { request } from './api';
import {
  Wish,
  CreateWishRequest,
  UpdateWishRequest,
} from '../types/index';

/** 分页结果 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListWishesParams {
  /** 逗号分隔的 status，默认 'open,claimed,fulfilled' */
  status?: string;
  /** 用户 ID 或 'me' */
  ownerUserId?: string;
  /** 用户 ID 或 'me' */
  claimantUserId?: string;
  desiredFrom?: string;
  desiredTo?: string;
  sort?: 'default' | 'desired_asc' | 'created_desc' | 'updated_desc';
  limit?: number;
  cursor?: string | null;
}

function buildQuery(params: Record<string, string | number | null | undefined>): string {
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
 * 列出家庭愿望（单页）
 * GET /api/v1/families/{familyId}/wishes
 */
export function listWishes(
  familyId: string,
  params: ListWishesParams = {},
): Promise<Page<Wish>> {
  const qs = buildQuery({
    status: params.status,
    ownerUserId: params.ownerUserId,
    claimantUserId: params.claimantUserId,
    desiredFrom: params.desiredFrom,
    desiredTo: params.desiredTo,
    sort: params.sort,
    limit: params.limit,
    cursor: params.cursor,
  });
  return request<Page<Wish>>(`/api/v1/families/${familyId}/wishes${qs}`);
}

/**
 * 获取愿望详情
 * GET /api/v1/families/{familyId}/wishes/{wishId}
 */
export function getWish(familyId: string, wishId: string): Promise<Wish> {
  return request<Wish>(`/api/v1/families/${familyId}/wishes/${wishId}`);
}

/**
 * 创建愿望（owner 为当前登录用户，由 Core 决定）
 * POST /api/v1/families/{familyId}/wishes
 */
export function createWish(familyId: string, data: CreateWishRequest): Promise<Wish> {
  return request<Wish>(`/api/v1/families/${familyId}/wishes`, {
    method: 'POST',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 更新自己的愿望（仅 title / description / desiredDate）
 * PATCH /api/v1/families/{familyId}/wishes/{wishId}
 */
export function updateWish(
  familyId: string,
  wishId: string,
  data: UpdateWishRequest,
): Promise<Wish> {
  return request<Wish>(`/api/v1/families/${familyId}/wishes/${wishId}`, {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 软删除自己的愿望
 * DELETE /api/v1/families/{familyId}/wishes/{wishId}?version=N
 */
export function deleteWish(familyId: string, wishId: string, version: number): Promise<void> {
  return request<void>(
    `/api/v1/families/${familyId}/wishes/${wishId}?version=${version}`,
    { method: 'DELETE', skipRetry: true },
  );
}

/** 状态动作统一走 POST + { version }，返回最新 Wish */
function wishAction(
  familyId: string,
  wishId: string,
  action: 'claim' | 'unclaim' | 'fulfill' | 'reopen' | 'archive' | 'restore',
  version: number,
): Promise<Wish> {
  return request<Wish>(`/api/v1/families/${familyId}/wishes/${wishId}/${action}`, {
    method: 'POST',
    data: { version } as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/** 认领其他成员的 open 愿望 */
export function claimWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'claim', version);
}

/** 放弃自己的认领 */
export function unclaimWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'unclaim', version);
}

/** 标记为已实现（owner 或 claimant） */
export function fulfillWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'fulfill', version);
}

/** 重新打开已实现的愿望（owner） */
export function reopenWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'reopen', version);
}

/** 归档自己的愿望 */
export function archiveWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'archive', version);
}

/** 恢复自己已归档的愿望 */
export function restoreWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'restore', version);
}
