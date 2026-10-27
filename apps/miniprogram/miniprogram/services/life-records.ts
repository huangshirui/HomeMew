import { listDomainRecords, type DomainListOptions, type DomainPage, type DomainRecord } from './domains';

export type LifeKind = 'habits' | 'activities' | 'goals';

/** Existing Mini BFF does not filter Habit owners. Walk cursors before declaring an empty result. */
export async function listPersonalHabitPage(
  familyId: string, personId: string, options: DomainListOptions = {},
  isCurrent: () => boolean = () => true,
): Promise<DomainPage<DomainRecord>> {
  if (!personId) return { items: [], nextCursor: null };
  let cursor = options.cursor;
  const visited = new Set<string>();
  do {
    const page = await listDomainRecords(familyId, 'habits', { ...options, cursor });
    if (!isCurrent()) return { items: [], nextCursor: null };
    const items = page.items.filter(record => record.subjectPersonId === personId);
    if (items.length || !page.nextCursor) return { items, nextCursor: page.nextCursor };
    if (visited.has(page.nextCursor)) throw new Error('习惯列表更新异常，请重试');
    visited.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return { items: [], nextCursor: null };
}

/** Only active/current records; bounded requests through existing product routes, no local persistence. */
export async function listCurrentLifeRecords(
  familyId: string, kind: LifeKind, personId: string, today: string,
  isCurrent: () => boolean = () => true,
): Promise<DomainRecord[]> {
  // Missing Space Person mapping is not a request to list every family member's habits.
  if (kind === 'habits' && !personId) return [];
  const records: DomainRecord[] = [];
  let cursor: string | undefined;
  const visited = new Set<string>();
  do {
    const options: DomainListOptions = kind === 'activities'
      ? { period: 'current', today, limit: 100, cursor, ...(personId ? { personId } : {}) }
      : { status: 'active', limit: 100, cursor, ...(personId ? { personId } : {}) };
    const page = kind === 'habits'
      ? await listPersonalHabitPage(familyId, personId, options, isCurrent)
      : await listDomainRecords(familyId, kind, options);
    if (!isCurrent()) return [];
    records.push(...page.items);
    if (page.nextCursor && visited.has(page.nextCursor)) throw new Error('列表更新异常，请重试');
    if (page.nextCursor) visited.add(page.nextCursor);
    cursor = page.nextCursor || undefined;
  } while (cursor);
  return records.filter((record, index) => records.findIndex(item => item.id === record.id) === index);
}
