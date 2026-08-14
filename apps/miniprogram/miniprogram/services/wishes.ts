/** HomeMew 许愿池 -> LifeSpace wish model。 */

import { request } from './api';
import { Wish, CreateWishRequest, UpdateWishRequest, PersonRef } from '../types/index';
import {
  ResourceBase,
  LifeSpacePage,
  currentPersonId,
  getSpaceMembers,
  modelRecordPath,
  personRef,
  queryString,
  spacePath,
  unavailableActor,
  userIdToPersonId,
} from './lifespace';

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface ListWishesParams {
  status?: string;
  ownerUserId?: string;
  claimantUserId?: string;
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
  status: 'open' | 'claimed' | 'fulfilled' | 'archived';
  ownerPersonId: string;
  claimantPersonId: string | null;
  claimedAt: string | null;
  fulfilledByPersonId: string | null;
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
    claimant: personRef(raw.claimantPersonId, members),
    claimedAt: raw.claimedAt ?? null,
    fulfilledBy: personRef(raw.fulfilledByPersonId, members),
    fulfilledAt: raw.fulfilledAt ?? null,
    createdBy: unavailableActor(),
    updatedBy: unavailableActor(),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function listWishes(
  familyId: string,
  params: ListWishesParams = {},
): Promise<Page<Wish>> {
  const [ownerPersonId, claimantPersonId] = await Promise.all([
    params.ownerUserId ? userIdToPersonId(familyId, params.ownerUserId) : Promise.resolve(null),
    params.claimantUserId ? userIdToPersonId(familyId, params.claimantUserId) : Promise.resolve(null),
  ]);
  const sortMap = {
    default: 'desiredDate:asc',
    desired_asc: 'desiredDate:asc',
    created_desc: 'createdAt:desc',
    updated_desc: 'updatedAt:desc',
  } as const;
  const raw = await request<LifeSpacePage<WishResource>>(
    `${spacePath(familyId, 'wishes')}${queryString({
      status: params.status,
      ownerPersonId: ownerPersonId ?? undefined,
      claimantPersonId: claimantPersonId ?? undefined,
      desiredDateFrom: params.desiredFrom,
      desiredDateTo: params.desiredTo,
      sort: params.sort ? sortMap[params.sort] : 'desiredDate:asc',
      limit: params.limit,
      cursor: params.cursor,
    })}`,
  );
  return {
    items: await Promise.all(raw.items.map(item => toWish(familyId, item))),
    nextCursor: raw.nextCursor,
  };
}

export async function getWish(familyId: string, wishId: string): Promise<Wish> {
  return toWish(familyId, await request<WishResource>(modelRecordPath(familyId, 'wishes', wishId)));
}

export async function createWish(familyId: string, data: CreateWishRequest): Promise<Wish> {
  const raw = await request<WishResource>(spacePath(familyId, 'wishes'), {
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
  const raw = await request<WishResource>(modelRecordPath(familyId, 'wishes', wishId), {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
  return toWish(familyId, raw);
}

export function deleteWish(familyId: string, wishId: string, version: number): Promise<void> {
  return request<void>(modelRecordPath(familyId, 'wishes', wishId), {
    method: 'DELETE',
    data: { version },
    skipRetry: true,
  });
}

async function wishAction(
  familyId: string,
  wishId: string,
  action: 'claim' | 'unclaim' | 'fulfill' | 'reopen' | 'archive' | 'restore',
  version: number,
): Promise<Wish> {
  const raw = await request<WishResource>(
    `${modelRecordPath(familyId, 'wishes', wishId)}/actions/${action}`,
    { method: 'POST', data: { version }, skipRetry: true },
  );
  return toWish(familyId, raw);
}

export function claimWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'claim', version);
}
export function unclaimWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'unclaim', version);
}
export function fulfillWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'fulfill', version);
}
export function reopenWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'reopen', version);
}
export function archiveWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'archive', version);
}
export function restoreWish(familyId: string, wishId: string, version: number): Promise<Wish> {
  return wishAction(familyId, wishId, 'restore', version);
}
