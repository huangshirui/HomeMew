/**
 * 家庭相关 API 服务
 *
 * 写请求（POST/PATCH/DELETE）默认不自动重试 401（见 api.ts 的 shouldAutoRetry）。
 * 每个写方法都显式设置 skipRetry: true，避免重复提交。
 */

import { request } from './api';
import {
  FamilyListItem,
  FamilyDetail,
  CreateFamilyRequest,
  CreateFamilyResult,
  UpdateFamilyRequest,
  FamilySummary,
  FamilyMember,
  UpdateMemberRoleRequest,
  InviteCreated,
  InviteListItem,
  CreateInviteRequest,
  InvitePreview,
  JoinFamilyResult,
} from '../types/index';

/**
 * 获取当前用户的家庭列表
 * GET /api/v1/me/families
 */
export function listMyFamilies(): Promise<FamilyListItem[]> {
  return request<{ items: FamilyListItem[] }>('/api/v1/me/families')
    .then(data => data.items ?? []);
}

/**
 * 创建家庭
 * POST /api/v1/families
 */
export function createFamily(data: CreateFamilyRequest): Promise<CreateFamilyResult> {
  return request<CreateFamilyResult>('/api/v1/families', {
    method: 'POST',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 获取家庭详情
 * GET /api/v1/families/{familyId}
 */
export function getFamily(familyId: string): Promise<FamilyDetail> {
  return request<FamilyDetail>(`/api/v1/families/${familyId}`);
}

/**
 * 更新家庭资料
 * PATCH /api/v1/families/{familyId}
 * 返回 FamilySummary（不含 role / memberCount）
 */
export function updateFamily(familyId: string, data: UpdateFamilyRequest): Promise<FamilySummary> {
  return request<FamilySummary>(`/api/v1/families/${familyId}`, {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 获取家庭成员列表
 * GET /api/v1/families/{familyId}/members
 */
export function listFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  return request<{ items: FamilyMember[] }>(`/api/v1/families/${familyId}/members`)
    .then(data => data.items ?? []);
}

/**
 * 修改成员角色
 * PATCH /api/v1/families/{familyId}/members/{userId}
 */
export function updateMemberRole(familyId: string, userId: string, role: 'admin' | 'member'): Promise<UpdateMemberRoleRequest & { userId: string }> {
  return request<UpdateMemberRoleRequest & { userId: string }>(`/api/v1/families/${familyId}/members/${userId}`, {
    method: 'PATCH',
    data: { role },
    skipRetry: true,
  });
}

/**
 * 移除成员
 * DELETE /api/v1/families/{familyId}/members/{userId}
 */
export function removeFamilyMember(familyId: string, userId: string): Promise<void> {
  return request<void>(`/api/v1/families/${familyId}/members/${userId}`, {
    method: 'DELETE',
    skipRetry: true,
  });
}

/**
 * 离开家庭
 * POST /api/v1/families/{familyId}/leave
 */
export function leaveFamily(familyId: string): Promise<void> {
  return request<void>(`/api/v1/families/${familyId}/leave`, {
    method: 'POST',
    skipRetry: true,
  });
}

/**
 * 创建邀请
 * POST /api/v1/families/{familyId}/invites
 */
export function createInvite(familyId: string, data?: CreateInviteRequest): Promise<InviteCreated> {
  return request<InviteCreated>(`/api/v1/families/${familyId}/invites`, {
    method: 'POST',
    data: (data ?? {}) as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 获取邀请列表
 * GET /api/v1/families/{familyId}/invites
 */
export function listInvites(familyId: string): Promise<InviteListItem[]> {
  return request<{ items: InviteListItem[] }>(`/api/v1/families/${familyId}/invites`)
    .then(data => data.items ?? []);
}

/**
 * 撤销邀请
 * POST /api/v1/families/{familyId}/invites/{inviteId}/revoke
 */
export function revokeInvite(familyId: string, inviteId: string): Promise<void> {
  return request<void>(`/api/v1/families/${familyId}/invites/${inviteId}/revoke`, {
    method: 'POST',
    skipRetry: true,
  });
}

/**
 * 预览邀请
 * GET /api/v1/family-invites/{code}
 */
export function previewInvite(code: string): Promise<InvitePreview> {
  return request<InvitePreview>(`/api/v1/family-invites/${code}`);
}

/**
 * 通过邀请码加入家庭
 * POST /api/v1/family-invites/{code}/join
 */
export function joinFamilyByCode(code: string): Promise<JoinFamilyResult> {
  return request<JoinFamilyResult>(`/api/v1/family-invites/${code}/join`, {
    method: 'POST',
    skipRetry: true,
  });
}
