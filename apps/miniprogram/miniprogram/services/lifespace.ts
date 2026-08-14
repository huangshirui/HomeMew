import { Actor, PersonRef } from '../types/index';
import { zonedDateTimeToIso } from '../utils/datetime';
import { request } from './api';

export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type SpaceMember = {
  id: string;
  userId: string;
  role: SpaceRole;
  version: number;
  personId: string;
  displayName: string;
  createdAt?: string;
};

export type LifeSpacePage<T> = { items: T[]; nextCursor: string | null };

export type ResourceBase = {
  id: string;
  spaceId: string;
  modelKey: string;
  modelVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function spacePath(spaceId: string, route: string): string {
  return `/api/v1/spaces/${encodeURIComponent(spaceId)}/${route}`;
}

export function modelRecordPath(spaceId: string, route: string, recordId: string): string {
  return `${spacePath(spaceId, route)}/${encodeURIComponent(recordId)}`;
}

export async function getSpaceMembers(spaceId: string): Promise<SpaceMember[]> {
  return request<SpaceMember[]>(spacePath(spaceId, 'members'));
}

export async function getCurrentLifeSpaceUserId(): Promise<string> {
  const me = await request<{ principal: { id: string } }>('/api/v1/me');
  return me.principal.id;
}

export async function currentPersonId(spaceId: string, members?: SpaceMember[]): Promise<string> {
  const [userId, list] = await Promise.all([
    getCurrentLifeSpaceUserId(),
    members ? Promise.resolve(members) : getSpaceMembers(spaceId),
  ]);
  const member = list.find(item => item.userId === userId);
  if (!member) throw new Error('当前用户不是该家庭的有效成员');
  return member.personId;
}

export async function userIdsToPersonIds(spaceId: string, userIds: string[] | undefined): Promise<string[]> {
  if (!userIds?.length) return [];
  const list = await getSpaceMembers(spaceId);
  const personIds: string[] = [];
  for (const userId of userIds) {
    if (userId === 'me') {
      personIds.push(await currentPersonId(spaceId, list));
      continue;
    }
    const member = list.find(item => item.userId === userId);
    if (!member) throw new Error('所选家庭成员已不可用');
    personIds.push(member.personId);
  }
  return [...new Set(personIds)];
}

export async function userIdToPersonId(spaceId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  return (await userIdsToPersonIds(spaceId, [userId]))[0] ?? null;
}

export function personRef(personId: string | null | undefined, members: SpaceMember[]): PersonRef | null {
  if (!personId) return null;
  const member = members.find(item => item.personId === personId);
  if (!member) return null;
  return { userId: member.userId, displayName: member.displayName, avatarUrl: null };
}

export function personRefs(personIds: string[] | undefined, members: SpaceMember[]): PersonRef[] {
  return (personIds ?? [])
    .map(id => personRef(id, members))
    .filter((value): value is PersonRef => value !== null);
}

/**
 * LifeSpace Generic Resource 当前不暴露旧 HomeMew 的 createdBy/updatedBy 展示对象。
 * 保留一个明确的“平台未提供审计展示信息”占位，避免伪造具体成员身份。
 */
export function unavailableActor(): Actor {
  return { type: 'user', id: '', name: '', avatarUrl: null };
}

export function calendarUtcRange(startDate: string, endDateExclusive: string, timezone: string): {
  rangeStart: string;
  rangeEnd: string;
} {
  return {
    rangeStart: zonedDateTimeToIso(startDate, '00:00', timezone),
    rangeEnd: zonedDateTimeToIso(endDateExclusive, '00:00', timezone),
  };
}

export function queryString(values: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
}
