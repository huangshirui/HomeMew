import { Actor, PersonRef } from '../types/index';
import { zonedDateTimeToIso } from '../utils/datetime';
import { request } from './api';
import { AsyncKeyedTtlCache } from './async-keyed-ttl-cache';
import { getUserAvatarUrl } from './config';

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

export type LifeSpaceAuditActor = {
  type: 'user' | 'service' | 'device';
  id: string;
  displayName: string;
};

export type ResourceBase = {
  id: string;
  spaceId: string;
  modelKey: string;
  modelVersion: number;
  version: number;
  createdBy: LifeSpaceAuditActor;
  updatedBy: LifeSpaceAuditActor;
  createdAt: string;
  updatedAt: string;
};

const SPACE_MEMBERS_CACHE_TTL_MS = 30_000;
const spaceMembersCache = new AsyncKeyedTtlCache<SpaceMember[]>(SPACE_MEMBERS_CACHE_TTL_MS);

export function spacePath(spaceId: string, segment: string): string {
  return `/api/v1/spaces/${encodeURIComponent(spaceId)}/${segment}`;
}

export function modelCollectionPath(spaceId: string, modelKey: string): string {
  return `/api/v1/spaces/${encodeURIComponent(spaceId)}/models/${encodeURIComponent(modelKey)}/records`;
}

export function modelRecordPath(spaceId: string, modelKey: string, recordId: string): string {
  return `${modelCollectionPath(spaceId, modelKey)}/${encodeURIComponent(recordId)}`;
}

/**
 * Space Person 映射是多个 HomeMew DTO 适配器的公共依赖。
 * 同一个 Space 在 30 秒内共享一份结果，并对并发 miss 做 single-flight，避免
 * Event / Task / DayRecord / Wish 列表把一次 members 查询放大成 N+1 HTTP 请求。
 * LifeSpace 仍对每个业务请求独立做权限校验；此缓存只用于客户端展示映射。
 */
export function getSpaceMembers(spaceId: string): Promise<SpaceMember[]> {
  return spaceMembersCache.get(
    spaceId,
    () => request<SpaceMember[]>(spacePath(spaceId, 'members')),
  );
}

export function invalidateSpaceMembers(spaceId?: string): void {
  spaceMembersCache.invalidate(spaceId);
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
  return {
    userId: member.userId,
    displayName: member.displayName,
    avatarUrl: getUserAvatarUrl(member.userId),
  };
}

export function personRefs(personIds: string[] | undefined, members: SpaceMember[]): PersonRef[] {
  return (personIds ?? [])
    .map(id => personRef(id, members))
    .filter((value): value is PersonRef => value !== null);
}

/** Map the platform audit principal into HomeMew's legacy UI Actor shape. */
export function auditActor(actor: LifeSpaceAuditActor): Actor {
  return {
    type: actor.type === 'user' ? 'user' : 'system',
    id: actor.id,
    name: actor.displayName,
    avatarUrl: null,
  };
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
