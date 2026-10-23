export type RecentFootballReference = {
  id: string;
  name: string;
  usedAt: number;
};
export type RecentFootballModel = 'person_group' | 'activity';

const PREFIX = 'homemew.football.recent.v1';
const LIMIT = 12;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function key(userId: string, spaceId: string, model: RecentFootballModel): string {
  // User and family isolation prevents reusing a prior user's local suggestions.
  return [PREFIX, encodeURIComponent(userId), encodeURIComponent(spaceId), model].join(':');
}
function valid(value: unknown, now: number): value is RecentFootballReference {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecentFootballReference>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length < 256 &&
    typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 150 &&
    typeof item.usedAt === 'number' && Number.isFinite(item.usedAt) &&
    item.usedAt <= now && item.usedAt >= now - MAX_AGE_MS;
}

/** Local per-user/per-Space hints, never authoritative football records or directory membership. */
export function readRecentFootballReferences(
  userId: string, spaceId: string, model: RecentFootballModel,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  now = Date.now(),
): RecentFootballReference[] {
  if (!userId || !spaceId || !storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key(userId, spaceId, model)) ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter(item => {
      if (!valid(item, now) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, LIMIT);
  } catch { return []; }
}
export function rememberFootballReference(
  userId: string, spaceId: string, model: RecentFootballModel, reference: { id: string; name: string },
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  now = Date.now(),
): RecentFootballReference[] {
  if (!userId || !spaceId || !storage) return [];
  const next = [
    { id: reference.id, name: reference.name, usedAt: now },
    ...readRecentFootballReferences(userId, spaceId, model, storage, now).filter(item => item.id !== reference.id),
  ].filter(item => valid(item, now)).slice(0, LIMIT);
  try { storage.setItem(key(userId, spaceId, model), JSON.stringify(next)); }
  catch { /* cache unavailable: authoritative record workflow is unaffected */ }
  return next;
}
export function forgetFootballReference(
  userId: string, spaceId: string, model: RecentFootballModel, id: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): RecentFootballReference[] {
  if (!userId || !spaceId || !storage) return [];
  const next = readRecentFootballReferences(userId, spaceId, model, storage).filter(item => item.id !== id);
  try { storage.setItem(key(userId, spaceId, model), JSON.stringify(next)); }
  catch { /* cache unavailable */ }
  return next;
}
