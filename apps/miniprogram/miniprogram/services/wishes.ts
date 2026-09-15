/** HomeMew 许愿池 -> LifeSpace wish model。 */

import { request } from './api';
import { andFilters, queryModelRecords, type CanonicalQueryFilter } from './canonical-query';
import { Wish, CreateWishRequest, UpdateWishRequest, PersonRef } from '../types/index';
import {
  ResourceBase,
  auditActor,
  currentPersonId,
  getSpaceMembers,
  modelCollectionPath,
  modelRecordPath,
  personRef,
  userIdToPersonId,
} from './lifespace';

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface ListWishesParams {
  status?: 'open' | 'fulfilled';
  ownerUserId?: string;
  desiredFrom?: string;
  desiredTo?: string;
  sort?: 'default' | 'desired_asc' | 'created_desc' | 'updated_desc';
  limit?: number;
  cursor?: string | null;
}

type WishResource = ResourceBase & {
  title: string;
  description: string | null;
  desiredDate: string | null;
  status: 'open' | 'fulfilled';
  ownerPersonId: string;
  fulfilledAt: string | null;
};

function missingPerson(): PersonRef {
  return { userId: '', displayName: '已离开成员', avatarUrl: null };
}

async function toWish(spaceId: string, raw: WishResource): Promise<Wish> {
  const members = await getSpaceMembers(spaceId);
  return {
    id: raw.id,
    familyId: raw.spaceId,
    title: raw.title,
    description: raw.description ?? null,
    desiredDate: raw.desiredDate ?? null,
    status: raw.status,
    owner: personRef(raw.ownerPersonId, members) ?? missingPerson(),
    fulfilledAt: raw.fulfilledAt ?? null,
    createdBy: auditActor(raw.createdBy),
    updatedBy: auditActor(raw.updatedBy),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function listWishes(
  familyId: string,
  params: ListWishesParams = {},
): Promise<Page<Wish>> {
  const ownerPersonId = params.ownerUserId
    ? await userIdToPersonId(familyId, params.ownerUserId)
    : null;
  const sortMap = {
    default: 'desiredDate:asc',
    desired_asc: 'desiredDate:asc',
    created_desc: 'createdAt:desc',
    updated_desc: 'updatedAt:desc',
  } as const;
  const filters: CanonicalQueryFilter[] = [];
  if (params.status) filters.push({ field: 'status', op: 'eq', value: params.status });
  if (ownerPersonId) filters.push({ field: 'ownerPersonId', op: 'contains', value: ownerPersonId });
  if (params.desiredFrom) filters.push({ field: 'desiredDate', op: 'gte', value: params.desiredFrom });
  if (params.desiredTo) filters.push({ field: 'desiredDate', op: 'lte', value: params.desiredTo });
  const [sortField, sortDirection] = (params.sort ? sortMap[params.sort] : 'desiredDate:asc').split(':') as [
    string,
    'asc' | 'desc',
  ];
  const raw = await queryModelRecords<WishResource>(familyId, 'wish', {
    ...(andFilters(filters) ? { filter: andFilters(filters) } : {}),
    sort: [{ field: sortField, direction: sortDirection }],
    page: { limit: params.limit, cursor: params.cursor },
  });
  return {
    items: await Promise.all(raw.items.map(item => toWish(familyId, item))),
    nextCursor: raw.nextCursor,
  };
}

export async function getWish(familyId: string, wishId: string): Promise<Wish> {
  return toWish(familyId, await request<WishResource>(modelRecordPath(familyId, 'wish', wishId)));
}

export async function createWish(familyId: string, data: CreateWishRequest): Promise<Wish> {
  const raw = await request<WishResource>(modelCollectionPath(familyId, 'wish'), {
    method: 'POST',
    data: {
      title: data.title,
      description: data.description ?? null,
      desiredDate: data.desiredDate ?? null,
      ownerPersonId: await currentPersonId(familyId),
    },
    skipRetry: true,
  });
  return toWish(familyId, raw);
}

export async function updateWish(
  familyId: string,
  wishId: string,
  data: UpdateWishRequest,
): Promise<Wish> {
  const raw = await request<WishResource>(modelRecordPath(familyId, 'wish', wishId), {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
  return toWish(familyId, raw);
}

export function deleteWish(familyId: string, wishId: string, version: number): Promise<void> {
  return request<void>(modelRecordPath(familyId, 'wish', wishId), {
    method: 'DELETE',
    data: { version },
    skipRetry: true,
  });
}

async function wishAction(
  familyId: string,
  wishId: string,
  action: 'fulfill' | 'reopen',
  version: number,
): Promise<Wish> {
  const raw = await request<WishResource>(
    `${modelRecordPath(familyId, 'wish', wishId)}/actions/${action}`,
    { method: 'POST', data: { version }, skipRetry: true },
  );
  return toWish(familyId, raw);
}

export function fulfillWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'fulfill', version);
}

export function reopenWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'reopen', version);
}
