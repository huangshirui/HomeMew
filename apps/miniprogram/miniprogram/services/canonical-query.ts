import { request } from './api';
import { LifeSpacePage, modelCollectionPath } from './lifespace';

export type CanonicalQueryFilter =
  | { and: CanonicalQueryFilter[] }
  | { or: CanonicalQueryFilter[] }
  | { field: string; op: 'isNull' | 'isNotNull' }
  | {
    field: string;
    op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'within' | 'contains'
      | 'overlaps' | 'before' | 'after' | 'kindIs';
    value: unknown;
  };

export type CanonicalQuery = {
  search?: { text: string };
  filter?: CanonicalQueryFilter;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  page?: { limit?: number; cursor?: string | null };
  context?: { viewingTimezone: string };
};

export function andFilters(
  filters: Array<CanonicalQueryFilter | null | undefined>,
): CanonicalQueryFilter | undefined {
  const present = filters.filter((filter): filter is CanonicalQueryFilter => Boolean(filter));
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : { and: present };
}

export function orFilters(
  filters: Array<CanonicalQueryFilter | null | undefined>,
): CanonicalQueryFilter | undefined {
  const present = filters.filter((filter): filter is CanonicalQueryFilter => Boolean(filter));
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : { or: present };
}

export function queryModelRecords<T>(
  spaceId: string,
  modelKey: string,
  query: CanonicalQuery,
): Promise<LifeSpacePage<T>> {
  return request<LifeSpacePage<T>>(`${modelCollectionPath(spaceId, modelKey)}/query`, {
    method: 'POST',
    data: query as unknown as Record<string, unknown>,
  });
}
