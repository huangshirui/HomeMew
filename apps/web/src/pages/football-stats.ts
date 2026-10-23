import type { FootballMatch, FootballPerformance } from './football-domain';

export type FootballMonth = {
  month: string;
  matches: number;
  goals: number;
  assists: number;
  tackles: number;
  interceptions: number;
  completeMinutesMatches: number;
  knownMinutes: number;
  goalsInTimedMatches: number;
  assistsInTimedMatches: number;
  goalsPerMatch: number | null;
  assistsPerMatch: number | null;
  tacklesPerMatch: number | null;
  interceptionsPerMatch: number | null;
  minutesPerGoal: number | null;
  minutesPerAssist: number | null;
};
export type FootballStats = {
  matches: number;
  goals: number;
  assists: number;
  completeMinutesMatches: number;
  knownMinutes: number;
  months: FootballMonth[];
};

const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
function monthSequence(first: string, last: string): string[] {
  if (!monthRegex.test(first) || !monthRegex.test(last)) return [];
  const [startYear, startMonth] = first.split('-').map(Number);
  const [endYear, endMonth] = last.split('-').map(Number);
  const count = (endYear - startYear) * 12 + endMonth - startMonth + 1;
  // Registry results have a bounded query limit, but dates can be arbitrarily far apart.
  // Do not synthesize thousands of empty periods in the browser.
  if (count < 1) return [];
  if (count > 240) return [];
  return Array.from({ length: count }, (_, i) => {
    const n = startYear * 12 + startMonth - 1 + i;
    return String(Math.floor(n / 12)).padStart(4, '0') + '-' + String(n % 12 + 1).padStart(2, '0');
  });
}
function emptyMonth(month: string): FootballMonth {
  return {
    month, matches: 0, goals: 0, assists: 0, tackles: 0, interceptions: 0,
    completeMinutesMatches: 0, knownMinutes: 0, goalsInTimedMatches: 0, assistsInTimedMatches: 0,
    goalsPerMatch: null, assistsPerMatch: null, tacklesPerMatch: null, interceptionsPerMatch: null,
    minutesPerGoal: null, minutesPerAssist: null,
  };
}
const average = (total: number, count: number): number | null => count > 0 ? total / count : null;

/**
 * Natural-month football statistics for one Person, using only their match roster entries.
 * Appearance records are individual position-stable segments. A match is time-covered only
 * when it has >= 1 appearance segment and every recorded segment has valid minutes.
 * The platform cannot infer an unrecorded extra segment: users must enter all segments.
 */
export function buildFootballStats(
  matches: FootballMatch[], events: FootballPerformance[], playerId: string,
): FootballStats {
  const played = new Map<string, FootballMatch>();
  for (const match of matches) {
    if (match.playerPersonIds?.includes(playerId) && monthRegex.test(match.matchDate.slice(0, 7)))
      played.set(match.id, match);
  }
  const buckets = new Map<string, FootballMonth>();
  for (const match of played.values()) {
    const month = match.matchDate.slice(0, 7);
    if (!buckets.has(month)) buckets.set(month, emptyMonth(month));
    buckets.get(month)!.matches++;
  }
  const validEvents = events.filter(e => e.playerPersonId === playerId && played.has(e.matchId));
  const appearances = new Map<string, FootballPerformance[]>();
  for (const e of validEvents) if (e.performanceType === 'appearance') {
    appearances.set(e.matchId, [...(appearances.get(e.matchId) ?? []), e]);
  }
  const timedMatches = new Set<string>();
  for (const match of played.values()) {
    const segments = appearances.get(match.id) ?? [];
    if (!segments.length || !segments.every(s =>
      typeof s.minutesPlayed === 'number' && Number.isInteger(s.minutesPlayed) && s.minutesPlayed >= 0)) continue;
    const minutes = segments.reduce((sum, s) => sum + (s.minutesPlayed ?? 0), 0);
    timedMatches.add(match.id);
    const bucket = buckets.get(match.matchDate.slice(0, 7))!;
    bucket.completeMinutesMatches++;
    bucket.knownMinutes += minutes;
  }
  for (const event of validEvents) {
    const match = played.get(event.matchId)!;
    const bucket = buckets.get(match.matchDate.slice(0, 7))!;
    switch (event.performanceType) {
      case 'goal':
        bucket.goals++;
        if (timedMatches.has(event.matchId)) bucket.goalsInTimedMatches++;
        break;
      case 'assist':
        bucket.assists++;
        if (timedMatches.has(event.matchId)) bucket.assistsInTimedMatches++;
        break;
      case 'tackle': bucket.tackles++; break;
      case 'interception': bucket.interceptions++; break;
    }
  }
  for (const bucket of buckets.values()) {
    bucket.goalsPerMatch = average(bucket.goals, bucket.matches);
    bucket.assistsPerMatch = average(bucket.assists, bucket.matches);
    bucket.tacklesPerMatch = average(bucket.tackles, bucket.matches);
    bucket.interceptionsPerMatch = average(bucket.interceptions, bucket.matches);
    // Numerator and denominator refer to exactly the same set of covered matches.
    bucket.minutesPerGoal = bucket.completeMinutesMatches
      ? average(bucket.knownMinutes, bucket.goalsInTimedMatches) : null;
    bucket.minutesPerAssist = bucket.completeMinutesMatches
      ? average(bucket.knownMinutes, bucket.assistsInTimedMatches) : null;
  }
  const months = [...buckets.keys()].sort();
  const sequence = months.length ? monthSequence(months[0], months[months.length - 1]) : [];
  const complete = (sequence.length ? sequence : months).map(month => buckets.get(month) ?? emptyMonth(month));
  return {
    matches: played.size,
    goals: [...buckets.values()].reduce((sum, b) => sum + b.goals, 0),
    assists: [...buckets.values()].reduce((sum, b) => sum + b.assists, 0),
    knownMinutes: [...buckets.values()].reduce((sum, b) => sum + b.knownMinutes, 0),
    completeMinutesMatches: timedMatches.size,
    months: complete,
  };
}
