import { apiRequest } from '../lib/api-client';
import { queryModelRecords, type CanonicalQuery, type CanonicalQueryFilter } from '../lib/canonical-query';

export type FootballMatch = {
  id: string; version: number; matchDate: string; matchType: 'official' | 'friendly';
  competitionActivityId: string | null; representativeTeamId: string; opponentTeamId: string;
  representativeTeamScore: number | null; opponentTeamScore: number | null;
  playerPersonIds: string[]; notes: string | null;
};
export type FootballPerformance = {
  id: string; version: number; matchId: string; playerPersonId: string;
  performanceType: string; goalMethod?: string | null; minutesPlayed?: number | null;
  position?: string | null; entryMode?: string | null; notes?: string | null;
};
export type FootballReference = {
  id: string; name: string; description?: string | null;
  presentation?: { icon?: import('../components/record-icon').RecordIcon | null };
};
export type FootballPerson = { id: string; displayName: string; alternateNames?: string[] };
export type FootballMatchDraft = {
  matchDate: string; matchType: 'official' | 'friendly'; competitionActivityId: string;
  representativeTeamId: string; opponentTeamId: string;
  representativeTeamScore: string; opponentTeamScore: string;
  playerPersonIds: string[]; notes: string;
};
export type FootballPerformanceDraft = {
  performanceType: string; playerPersonId: string; goalMethod: string;
  minutesPlayed: string; position: string; entryMode: string; notes: string;
};
export type SemanticField = { key: string; type: string; values?: string[]; title?: string; required?: boolean };
export type PerformanceSchema = { key: string; version: number; fields: SemanticField[] };
export type MatchFilter = {
  year: string; matchType: string; representativeTeamId: string;
  opponentTeamId: string; competitionActivityId: string; playerPersonId: string;
};
export const blankFilters = (): MatchFilter => ({
  year: '', matchType: '', representativeTeamId: '', opponentTeamId: '',
  competitionActivityId: '', playerPersonId: '',
});
export const commonTypes: Record<string, string> = {
  goal: '进球', assist: '助攻', tackle: '抢断', interception: '拦截', appearance: '出场片段',
};
export const goalMethods: Record<string, string> = {
  left_foot: '左脚', right_foot: '右脚', header: '头球', penalty: '点球',
  other: '其他', unknown: '不明',
};
export const entryModes: Record<string, string> = {
  starter: '首发', substitute: '替补／再次登场', position_change: '场内换位',
};
export function performanceTitle(kind: string): string { return commonTypes[kind] ?? kind; }
export function enumOptions(schema: PerformanceSchema, field: string): string[] {
  return schema.fields.find(item => item.key === field)?.values ?? [];
}
export function modelUrl(spaceId: string, model: string, id?: string): string {
  return '/api/lifespace/core/v1/spaces/' + encodeURIComponent(spaceId) +
    '/models/' + encodeURIComponent(model) + '/records' + (id ? '/' + encodeURIComponent(id) : '');
}
export function blankMatch(): FootballMatchDraft {
  return { matchDate: '', matchType: 'official', competitionActivityId: '',
    representativeTeamId: '', opponentTeamId: '',
    representativeTeamScore: '', opponentTeamScore: '', playerPersonIds: [], notes: '' };
}
export function matchDraft(match: FootballMatch): FootballMatchDraft {
  return {
    matchDate: match.matchDate, matchType: match.matchType,
    competitionActivityId: match.competitionActivityId ?? '',
    representativeTeamId: match.representativeTeamId, opponentTeamId: match.opponentTeamId,
    representativeTeamScore: match.representativeTeamScore === null ? '' : String(match.representativeTeamScore),
    opponentTeamScore: match.opponentTeamScore === null ? '' : String(match.opponentTeamScore),
    playerPersonIds: match.playerPersonIds ?? [], notes: match.notes ?? '',
  };
}
export function matchPayload(draft: FootballMatchDraft) {
  if (!draft.matchDate || !draft.representativeTeamId || !draft.opponentTeamId) throw Error('比赛日期和双方球队为必填');
  if (draft.representativeTeamId === draft.opponentTeamId) throw Error('双方球队不能相同');
  if ((draft.representativeTeamScore === '') !== (draft.opponentTeamScore === '')) throw Error('双方比分须同时填写或留空');
  const score = (value: string): number | null => {
    if (!value) return null;
    const result = Number(value);
    if (!Number.isInteger(result) || result < 0) throw Error('比分必须为非负整数');
    return result;
  };
  return {
    matchDate: draft.matchDate, matchType: draft.matchType,
    competitionActivityId: draft.competitionActivityId || null,
    representativeTeamId: draft.representativeTeamId, opponentTeamId: draft.opponentTeamId,
    representativeTeamScore: score(draft.representativeTeamScore),
    opponentTeamScore: score(draft.opponentTeamScore),
    playerPersonIds: [...new Set(draft.playerPersonIds)], notes: draft.notes.trim() || null,
  };
}
export function blankPerformance(performanceType: string, playerPersonId: string): FootballPerformanceDraft {
  return { performanceType, playerPersonId, goalMethod: '', minutesPlayed: '',
    position: '', entryMode: '', notes: '' };
}
export function performanceDraft(record: FootballPerformance): FootballPerformanceDraft {
  return { performanceType: record.performanceType, playerPersonId: record.playerPersonId,
    goalMethod: record.goalMethod ?? '', minutesPlayed: record.minutesPlayed === null ||
      record.minutesPlayed === undefined ? '' : String(record.minutesPlayed),
    position: record.position ?? '', entryMode: record.entryMode ?? '', notes: record.notes ?? '' };
}
export function performancePayload(draft: FootballPerformanceDraft, matchId: string, schema: PerformanceSchema) {
  const kinds = enumOptions(schema, 'performanceType');
  if (!kinds.includes(draft.performanceType)) throw Error('表现类型未在 LifeSpace 发布模型中声明');
  if (!draft.playerPersonId) throw Error('请选择球员');
  const common = { matchId, playerPersonId: draft.playerPersonId,
    performanceType: draft.performanceType, notes: draft.notes.trim() || null };
  if (draft.performanceType === 'goal') {
    if (draft.goalMethod && !enumOptions(schema, 'goalMethod').includes(draft.goalMethod)) throw Error('进球方式不在已发布模型中');
    return { ...common, goalMethod: draft.goalMethod || null, minutesPlayed: null, position: null, entryMode: null };
  }
  if (draft.performanceType === 'appearance') {
    const minutes = draft.minutesPlayed === '' ? null : Number(draft.minutesPlayed);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0)) throw Error('本段时长必须为非负整数');
    if (draft.entryMode && !enumOptions(schema, 'entryMode').includes(draft.entryMode)) throw Error('进入方式不在已发布模型中');
    return { ...common, goalMethod: null, minutesPlayed: minutes,
      position: draft.position.trim() || null, entryMode: draft.entryMode || null };
  }
  return { ...common, goalMethod: null, minutesPlayed: null, position: null, entryMode: null };
}
export function matchQueryFilter(filters: MatchFilter, includePlayer = true): CanonicalQueryFilter | undefined {
  const clauses: CanonicalQueryFilter[] = [];
  if (filters.year) {
    const year = Number(filters.year);
    if (Number.isInteger(year)) {
      clauses.push({ field: 'matchDate', op: 'gte', value: filters.year + '-01-01' });
      clauses.push({ field: 'matchDate', op: 'lt', value: String(year + 1) + '-01-01' });
    }
  }
  for (const field of ['matchType','representativeTeamId','opponentTeamId','competitionActivityId'] as const) {
    if (filters[field]) clauses.push({ field, op: 'eq', value: filters[field] });
  }
  if (includePlayer && filters.playerPersonId) clauses.push({ field: 'playerPersonIds', op: 'contains', value: filters.playerPersonId });
  return clauses.length > 1 ? { and: clauses } : clauses[0];
}
export async function queryAllBounded<T>(spaceId: string, model: string, query: Omit<CanonicalQuery, 'page'>, maxPages = 6): Promise<T[]> {
  const items: T[] = []; let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await queryModelRecords<T>(spaceId, model, { ...query, page: { limit: 100, ...(cursor ? { cursor } : {}) } });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) return items;
  }
  throw Error('数据超过当前统计查询上限；请缩小年份、赛事或球员范围，避免展示不完整统计');
}
export function countAppearances(matches: FootballMatch[], playerId: string): number {
  return matches.filter(m => m.playerPersonIds?.includes(playerId)).length;
}
export function metricValue(metric: string, matches: FootballMatch[], events: FootballPerformance[], playerId: string): number | null {
  const matchIds = new Set(matches.filter(m => m.playerPersonIds?.includes(playerId)).map(m => m.id));
  const relevant = events.filter(e => e.playerPersonId === playerId && matchIds.has(e.matchId));
  const appearances = matchIds.size;
  if (metric === 'appearances') return appearances;
  if (metric === 'goalsPerMatch' || metric === 'assistsPerMatch') {
    if (!appearances) return null;
    return relevant.filter(e => e.performanceType === (metric === 'goalsPerMatch' ? 'goal' : 'assist')).length / appearances;
  }
  if (metric === 'starts') return new Set(relevant.filter(e => e.performanceType === 'appearance' && e.entryMode === 'starter').map(e => e.matchId)).size;
  if (metric === 'minutes') {
    const segments = relevant.filter(e => e.performanceType === 'appearance');
    return segments.length && segments.every(e => e.minutesPlayed !== null && e.minutesPlayed !== undefined)
      ? segments.reduce((sum, e) => sum + (e.minutesPlayed ?? 0), 0) : null;
  }
  const type = metric.startsWith('type:') ? metric.slice(5) : metric;
  return relevant.filter(e => e.performanceType === type).length;
}
export async function readPerformanceSchema(spaceId: string): Promise<PerformanceSchema> {
  const result = await apiRequest<PerformanceSchema>(
    '/api/lifespace/core/v1/spaces/' + encodeURIComponent(spaceId) + '/_discovery/models/football_performance');
  if (result.key !== 'football_performance' || !Array.isArray(result.fields)) throw Error('LifeSpace 未返回有效的 FootballPerformance 模型契约');
  return result;
}
