/**
 * Non-authoritative on-device recently selected football teams / competitions.
 * User+Space isolation; IDs and short display names only, never business truth.
 * Mobile football UI must revalidate a selected cached ID through its explicit BFF route.
 */
export type FootballRecentKind = 'team' | 'competition';
export type FootballRecentItem = { id: string; name: string; usedAt: number };
const PREFIX = 'homemew.football.recent.v1';
const MAX = 12;
const AGE = 90 * 24 * 60 * 60 * 1000;

function storageKey(userId: string, spaceId: string, kind: FootballRecentKind): string {
  return [PREFIX, encodeURIComponent(userId), encodeURIComponent(spaceId), kind].join(':');
}
function valid(value: unknown, now: number): value is FootballRecentItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<FootballRecentItem>;
  return typeof item.id === 'string' && !!item.id && item.id.length < 256 &&
    typeof item.name === 'string' && !!item.name && item.name.length <= 150 &&
    typeof item.usedAt === 'number' && Number.isFinite(item.usedAt) &&
    item.usedAt <= now && item.usedAt >= now - AGE;
}

export function readFootballRecent(userId: string, spaceId: string, kind: FootballRecentKind, now = Date.now()): FootballRecentItem[] {
  if (!userId || !spaceId) return [];
  try {
    const raw: unknown = wx.getStorageSync(storageKey(userId, spaceId, kind));
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter(item => {
      if (!valid(item, now) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, MAX);
  } catch { return []; }
}
export function rememberFootballRecent(
  userId: string, spaceId: string, kind: FootballRecentKind,
  item: { id: string; name: string }, now = Date.now(),
): FootballRecentItem[] {
  if (!userId || !spaceId) return [];
  const next = [{ id: item.id, name: item.name, usedAt: now },
    ...readFootballRecent(userId, spaceId, kind, now).filter(x => x.id !== item.id)]
    .filter(x => valid(x, now)).slice(0, MAX);
  try { wx.setStorageSync(storageKey(userId, spaceId, kind), next); } catch { return []; /* optional UI hint */ }
  return next;
}
export function removeFootballRecent(userId: string, spaceId: string, kind: FootballRecentKind, id: string): FootballRecentItem[] {
  if (!userId || !spaceId) return [];
  const next = readFootballRecent(userId, spaceId, kind).filter(x => x.id !== id);
  try { wx.setStorageSync(storageKey(userId, spaceId, kind), next); } catch { /* optional UI hint */ }
  return next;
}
