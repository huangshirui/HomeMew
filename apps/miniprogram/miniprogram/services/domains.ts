/** Stable, explicit HomeMew Mini product domain contract. No LifeSpace wire paths in client. */
import { request } from './api';
import { productQuery } from './product-routes';
import { candidateDisplayName, relationDisplayName } from '../utils/relation-display';

export type DomainKind = 'activities' | 'goals' | 'habits' | 'anniversaries' | 'football-matches' | 'football-performances' | 'football-teams';
export type DomainStatus = 'active' | 'paused' | 'achieved' | 'abandoned' | 'ended';
export type DomainIcon = { type: 'emoji'; value: string } | { type: 'image'; fileId: string };
export type DomainRecord = {
  id: string; version: number; spaceId?: string; name?: string; summary?: string; title?: string;
  description?: string | null; createdAt?: string;
  presentation?: { icon?: DomainIcon | null };
  status?: DomainStatus; attendeePersonIds?: string[]; subjectPersonIds?: string[]; personIds?: string[];
  startDate?: string | null; endDate?: string | null; targetDate?: string | null;
  subjectPersonId?: string; intervalDays?: number; lastCheckInDate?: string | null;
  month?: number; day?: number; year?: number | null;
  computed?: { checkIn?: { today: string; streakDays: number; checkedInToday: boolean } };
  matchDate?: string; matchType?: string; competitionActivityId?: string | null;
  representativeTeamId?: string; opponentTeamId?: string;
  representativeTeamScore?: number | null; opponentTeamScore?: number | null;
  playerPersonIds?: string[]; notes?: string | null;
  matchId?: string; playerPersonId?: string; performanceType?: string;
  goalMethod?: string | null; shotOutcome?: string | null; minutesPlayed?: number | null;
  position?: string | null; entryMode?: string | null;
  memberPersonIds?: string[];
};
export type PersonOption = { userId: string; personId: string; displayName: string };
export type DomainPage<T> = { items: T[]; nextCursor: string | null };
export type DomainListOptions = {
  limit?: number; cursor?: string; q?: string; status?: DomainStatus; period?: 'current'|'upcoming'|'past'|'all';
  today?: string; personId?: string; year?: string; matchType?: string; matchId?: string;
  playerPersonId?: string; representativeTeamId?: string; opponentTeamId?: string; competitionActivityId?: string;
};
const root = (familyId: string) => '/api/v1/miniprogram/families/' + encodeURIComponent(familyId);
const collection = (familyId: string, kind: DomainKind) => root(familyId) + '/domains/' + kind;
const record = (familyId: string, kind: DomainKind, id: string) => collection(familyId, kind) + '/' + encodeURIComponent(id);

export const listDomainRecords = (familyId: string, kind: DomainKind, opts: DomainListOptions = {}) =>
  request<DomainPage<DomainRecord>>(collection(familyId,kind) + productQuery({ ...opts, limit: opts.limit || 40 }));
export const getDomainRecord = (familyId: string, kind: DomainKind, id: string) =>
  request<DomainRecord>(record(familyId,kind,id));
export const createDomainRecord = (familyId: string, kind: DomainKind, data: Record<string,unknown>) =>
  request<DomainRecord>(collection(familyId,kind),{method:'POST',data,skipRetry:true});
export const updateDomainRecord = (familyId: string, kind: DomainKind, id: string, data: Record<string,unknown>) =>
  request<DomainRecord>(record(familyId,kind,id),{method:'PATCH',data,skipRetry:true});
export const deleteDomainRecord = (familyId: string, kind: DomainKind, id: string, version: number) =>
  request<void>(record(familyId,kind,id),{method:'DELETE',data:{version},skipRetry:true});
export const performDomainAction = (familyId: string, kind: 'goals'|'habits', id: string, action: string, version: number) =>
  request<DomainRecord>(record(familyId,kind,id)+'/actions/'+action,{method:'POST',data:{version},skipRetry:true});
export const listDomainPeople = (familyId: string) => request<PersonOption[]>(root(familyId)+'/domain-people');
export type DomainRelation = {
  id: string;
  source: { modelKey: string; recordId: string };
  target: { modelKey: string; recordId: string };
  sourceRecord?: { name?: string|null; summary?: string|null; title?: string|null; displayName?: string|null };
  targetRecord?: { name?: string|null; summary?: string|null; title?: string|null; displayName?: string|null };
  sourceLabel?: string; targetLabel?: string;
};
const relations = (familyId: string, kind: 'activities'|'goals'|'habits', id: string) =>
  root(familyId)+'/containers/'+kind+'/'+encodeURIComponent(id)+'/relations';
export const listDomainRelations = (familyId: string, kind: 'activities'|'goals'|'habits', id: string,
  direction: 'incoming'|'outgoing', cursor?: string) =>
  request<DomainPage<DomainRelation>>(relations(familyId,kind,id)+productQuery({direction,cursor,limit:50}));
export const linkDomainRecord = (familyId: string, kind: 'activities'|'goals'|'habits', id: string,
  targetModel: string, targetId: string) =>
  request(relations(familyId,kind,id),{method:'POST',data:{targetModel,targetId},skipRetry:true});
export const unlinkDomainRecord = (familyId: string, kind: 'activities'|'goals'|'habits', id: string, relationId: string) =>
  request(relations(familyId,kind,id)+'/'+encodeURIComponent(relationId),{method:'DELETE',skipRetry:true});
export type CheckInHistory = { id: string; checkedOn?: string; checkedOnDate?: string; recordedByNameSnapshot?: string };
export const listHabitHistory = (familyId:string,id:string,cursor?:string) =>
  request<DomainPage<CheckInHistory>>(record(familyId,'habits',id)+'/check-ins'+productQuery({cursor,limit:40}));

export const DOMAIN_COPY: Record<'activities'|'goals'|'habits'|'anniversaries',{title:string;symbol:string}> = {
  activities: {title:'活动',symbol:'📅'},goals: {title:'目标',symbol:'◎'},
  habits: {title:'习惯',symbol:'◷'},anniversaries:{title:'纪念日',symbol:'◇'},
};
export const STATUS_COPY: Record<DomainStatus,string> = {
  active:'进行中',paused:'已暂停',achieved:'已达成',abandoned:'已放弃',ended:'已结束',
};
export function readableRelationTitle(edge: DomainRelation, direction: 'outgoing'|'incoming'): string {
  const obj = direction === 'outgoing' ? edge.targetRecord : edge.sourceRecord;
  const label = direction === 'outgoing' ? edge.targetLabel : edge.sourceLabel;
  const refId = direction === 'outgoing' ? edge.target.recordId : edge.source.recordId;
  return relationDisplayName(refId, label, obj);
}
export const readableCandidateTitle = candidateDisplayName;

/** Native container workspace operations; all write paths remain atomic at LifeSpace. */
const containerBase=(familyId:string,kind:'activities'|'goals'|'habits',id:string) =>
  root(familyId)+'/containers/'+kind+'/'+encodeURIComponent(id);
export const searchLinkedCandidates=(familyId:string,kind:'activities'|'goals'|'habits',id:string,model:string,q:string,cursor?:string) =>
  request<DomainPage<DomainRecord>>(containerBase(familyId,kind,id)+'/candidates'+productQuery({model,q,cursor}));
export const createLinkedRecord=(familyId:string,kind:'activities'|'goals'|'habits',id:string,
  targetType:'task'|'event'|'countdown',draft:Record<string,unknown>) =>
  request(containerBase(familyId,kind,id)+'/quick-create',{method:'POST',data:{targetType,draft},skipRetry:true});
