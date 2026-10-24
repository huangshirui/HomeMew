import type { MatchFilter } from './football-domain';

type FootballListState = {
  tab: 'record' | 'stats';
  filters: MatchFilter;
  searchInput: string;
  appliedSearch: string;
  filterOpen: boolean;
  scrollY: number;
};
type Stored = FootballListState & { savedAt: number };
const PREFIX = 'homemew.football.list.v1:';
const TTL = 30 * 60 * 1000;
const fields: (keyof MatchFilter)[] =
  ['year','matchType','representativeTeamId','opponentTeamId','competitionActivityId','playerPersonId'];
const cacheKey = (spaceId: string, userId: string) =>
  PREFIX + encodeURIComponent(userId) + ':' + encodeURIComponent(spaceId);

/** Ephemeral per-tab UI state only: not a business record, filter authority or permission. */
export function rememberFootballList(spaceId: string, userId: string, state: FootballListState) {
  if (!spaceId || !userId) return;
  try { if (typeof sessionStorage === 'undefined') return; sessionStorage.setItem(cacheKey(spaceId,userId), JSON.stringify({...state, savedAt:Date.now()})); }
  catch { /* Browsing still works with storage disabled. */ }
}
export function consumeFootballList(spaceId: string, userId: string): FootballListState | null {
  if (!spaceId || !userId) return null;
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const key=cacheKey(spaceId,userId);
    const raw=sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const state: Stored=JSON.parse(raw);
    if (!state || typeof state.savedAt!=='number' || Date.now()-state.savedAt>TTL ||
      (state.tab!=='record' && state.tab!=='stats') || !state.filters ||
      fields.some(field => typeof state.filters[field]!=='string') ||
      typeof state.searchInput!=='string' || typeof state.appliedSearch!=='string' ||
      typeof state.filterOpen!=='boolean' || !Number.isFinite(state.scrollY)) return null;
    const filters=Object.fromEntries(fields.map(field=>[field,state.filters[field]])) as MatchFilter;
    return {tab:state.tab,filters,searchInput:state.searchInput.slice(0,500),
      appliedSearch:state.appliedSearch.slice(0,500),filterOpen:state.filterOpen,
      scrollY:Math.max(0,state.scrollY)};
  } catch { return null; }
}
