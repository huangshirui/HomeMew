import { apiRequest } from './api-client';

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
};

export type CanonicalQueryPage<T> = { items: T[]; nextCursor: string | null };

export function queryModelRecords<T>(
  spaceId: string,
  modelKey: string,
  query: CanonicalQuery,
): Promise<CanonicalQueryPage<T>> {
  return apiRequest<CanonicalQueryPage<T>>(
    `/api/lifespace/core/v1/spaces/${encodeURIComponent(spaceId)}/models/${encodeURIComponent(modelKey)}/records/query`,
    { method: 'POST', body: JSON.stringify(query) },
  );
}
