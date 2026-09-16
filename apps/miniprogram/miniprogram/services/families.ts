/**
 * HomeMew “家庭”是产品概念；平台侧原生映射为 LifeSpace Space(kind=family)。
 * 本文件保留页面现有 Family DTO，显式在边界处做 Space/role/invite 映射。
 */

import { request } from './api';
import { getCurrentUser } from './users';
import { getUserAvatarUrl } from './config';
import { getSpaceMembers, invalidateSpaceMembers, SpaceMember } from './lifespace';
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

type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
type Space = {
  id: string;
  kind: 'personal' | 'family' | 'team';
  name: string;
  timezone: string;
  avatarUrl: string | null;
  role?: SpaceRole;
  version: number;
  access?: { role?: SpaceRole };
};
type SpaceInvite = {
  id: string;
  token?: string;
  tokenPrefix?: string;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  createdByUserId?: string;
  createdAt: string;
};

function familyRole(role: SpaceRole | undefined): 'admin' | 'member' {
  return role === 'owner' || role === 'admin' ? 'admin' : 'member';
}

function spaceRole(role: 'admin' | 'member'): 'admin' | 'editor' {
  return role === 'admin' ? 'admin' : 'editor';
}

async function members(spaceId: string): Promise<SpaceMember[]> {
  return getSpaceMembers(spaceId);
}

export async function listMyFamilies(): Promise<FamilyListItem[]> {
  const spaces = await request<Space[]>('/api/v1/me/spaces');
  const families = spaces.filter(space => space.kind === 'family');
  return Promise.all(families.map(async space => ({
    id: space.id,
    name: space.name,
    avatarUrl: space.avatarUrl,
    timezone: space.timezone,
    role: familyRole(space.role),
    memberCount: (await members(space.id)).length,
  })));
}

export async function createFamily(data: CreateFamilyRequest): Promise<CreateFamilyResult> {
  const me = await getCurrentUser();
  const created = await request<Space & { ownerPersonId: string }>('/api/v1/spaces', {
    method: 'POST',
    data: {
      kind: 'family',
      name: data.name,
      timezone: data.timezone ?? 'Asia/Shanghai',
      ownerDisplayName: me.displayName,
    },
    skipRetry: true,
  });
  return {
    id: created.id,
    name: created.name,
    avatarUrl: created.avatarUrl,
    timezone: created.timezone,
    role: 'admin',
    memberCount: 1,
    createdAt: new Date().toISOString(),
  };
}

export async function getFamily(familyId: string): Promise<FamilyDetail> {
  const [space, list] = await Promise.all([
    request<Space>(`/api/v1/spaces/${familyId}`),
    members(familyId),
  ]);
  const myUserId = (await request<{ principal: { id: string } }>('/api/v1/me')).principal.id;
  const mine = list.find(item => item.userId === myUserId);
  return {
    id: space.id,
    name: space.name,
    avatarUrl: space.avatarUrl,
    timezone: space.timezone,
    status: 'active',
    createdBy: list.find(item => item.role === 'owner')?.userId ?? '',
    currentUserRole: familyRole(mine?.role ?? space.access?.role),
    memberCount: list.length,
    createdAt: list.find(item => item.role === 'owner')?.createdAt ?? '',
  };
}

export async function isFamilyOwner(familyId: string): Promise<boolean> {
  const [list, me] = await Promise.all([members(familyId), getCurrentUser()]);
  return list.some(member => member.userId === me.id && member.role === 'owner');
}

export async function updateFamily(familyId: string, data: UpdateFamilyRequest): Promise<FamilySummary> {
  const current = await request<Space>(`/api/v1/spaces/${familyId}`);
  const updated = await request<Space>(`/api/v1/spaces/${familyId}`, {
    method: 'PATCH',
    data: { ...data, version: current.version },
    skipRetry: true,
  });
  return {
    id: updated.id,
    name: updated.name,
    avatarUrl: updated.avatarUrl,
    timezone: updated.timezone,
    status: 'active',
  };
}

export async function closeFamily(familyId: string): Promise<void> {
  const current = await request<Space>(`/api/v1/spaces/${familyId}`);
  await request<void>(`/api/v1/spaces/${familyId}/close`, {
    method: 'POST',
    data: { version: current.version },
    skipRetry: true,
  });
  invalidateSpaceMembers(familyId);
}

export async function listFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  return (await members(familyId)).map(member => ({
    userId: member.userId,
    displayName: member.displayName,
    avatarUrl: getUserAvatarUrl(member.userId),
    role: familyRole(member.role),
    joinedAt: member.createdAt ?? '',
    personId: member.personId,
    membershipVersion: member.version,
  } as FamilyMember));
}

export async function updateMemberRole(
  familyId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<UpdateMemberRoleRequest & { userId: string }> {
  const member = (await members(familyId)).find(item => item.userId === userId);
  if (!member) throw new Error('家庭成员不存在');
  const updated = await request<SpaceMember>(`/api/v1/spaces/${familyId}/members/${userId}`, {
    method: 'PATCH',
    data: { role: spaceRole(role), version: member.version },
    skipRetry: true,
  });
  invalidateSpaceMembers(familyId);
  return { userId: updated.userId, role: familyRole(updated.role) };
}

export async function removeFamilyMember(familyId: string, userId: string): Promise<void> {
  await request<void>(`/api/v1/spaces/${familyId}/members/${userId}`, {
    method: 'DELETE',
    skipRetry: true,
  });
  invalidateSpaceMembers(familyId);
}

export async function leaveFamily(familyId: string): Promise<void> {
  await request<void>(`/api/v1/spaces/${familyId}/leave`, {
    method: 'POST',
    skipRetry: true,
  });
  invalidateSpaceMembers(familyId);
}

export async function createInvite(familyId: string, data?: CreateInviteRequest): Promise<InviteCreated> {
  const invite = await request<SpaceInvite>(`/api/v1/spaces/${familyId}/invites`, {
    method: 'POST',
    data: { role: 'editor', ...(data ?? {}) },
    skipRetry: true,
  });
  return {
    id: invite.id,
    code: invite.token ?? '',
    joinPath: `/pages/family/join?code=${encodeURIComponent(invite.token ?? '')}`,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
  };
}

export async function listInvites(familyId: string): Promise<InviteListItem[]> {
  const list = await request<SpaceInvite[]>(`/api/v1/spaces/${familyId}/invites`);
  return list.map(invite => ({
    id: invite.id,
    status: invite.status,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    createdBy: invite.createdByUserId ?? '',
    createdAt: invite.createdAt,
  }));
}

export function revokeInvite(familyId: string, inviteId: string): Promise<void> {
  return request<void>(`/api/v1/spaces/${familyId}/invites/${inviteId}/revoke`, {
    method: 'POST',
    skipRetry: true,
  });
}

export async function previewInvite(code: string): Promise<InvitePreview> {
  const preview = await request<{
    space: { id: string; name: string; avatarUrl?: string | null; memberCount: number };
    expiresAt: string;
    canJoin: boolean;
  }>('/api/v1/space-invites/preview', {
    method: 'POST',
    data: { token: code },
    skipRetry: true,
  });
  return {
    family: {
      id: preview.space.id,
      name: preview.space.name,
      avatarUrl: preview.space.avatarUrl ?? null,
      memberCount: preview.space.memberCount,
    },
    expiresAt: preview.expiresAt,
    canJoin: preview.canJoin,
  };
}

export async function joinFamilyByCode(code: string): Promise<JoinFamilyResult> {
  const me = await getCurrentUser();
  const joined = await request<{
    spaceId: string;
    role: SpaceRole;
    personId?: string;
    joinedAt?: string;
  }>('/api/v1/space-invites/join', {
    method: 'POST',
    data: { token: code, displayName: me.displayName },
    skipRetry: true,
  });
  if (joined.spaceId) invalidateSpaceMembers(joined.spaceId);
  return {
    familyId: joined.spaceId,
    familyName: '',
    role: 'member',
    joinedAt: joined.joinedAt ?? new Date().toISOString(),
  };
}