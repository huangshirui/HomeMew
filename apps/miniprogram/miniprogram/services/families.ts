/** HomeMew family product contract through the stable Mini BFF. */

import { request } from './api';
import {
  FamilyListItem, FamilyDetail, CreateFamilyRequest, CreateFamilyResult, UpdateFamilyRequest,
  FamilySummary, FamilyMember, UpdateMemberRoleRequest, InviteCreated, InviteListItem,
  CreateInviteRequest, InvitePreview, JoinFamilyResult,
} from '../types/index';

const base = (familyId: string) => `/api/v1/miniprogram/families/${encodeURIComponent(familyId)}`;

export async function listMyFamilies(): Promise<FamilyListItem[]> {
  return (await request<{ items: FamilyListItem[] }>('/api/v1/miniprogram/families')).items;
}
export function createFamily(data: CreateFamilyRequest): Promise<CreateFamilyResult> {
  return request('/api/v1/miniprogram/families', { method: 'POST', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function getFamily(familyId: string): Promise<FamilyDetail> { return request(base(familyId)); }
export async function isFamilyOwner(familyId: string): Promise<boolean> { return (await getFamily(familyId)).isOwner; }
export function updateFamily(familyId: string, data: UpdateFamilyRequest): Promise<FamilySummary> {
  return request(base(familyId), { method: 'PATCH', data: data as Record<string, unknown>, skipRetry: true });
}
export function closeFamily(familyId: string): Promise<void> {
  return request(`${base(familyId)}/close`, { method: 'POST', data: {}, skipRetry: true });
}
export async function listFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  return (await request<{ items: FamilyMember[] }>(`${base(familyId)}/members`)).items;
}
export function updateMemberRole(
  familyId: string, userId: string, role: 'admin' | 'member',
): Promise<UpdateMemberRoleRequest & { userId: string }> {
  return request(`${base(familyId)}/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH', data: { role }, skipRetry: true,
  });
}
export function removeFamilyMember(familyId: string, userId: string): Promise<void> {
  return request(`${base(familyId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE', skipRetry: true });
}
export function leaveFamily(familyId: string): Promise<void> {
  return request(`${base(familyId)}/leave`, { method: 'POST', skipRetry: true });
}
export function createInvite(familyId: string, data: CreateInviteRequest = {}): Promise<InviteCreated> {
  return request(`${base(familyId)}/invites`, { method: 'POST', data: data as Record<string, unknown>, skipRetry: true });
}
export async function listInvites(familyId: string): Promise<InviteListItem[]> {
  return (await request<{ items: InviteListItem[] }>(`${base(familyId)}/invites`)).items;
}
export function revokeInvite(familyId: string, inviteId: string): Promise<void> {
  return request(`${base(familyId)}/invites/${encodeURIComponent(inviteId)}/revoke`, { method: 'POST', skipRetry: true });
}
export interface FamilyInviteMiniCode {
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  envVersion: 'develop' | 'trial' | 'release';
}

/** One-time image response, never a reusable image URL; no provider secrets in Mini. */
export function generateFamilyInviteMiniCode(
  familyId: string,
  code: string,
  envVersion: FamilyInviteMiniCode['envVersion'],
): Promise<FamilyInviteMiniCode> {
  return request(`${base(familyId)}/invites/mini-code`, {
    method: 'POST', data: { code, envVersion }, skipRetry: true,
  });
}

export function previewInvite(code: string): Promise<InvitePreview> {
  return request('/api/v1/miniprogram/family-invites/preview', { method: 'POST', data: { code }, skipRetry: true });
}
export function joinFamilyByCode(code: string): Promise<JoinFamilyResult> {
  return request('/api/v1/miniprogram/family-invites/join', { method: 'POST', data: { code }, skipRetry: true });
}
