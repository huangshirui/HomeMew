import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BarChart3, CalendarDays, ChevronDown, ChevronLeft, Clock3, Handshake, Plus, RefreshCw, Shield, SlidersHorizontal, Trash2, Trophy, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { RecordIconField, RecordIconMark, emptyIconDraft, iconDraftFor, presentationToSave, type RecordIconDraft } from '../components/record-icon';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { apiRequest } from '../lib/api-client';
import { householdErrorMessage } from '../lib/user-facing-error';
import { queryModelRecords } from '../lib/canonical-query';
import { useModalScrollLock } from '../lib/modal-scroll';
import { FootballPersonPicker } from './football-person-picker';
import { FootballReferencePicker } from './football-reference-picker';
import { rememberFootballReference } from './football-recent-references';
import { fetchUniqueFootballReferences } from './football-reference-hydration';
import { FootballPerformanceSheet } from './football-performance-sheet';
import { FootballStatsDashboard } from './football-stats-dashboard';
import { consumeFootballList, rememberFootballList } from './football-list-navigation';
import {
  type FootballMatch, type FootballMatchDraft, type FootballPerformance,
  type FootballPerformanceDraft, type FootballReference, type FootballPerson, type MatchFilter, type PerformanceSchema,
  blankFilters, blankMatch, blankPerformance, commonTypes, entryModes, enumOptions,
  goalMethods, shotOutcomes, matchDraft, matchPayload, matchQueryFilter, modelUrl,
  performanceEventCount,
  performanceDraft, performancePayload, performanceTitle, queryAllBounded, readPerformanceSchema,
} from './football-domain';

const input = 'h-10 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500';
const label = 'block space-y-1 text-sm font-medium text-stone-700';
const quickTypes = ['goal', 'assist', 'shot', 'key_pass', 'successful_dribble', 'tackle', 'interception', 'clearance'];
// The eight curated icons belong to HomeMew UX, not to the LifeSpace event model.
const quickActionIcons: Record<string, string> = {
  goal: '⚽', assist: '👟', shot: '🎯', key_pass: '💡',
  successful_dribble: '✨', tackle: '🛡️', interception: '✂️', clearance: '🚀',
};
type ReferenceKind = 'team' | 'competition';

function message(cause: unknown): string {
  return householdErrorMessage(cause, '操作失败，请稍后再试。');
}
function matchLabel(m: FootballMatch, teams: Map<string, string>): string {
  return (teams.get(m.representativeTeamId) ?? '代表球队') + ' vs ' + (teams.get(m.opponentTeamId) ?? '对方球队');
}
function rememberedPerson(spaceId: string): string {
  try { return window.localStorage.getItem('homemew.football.player.' + spaceId) ?? ''; }
  catch { return ''; }
}
function rememberPerson(spaceId: string, personId: string) {
  try { window.localStorage.setItem('homemew.football.player.' + spaceId, personId); }
  catch { /* Only a browser UI preference */ }
}

export function FootballPage() {
  const { currentFamily, members, user, loading: householdLoading } = useHousehold();
  const navigate = useNavigate();
  const location = useLocation();
  const { matchId } = useParams<'matchId'>();
  const isDetail = Boolean(matchId);
  const managing = location.pathname.endsWith('/manage');
  const spaceId = currentFamily?.id;
  const canWrite = Boolean(currentFamily && currentFamily.role !== 'viewer');
  const [tab, setTab] = useState<'record' | 'stats'>('record');
  const [matches, setMatches] = useState<FootballMatch[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<FootballMatch | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [performances, setPerformances] = useState<FootballPerformance[]>([]);
  const [eventsError, setEventsError] = useState('');
  const [schema, setSchema] = useState<PerformanceSchema | null>(null);
  const [schemaError, setSchemaError] = useState('');
  const [teams, setTeams] = useState<FootballReference[]>([]);
  const [competitions, setCompetitions] = useState<FootballReference[]>([]);
  const [unavailableCompetitionIds, setUnavailableCompetitionIds] = useState<Set<string>>(() => new Set());
  const [teamCursor, setTeamCursor] = useState<string | null>(null);
  const [competitionCursor, setCompetitionCursor] = useState<string | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [managerFocus, setManagerFocus] = useState<{ team: string; competition: string }>({team:'', competition:''});
  const [personId, setPersonId] = useState('');
  const [otherPeople, setOtherPeople] = useState<FootballPerson[]>([]);
  const [playerDialog, setPlayerDialog] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerTarget, setNewPlayerTarget] = useState<'match' | 'current'>('current');
  const [filters, setFilters] = useState<MatchFilter>(blankFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [matchEditing, setMatchEditing] = useState<FootballMatch | null>(null);
  const [matchForm, setMatchForm] = useState<FootballMatchDraft | null>(null);
  const [performanceEditing, setPerformanceEditing] = useState<FootballPerformance | null>(null);
  const [performanceForm, setPerformanceForm] = useState<FootballPerformanceDraft | null>(null);
  const [formError, setFormError] = useState('');
  const [quickRef, setQuickRef] = useState<ReferenceKind | null>(null);
  const [refName, setRefName] = useState('');
  const [refDescription, setRefDescription] = useState('');
  const [refEditing, setRefEditing] = useState<FootballReference | null>(null);
  const [refIcon, setRefIcon] = useState<RecordIconDraft>(emptyIconDraft());
  const [refTarget, setRefTarget] = useState<'representativeTeamId' | 'opponentTeamId' | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [statMatches, setStatMatches] = useState<FootballMatch[]>([]);
  const [statEvents, setStatEvents] = useState<FootballPerformance[]>([]);
  const [statsError, setStatsError] = useState('');
  const [statsLoading, setStatsLoading] = useState(false);
  const matchReq = useRef(0);
  const statsReq = useRef(0);
  const eventReq = useRef(0);
  const refsReq = useRef(0);
  const attemptedRefLookup = useRef(new Set<string>());
  const schemaReq = useRef(0);
  const restoreScrollRef = useRef<number | null>(null);
  const teamNames = useMemo(() => new Map(teams.map(t => [t.id, t.name])), [teams]);
  const teamRecords = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);
  const competitionNames = useMemo(() => new Map(competitions.map(t => [t.id, t.name])), [competitions]);
  const referenceMatches = useMemo(() => isDetail ? (selected ? [selected] : []) : matches,
    [isDetail, selected, matches]);
  const familyPeople = useMemo(() => members.filter(m => m.personId).map(m => ({
    id: m.personId!, name: m.displayName || '家庭成员',
  })), [members]);
  const visibleMemberIds = useMemo(() => new Set(familyPeople.map(p => p.id)), [familyPeople]);
  const currentName = familyPeople.find(p => p.id === personId)?.name ?? '选择球员';

  useModalScrollLock(Boolean(matchForm || performanceForm || quickRef || playerDialog));

  const initializedListContext = useRef('');
  useEffect(() => {
    if (!spaceId || householdLoading) {
      if (!spaceId) { initializedListContext.current = ''; setPersonId(''); }
      return;
    }
    const context = [spaceId, user?.id ?? '', isDetail ? 'detail' : 'list'].join(':');
    if (initializedListContext.current === context) {
      // A household member refresh must not silently clear the user's search or filters.
      setPersonId(prev => familyPeople.some(p => p.id === prev) ? prev : familyPeople[0]?.id ?? '');
      return;
    }
    initializedListContext.current = context;
    const saved = rememberedPerson(spaceId);
    const defaultPerson = familyPeople.find(p => p.id === saved)?.id ??
      familyPeople.find(p => p.name.toLocaleLowerCase().includes('kk'))?.id ??
      familyPeople[0]?.id ?? '';
    const restored = !isDetail ? consumeFootballList(spaceId, user?.id ?? '') : null;
    const chosen = restored && familyPeople.some(p => p.id === restored.filters.playerPersonId)
      ? restored.filters.playerPersonId : defaultPerson;
    setPersonId(chosen);
    setFilters(restored ? { ...restored.filters, playerPersonId: chosen }
      : { ...blankFilters(), playerPersonId: chosen });
    setSearchInput(restored?.searchInput ?? '');
    setAppliedSearch(restored?.appliedSearch ?? '');
    setFilterOpen(restored?.filterOpen ?? false);
    if (restored) {
      setTab(restored.tab);
      restoreScrollRef.current = restored.scrollY;
    }
  }, [spaceId, user?.id, householdLoading, familyPeople, isDetail]);
  function openMatchDetail(record: FootballMatch) {
    if (spaceId) rememberFootballList(spaceId, user?.id ?? '', {
      tab, filters, searchInput, appliedSearch, filterOpen, scrollY: window.scrollY,
    });
    navigate('/football/' + encodeURIComponent(record.id));
  }
  function returnToMatchList() { navigate('/football'); }
  function selectPerson(id: string) {
    setPersonId(id);
    if (spaceId) rememberPerson(spaceId, id);
    setFilters(prev => ({ ...prev, playerPersonId: id }));
  }
  useEffect(() => {
    setSelected(null); setPerformances([]); setEventsError(''); setMatches([]); setNextCursor(null);
    setTeams([]); setCompetitions([]); setUnavailableCompetitionIds(new Set()); setTeamCursor(null); setCompetitionCursor(null);
    setManagerFocus({team:'',competition:''}); attemptedRefLookup.current.clear();
    setOtherPeople([]); setPlayerDialog(false); setNewPlayerName('');
    setMoreOpen(false);
    setMatchForm(null); setPerformanceForm(null); setSuccess(''); setError('');
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId) { setSchema(null); return; }
    const id = ++schemaReq.current;
    readPerformanceSchema(spaceId).then(value => { if (schemaReq.current === id) { setSchema(value); setSchemaError(''); } })
      .catch(e => { if (schemaReq.current === id) { setSchema(null); setSchemaError(message(e)); } });
  }, [spaceId, refresh]);

  useEffect(() => {
    if (!spaceId || isDetail) return;
    const request = ++refsReq.current;
    // Lists are only a small first page. Searchable pickers use server queries, not full-table materialization.
    // Do not automatically load generic Activity records as a football competition directory.
    queryModelRecords<FootballReference>(spaceId, 'person_group', {
      sort: [{ field: 'name', direction: 'asc' }], page: { limit: 30 },
    }).then(result => {
      if (refsReq.current !== request) return;
      setTeams(prev => [...new Map([...prev, ...result.items].map(item => [item.id, item])).values()]);
      setTeamCursor(result.nextCursor);
    }).catch(e => { if (refsReq.current === request) setError(message(e)); });
  }, [spaceId, refresh, isDetail]);

  async function loadMoreReferences(kind: ReferenceKind) {
    if (!spaceId || referenceLoading) return;
    const cursor = kind === 'team' ? teamCursor : competitionCursor;
    if (!cursor) return;
    setReferenceLoading(true); setError('');
    try {
      const result = await queryModelRecords<FootballReference>(
        spaceId, kind === 'team' ? 'person_group' : 'activity',
        { sort: [{ field: 'name', direction: 'asc' }], page: { limit: 50, cursor } },
      );
      if (kind === 'team') {
        setTeams(prev => [...new Map([...prev, ...result.items].map(item => [item.id, item])).values()]);
        setTeamCursor(result.nextCursor);
      } else {
        setCompetitions(prev => [...new Map([...prev, ...result.items].map(item => [item.id, item])).values()]);
        setCompetitionCursor(result.nextCursor);
      }
    } catch (cause) { setError(message(cause)); }
    finally { setReferenceLoading(false); }
  }

  async function focusReference(kind: ReferenceKind, id: string) {
    setManagerFocus(prev => ({...prev, [kind]: id}));
    if (!id || !spaceId) return;
    const items = kind === 'team' ? teams : competitions;
    if (items.some(item => item.id === id)) return;
    try {
      const record = await apiRequest<FootballReference>(
        modelUrl(spaceId, kind === 'team' ? 'person_group' : 'activity', id));
      if (kind === 'team') setTeams(prev => [...prev, record]);
      else setCompetitions(prev => [...prev, record]);
    } catch (cause) { setError(message(cause)); }
  }

  useEffect(() => {
    // A user-triggered refresh rechecks names that previously failed to load.
    attemptedRefLookup.current.clear();
    setUnavailableCompetitionIds(new Set());
  }, [spaceId, refresh]);

  useEffect(() => {
    if (!spaceId || !referenceMatches.length) return;
    const knownTeams = new Set(teams.map(x => x.id));
    const knownCompetitions = new Set(competitions.map(x => x.id));
    const needsTeams = [...new Set(referenceMatches.flatMap(m => [m.representativeTeamId, m.opponentTeamId]))]
      .filter(id => id && !knownTeams.has(id) && !attemptedRefLookup.current.has('team:' + id));
    const needsCompetitions = [...new Set(referenceMatches.map(m => m.competitionActivityId).filter((id): id is string => !!id))]
      .filter(id => !knownCompetitions.has(id) && !attemptedRefLookup.current.has('competition:' + id));
    const teamBatch = needsTeams.slice(0, 80);
    const competitionBatch = needsCompetitions.slice(0, 40);
    for (const id of teamBatch) attemptedRefLookup.current.add('team:' + id);
    for (const id of competitionBatch) attemptedRefLookup.current.add('competition:' + id);
    let active = true;
    void Promise.all([
      fetchUniqueFootballReferences(teamBatch,
        id => apiRequest<FootballReference>(modelUrl(spaceId, 'person_group', id)), 4),
      fetchUniqueFootballReferences(competitionBatch,
        id => apiRequest<FootballReference>(modelUrl(spaceId, 'activity', id)), 4),
    ]).then(([fetchedTeams, fetchedCompetitions]) => {
      if (!active) return;
      if (fetchedTeams.found.length)
        setTeams(prev => [...new Map([...prev, ...fetchedTeams.found].map(x => [x.id, x])).values()]);
      if (fetchedCompetitions.found.length)
        setCompetitions(prev => [...new Map([...prev, ...fetchedCompetitions.found].map(x => [x.id, x])).values()]);
      if (fetchedCompetitions.failedIds.length)
        setUnavailableCompetitionIds(prev => new Set([...prev, ...fetchedCompetitions.failedIds]));
    });
    return () => { active = false; };
  }, [spaceId, referenceMatches, teams, competitions]);

  const loadMatchPage = useCallback(async (cursor: string | null, append: boolean) => {
    if (!spaceId) return;
    const req = ++matchReq.current;
    setLoading(true); if (!append) setError('');
    try {
      const result = await queryModelRecords<FootballMatch>(spaceId, 'football_match', {
        ...(appliedSearch ? { search: { text: appliedSearch } } : {}),
        ...(matchQueryFilter(filters) ? { filter: matchQueryFilter(filters) } : {}),
        sort: [{ field: 'matchDate', direction: 'desc' }],
        page: { limit: 40, ...(cursor ? { cursor } : {}) },
      });
      if (req !== matchReq.current) return;
      setMatches(prev => append ? [...prev, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (cause) { if (req === matchReq.current) setError(message(cause)); }
    finally { if (req === matchReq.current) setLoading(false); }
  }, [spaceId, filters, appliedSearch]);
  useEffect(() => {
    if (!isDetail && tab === 'record') void loadMatchPage(null, false);
  }, [isDetail, tab, loadMatchPage, refresh]);
  useEffect(() => {
    if (isDetail || loading || !matches.length || restoreScrollRef.current === null) return;
    const scrollY = restoreScrollRef.current;
    restoreScrollRef.current = null;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
    return () => window.cancelAnimationFrame(frame);
  }, [isDetail, loading, matches]);
  useEffect(() => {
    if (!isDetail || !spaceId || !matchId) {
      // React Router can reuse this component when navigating back from the detail URL.
      // Clear the selected match so the list regains its filters and stops querying its events.
      setSelected(null);
      setDetailLoading(false); setDetailError('');
      return;
    }
    let active = true;
    setSelected(prev => prev?.id === matchId ? prev : null);
    setDetailLoading(true); setDetailError('');
    apiRequest<FootballMatch>(modelUrl(spaceId, 'football_match', matchId))
      .then(record => { if (active) setSelected(record); })
      .catch(cause => {
        if (active) { setSelected(null); setDetailError(message(cause)); }
      })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [isDetail, matchId, spaceId, refresh]);

  useEffect(() => {
    if (!spaceId || !selected || !schema) {
      ++eventReq.current;
      setPerformances([]); setEventsError(''); setEventsLoading(false);
      return;
    }
    const req = ++eventReq.current;
    setEventsLoading(true); setEventsError('');
    // LifeSpace Canonical Query exposes record/person relation membership through "contains", not "eq".
    queryAllBounded<FootballPerformance>(spaceId, 'football_performance',
      { filter: { field: 'matchId', op: 'contains', value: selected.id } }, 4)
      .then(items => {
        if (eventReq.current === req) { setPerformances(items); setEventsError(''); }
      })
      .catch(e => {
        if (eventReq.current === req) { setPerformances([]); setEventsError(message(e)); }
      })
      .finally(() => { if (eventReq.current === req) setEventsLoading(false); });
  }, [spaceId, selected?.id, schema?.version, refresh]);

  useEffect(() => {
    if (isDetail || tab !== 'stats' || !spaceId || !personId || !schema) return;
    const req = ++statsReq.current;
    setStatsLoading(true); setStatsError('');
    const query = { ...(appliedSearch ? { search: { text: appliedSearch } } : {}),
      ...(matchQueryFilter({ ...filters, playerPersonId: personId }) ?
      { filter: matchQueryFilter({ ...filters, playerPersonId: personId }) } : {}),
      sort: [{ field: 'matchDate', direction: 'desc' as const }] };
    Promise.all([
      queryAllBounded<FootballMatch>(spaceId, 'football_match', query, 5),
      queryAllBounded<FootballPerformance>(spaceId, 'football_performance',
        { filter: { field: 'playerPersonId', op: 'contains', value: personId } }, 8),
    ]).then(([m, e]) => { if (statsReq.current === req) { setStatMatches(m); setStatEvents(e); } })
      .catch(e => { if (statsReq.current === req) { setStatMatches([]); setStatEvents([]); setStatsError(message(e)); } })
      .finally(() => { if (statsReq.current === req) setStatsLoading(false); });
    return () => { ++statsReq.current; };
  }, [isDetail, tab, spaceId, personId, schema?.version, filters, appliedSearch, refresh]);

  function startMatch(record?: FootballMatch) {
    setMatchEditing(record ?? null);
    setMatchForm(record ? matchDraft(record) : { ...blankMatch(), playerPersonIds: personId ? [personId] : [] });
    setFormError(''); setSuccess('');
  }
  async function saveMatch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!spaceId || !matchForm || !canWrite || saving) return;
    setSaving(true); setFormError('');
    try {
      const result = await apiRequest<FootballMatch>(modelUrl(spaceId, 'football_match', matchEditing?.id), {
        method: matchEditing ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...matchPayload(matchForm), ...(matchEditing ? { version: matchEditing.version } : {}) }),
      });
      setSelected(result); setMatchEditing(null); setMatchForm(null);
      if (!isDetail) openMatchDetail(result);
      setRefresh(n => n + 1); setSuccess('比赛已保存');
    } catch (cause) { setFormError(message(cause)); }
    finally { setSaving(false); }
  }
  function startPerformance(type: string, record?: FootballPerformance) {
    if (!schema || !selected) return;
    if (!enumOptions(schema, 'performanceType').includes(type)) {
      setError('暂时无法记录这项表现，请稍后重试'); return;
    }
    setMoreOpen(false);
    setPerformanceEditing(record ?? null);
    setPerformanceForm(record ? performanceDraft(record) : blankPerformance(type, personId));
    setFormError(''); setSuccess('');
  }
  async function savePerformance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!spaceId || !selected || !performanceForm || !schema || !canWrite || saving) return;
    setSaving(true); setFormError('');
    try {
      if (!selected.playerPersonIds.includes(performanceForm.playerPersonId)) {
        throw Error('该球员尚未列入本场参赛球员，请先编辑比赛参赛名单');
      }
      const payload = performancePayload(performanceForm, selected.id, schema);
      await apiRequest(modelUrl(spaceId, 'football_performance', performanceEditing?.id), {
        method: performanceEditing ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...payload, ...(performanceEditing ? { version: performanceEditing.version } : {}) }),
      });
      setPerformanceForm(null); setPerformanceEditing(null);
      setSuccess('比赛表现已保存'); setRefresh(n => n + 1);
    } catch (cause) { setFormError(message(cause)); }
    finally { setSaving(false); }
  }
  async function deleteRecord(model: 'football_match' | 'football_performance', id: string, version: number) {
    if (!spaceId || !canWrite || saving || !window.confirm('确定删除该记录？')) return;
    setSaving(true); setError('');
    try {
      await apiRequest(modelUrl(spaceId, model, id), { method: 'DELETE', body: JSON.stringify({ version }) });
      if (model === 'football_match') {
        setSelected(null);
        if (isDetail) returnToMatchList();
      }
      setRefresh(n => n + 1); setSuccess('记录已删除');
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }
  function startReference(kind: ReferenceKind, target: 'representativeTeamId' | 'opponentTeamId' | null = null,
    record: FootballReference | null = null, initialName = '') {
    setQuickRef(kind); setRefTarget(target); setRefEditing(record);
    setRefName(record?.name ?? initialName); setRefDescription(record?.description ?? '');
    setRefIcon(iconDraftFor(record?.presentation?.icon)); setFormError('');
  }
  async function saveReference(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!spaceId || !quickRef || !canWrite || saving) return;
    if (!refName.trim()) return;
    setSaving(true); setFormError('');
    try {
      const key = quickRef === 'team' ? 'person_group' : 'activity';
      const presentation = await presentationToSave(spaceId, key, refIcon, refEditing?.presentation?.icon);
      const body = refEditing
        ? { name: refName.trim(), description: refDescription.trim() || null, version: refEditing.version, ...presentation }
        : quickRef === 'team'
          ? { name: refName.trim(), description: refDescription.trim() || null, memberPersonIds: [], ...presentation }
          : { name: refName.trim(), description: refDescription.trim() || null, attendeePersonIds: [],
              startDate: null, endDate: null, ...presentation };
      const ref = await apiRequest<FootballReference>(modelUrl(spaceId, key, refEditing?.id), {
        method: refEditing ? 'PATCH' : 'POST', body: JSON.stringify(body),
      });
      if (quickRef === 'team') {
        setTeams(prev => refEditing ? prev.map(t => t.id === ref.id ? ref : t) : [...prev, ref]);
        if (refTarget) {
          setMatchForm(prev => prev ? { ...prev, [refTarget]: ref.id } : prev);
          rememberFootballReference(user?.id ?? '', spaceId, 'person_group', ref);
        }
      } else {
        setCompetitions(prev => refEditing ? prev.map(t => t.id === ref.id ? ref : t) : [...prev, ref]);
        if (matchForm) {
          setMatchForm(prev => prev ? { ...prev, competitionActivityId: ref.id } : prev);
          rememberFootballReference(user?.id ?? '', spaceId, 'activity', ref);
        }
      }
      setQuickRef(null); setRefEditing(null); setRefName(''); setRefDescription(''); setRefIcon(emptyIconDraft());
      setSuccess(refEditing ? '已更新' + (quickRef === 'team' ? '球队' : '赛事') : '已新增' + (quickRef === 'team' ? '球队' : '赛事'));
    } catch (e) { setFormError(message(e)); }
    finally { setSaving(false); }
  }

  function startPlayer(initialName = '', target: 'match' | 'current' = 'current') {
    setNewPlayerName(initialName); setNewPlayerTarget(target);
    setPlayerDialog(true); setFormError('');
  }
  async function saveNewPlayer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!spaceId || !canWrite || saving || !newPlayerName.trim()) return;
    setSaving(true); setFormError('');
    try {
      const created = await apiRequest<FootballPerson>(
        '/api/lifespace/core/v1/spaces/' + encodeURIComponent(spaceId) + '/people', {
          method: 'POST',
          body: JSON.stringify({ displayName: newPlayerName.trim() }),
        });
      setOtherPeople(prev => [...new Map([...prev, created].map(p => [p.id,p])).values()]);
      if (newPlayerTarget === 'match' && matchForm) {
        setMatchForm(prev => prev ? { ...prev, playerPersonIds: [...new Set([...prev.playerPersonIds, created.id])] } : prev);
      } else {
        selectPerson(created.id);
      }
      setNewPlayerName(''); setPlayerDialog(false); setSuccess('球员已创建');
    } catch (cause) { setFormError(message(cause)); }
    finally { setSaving(false); }
  }

  async function deleteReference(kind: ReferenceKind, reference: FootballReference) {
    if (!spaceId || !canWrite || saving || !reference.version) return;
    const name = kind === 'team' ? '球队' : '赛事';
    const fields = kind === 'team' ? ['representativeTeamId', 'opponentTeamId'] : ['competitionActivityId'];
    setSaving(true); setError('');
    try {
      for (const field of fields) {
        const result = await queryModelRecords<FootballMatch>(spaceId, 'football_match', {
          filter: { field, op: 'contains', value: reference.id }, page: { limit: 1 },
        });
        if (result.items.length) throw Error('此' + name + '已被比赛使用，请先调整关联比赛后再删除');
      }
      if (!window.confirm('确认删除' + name + '“' + reference.name + '”？此记录可能也被其他模块引用。')) return;
      await apiRequest(modelUrl(spaceId, kind === 'team' ? 'person_group' : 'activity', reference.id), {
        method: 'DELETE', body: JSON.stringify({ version: reference.version }),
      });
      if (kind === 'team') setTeams(prev => prev.filter(item => item.id !== reference.id));
      else setCompetitions(prev => prev.filter(item => item.id !== reference.id));
      setSuccess(name + '已删除');
    } catch (cause) { setError(message(cause)); }
    finally { setSaving(false); }
  }

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    return Array.from(new Set([filters.year, ...matches.map(m => m.matchDate.slice(0, 4)),
      ...Array.from({ length: 35 }, (_, i) => String(now - i))].filter(Boolean)))
      .sort((a, b) => Number(b) - Number(a));
  }, [filters.year, matches]);

  const types = schema ? enumOptions(schema, 'performanceType') : [];
  const moreTypes = types.filter(t => !quickTypes.includes(t) && t !== 'appearance');
  const typeCount = (kind: string) => performanceEventCount(performances.filter(p => p.playerPersonId === personId), kind);
  const onFilter = (patch: Partial<MatchFilter>) => setFilters(prev => ({ ...prev, ...patch }));

  if (householdLoading) return <Card className="p-8">正在加载家庭信息…</Card>;

  return <div className="space-y-4">
    <PageHeader title={isDetail ? '比赛详情' : managing ? '球队与赛事' : '足球比赛'}>
      {isDetail ? <>
        <Button variant="secondary" onClick={returnToMatchList}><ChevronLeft className="size-4"/> 返回比赛列表</Button>
        {familyPeople.length > 0 && <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-stone-600">
          球员
          <select aria-label="当前记录球员" className={input + ' w-28 shrink-0 sm:w-36'}
            value={personId} onChange={e => selectPerson(e.target.value)}>
            {familyPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>}
      </> : managing ? <Button variant="secondary" onClick={() => navigate('/football')}>
        <ChevronLeft className="size-4"/> 返回足球比赛
      </Button> : <>
        {!selected && <Button variant="secondary" onClick={() => setFilterOpen(v => !v)}
          aria-expanded={filterOpen} aria-controls="football-search-filters"
          className={appliedSearch || Object.entries(filters).some(([key, value]) => key !== 'playerPersonId' && value) ? 'text-emerald-800 ring-emerald-300' : ''}>
          <SlidersHorizontal className="size-4"/> 搜索与筛选{appliedSearch || Object.entries(filters).some(([key,value]) => key !== 'playerPersonId' && value) ? ' · 已启用' : ''}
        </Button>}
        {tab === 'record' && canWrite && <Button variant="primary" onClick={() => startMatch()}><Plus className="size-4"/> 新建比赛</Button>}
      </>}
    </PageHeader>
    {!managing && !isDetail && <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="足球主功能" className="flex gap-2">
        {[{ key: 'record' as const, name: '记录', icon: CalendarDays },
          { key: 'stats' as const, name: '统计', icon: BarChart3 }].map(t =>
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setSelected(null); }}
            className={'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ' +
              (tab === t.key ? 'bg-emerald-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}>
            <t.icon className="size-4"/>{t.name}
          </button>)}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-stone-600">球员
          <select aria-label="球员" className={input + ' w-28 shrink-0 sm:w-36'} value={personId} onChange={e => selectPerson(e.target.value)}>
            {familyPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <Button variant="ghost" className="shrink-0" onClick={() => navigate('/football/manage')}>
          <Shield className="size-4"/> <span className="hidden sm:inline">球队与球员</span><span className="sm:hidden">管理</span>
        </Button>
        <Button variant="ghost" className="shrink-0" onClick={() => navigate('/activities')}>
          <CalendarDays className="size-4"/> <span className="hidden sm:inline">赛事 → 活动</span><span className="sm:hidden">活动</span>
        </Button>
      </div>
    </div>}
    {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!managing && schemaError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      比赛表现暂时无法使用，已有比赛仍可查看和编辑。请稍后重试。
    </p>}
    {managing && spaceId && <div className="space-y-4">
      <p className="text-sm text-stone-500">维护比赛使用的球队和赛事。被比赛引用的条目需先解除关联才能删除。</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {([{kind: 'team' as const, name: '球队', items: teams, model: 'person_group' as const},
           {kind: 'competition' as const, name: '赛事', items: competitions, model: 'activity' as const}]).map(group =>
          <Card key={group.kind} className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{group.name}</h2>
              {canWrite && <Button variant="secondary" onClick={() => startReference(group.kind)}>
                <Plus className="size-4"/> 新增{group.name}</Button>}
            </div>
            <FootballReferencePicker userId={user?.id ?? ''} spaceId={spaceId} model={group.model}
              label={'搜索定位' + group.name} optional known={group.items}
              value={managerFocus[group.kind]} onChange={id => void focusReference(group.kind, id)}/>
            <div className="divide-y divide-stone-100">
              {group.items.filter(item => !managerFocus[group.kind] || item.id === managerFocus[group.kind]).map(item => <div key={item.id} className="flex min-h-14 items-center gap-3 py-2">
                {item.presentation?.icon && <RecordIconMark icon={item.presentation.icon}
                  spaceId={spaceId} modelKey={group.model} recordId={item.id}/>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  {item.description && <p className="truncate text-xs text-stone-500">{item.description}</p>}
                </div>
                {canWrite && <>
                  <Button variant="ghost" className="shrink-0" onClick={() => startReference(group.kind, null, item)}>编辑</Button>
                  <Button variant="ghost" size="icon" aria-label={'删除' + group.name + item.name}
                    disabled={saving} onClick={() => void deleteReference(group.kind, item)}><Trash2 className="size-4"/></Button>
                </>}
              </div>)}
              {!group.items.length && <p className="py-5 text-center text-sm text-stone-500">暂无{group.name}</p>}
            </div>
            {!managerFocus[group.kind] && (group.kind === 'team' ? teamCursor : competitionCursor) &&
              <Button variant="secondary" className="w-full" disabled={referenceLoading}
                onClick={() => void loadMoreReferences(group.kind)}>加载更多{group.name}</Button>}
          </Card>)}
      </div>
    </div>}
    {!spaceId ? <Card className="p-6">请先选择家庭。</Card> : !managing && <>
      {!isDetail && !selected && filterOpen && <div id="football-search-filters"
        className="space-y-3 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-stone-200/80 sm:p-4">
        <form className="flex flex-wrap items-center gap-2" role="search"
          onSubmit={e => { e.preventDefault(); setAppliedSearch(searchInput.trim()); }}>
          <label className="min-w-0 flex-1">
            <span className="sr-only">搜索比赛备注</span>
            <input className={input} placeholder="搜索比赛备注" value={searchInput}
              onChange={e => setSearchInput(e.target.value)}/>
          </label>
          <Button variant="primary" type="submit">搜索</Button>
          {appliedSearch && <Button variant="ghost" type="button"
            onClick={() => {setSearchInput(''); setAppliedSearch('');}}>清除</Button>}
        </form>
        <div className="flex flex-wrap items-end gap-3">
          <span className="shrink-0 pb-3 text-xs font-medium text-stone-500">筛选</span>
          <label className="min-w-32 flex-1 text-sm text-stone-600">年份
            <select aria-label="按年份筛选" className={input} value={filters.year}
              onChange={e => onFilter({ year: e.target.value })}>
              <option value="">全部年份</option>{yearOptions.map(year => <option key={year} value={year}>{year}年</option>)}
            </select>
          </label>
          <label className="min-w-32 flex-1 text-sm text-stone-600">比赛类型<select className={input}
            value={filters.matchType} onChange={e=>onFilter({matchType:e.target.value})}>
            <option value="">全部类型</option><option value="official">正式比赛</option><option value="friendly">友谊赛</option></select></label>
          <FootballReferencePicker userId={user?.id ?? ''} className="min-w-32 flex-1" spaceId={spaceId}
            model="activity" label="赛事" optional known={competitions}
            value={filters.competitionActivityId} onChange={id => onFilter({competitionActivityId:id})}/>
          <FootballReferencePicker userId={user?.id ?? ''} className="min-w-32 flex-1" spaceId={spaceId}
            model="person_group" label="代表球队" optional known={teams}
            value={filters.representativeTeamId} onChange={id => onFilter({representativeTeamId:id})}/>
          <FootballReferencePicker userId={user?.id ?? ''} className="min-w-32 flex-1" spaceId={spaceId}
            model="person_group" label="对手球队" optional known={teams}
            value={filters.opponentTeamId} onChange={id => onFilter({opponentTeamId:id})}/>
          <Button variant="ghost" onClick={() => {setFilters({ ...blankFilters(), playerPersonId: personId }); setSearchInput(''); setAppliedSearch('');}}>重置筛选</Button>
        </div>
      </div>}
      {!isDetail && tab === 'record' && <>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">比赛记录</h2>
          <Button variant="ghost" onClick={()=>void loadMatchPage(null,false)}><RefreshCw className="size-4"/> 刷新</Button>
        </div>
        {loading && matches.length===0 && <Card className="p-6 text-sm text-stone-500">正在查询比赛…</Card>}
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          {matches.map(m => <div key={m.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-100 px-3 py-3 last:border-b-0 sm:flex-nowrap sm:px-4">
            <div className="flex w-32 shrink-0 items-center gap-2 whitespace-nowrap text-xs text-stone-700">
              <span className="tabular-nums">{m.matchDate}</span>
              {m.matchType === 'official'
                ? <span role="img" aria-label="正式比赛" title="正式比赛"><Trophy className="size-4 shrink-0 text-amber-600"/></span>
                : <span role="img" aria-label="友谊赛" title="友谊赛"><Handshake className="size-4 shrink-0 text-sky-600"/></span>}
            </div>
            <div className="min-w-0 flex-[1_1_220px]">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                {teamRecords.get(m.representativeTeamId)?.presentation?.icon
                  ? <RecordIconMark icon={teamRecords.get(m.representativeTeamId)!.presentation!.icon!}
                      spaceId={spaceId} modelKey="person_group" recordId={m.representativeTeamId} className="shrink-0"/>
                  : <Shield aria-hidden="true" className="size-4 shrink-0 text-stone-400"/>}
                <span className="min-w-0 truncate">{teamNames.get(m.representativeTeamId) ?? '代表球队'}</span>
                <strong className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{m.representativeTeamScore ?? '–'} : {m.opponentTeamScore ?? '–'}</strong>
                {teamRecords.get(m.opponentTeamId)?.presentation?.icon
                  ? <RecordIconMark icon={teamRecords.get(m.opponentTeamId)!.presentation!.icon!}
                      spaceId={spaceId} modelKey="person_group" recordId={m.opponentTeamId} className="shrink-0"/>
                  : <Shield aria-hidden="true" className="size-4 shrink-0 text-stone-400"/>}
                <span className="min-w-0 truncate">{teamNames.get(m.opponentTeamId) ?? '对手球队'}</span>
              </div>
              {m.competitionActivityId && <p className="truncate text-xs text-stone-500"
                title={unavailableCompetitionIds.has(m.competitionActivityId) ? '暂时无法查看赛事名称，可点击刷新重试' : undefined}>
                {competitionNames.get(m.competitionActivityId) ??
                  (unavailableCompetitionIds.has(m.competitionActivityId) ? '赛事暂不可查看' : '正在加载赛事…')}
              </p>}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button variant="secondary" className="h-9 px-3" onClick={() => openMatchDetail(m)}>记录</Button>
              {canWrite && <Button variant="ghost" className="h-9 px-2" onClick={()=>startMatch(m)}>编辑</Button>}
            </div>
          </div>)}
          {!loading && !matches.length && <p className="p-8 text-center text-sm text-stone-500">当前范围没有比赛；可以新建比赛或调整筛选。</p>}
        </div>
        {nextCursor && <Button className="w-full" variant="secondary" disabled={loading} onClick={()=>void loadMatchPage(nextCursor,true)}>加载更多比赛</Button>}
      </>}
      {isDetail && detailLoading && <Card className="p-8 text-center text-sm text-stone-500">正在加载比赛…</Card>}
      {isDetail && !detailLoading && detailError && <Card className="space-y-3 p-6">
        <p role="alert" className="text-sm text-red-700">{detailError}</p>
        <Button variant="secondary" onClick={returnToMatchList}>返回比赛列表</Button>
      </Card>}
      {isDetail && !detailLoading && selected && selected.id === matchId && <>
        <Card className="space-y-2 p-4">
          <p className="text-xs text-stone-400">{selected.matchDate} · {competitionNames.get(selected.competitionActivityId ?? '') ?? (selected.matchType === 'official' ? '正式比赛' : '友谊赛')}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{teamNames.get(selected.representativeTeamId) ?? '代表球队'}</span>
            <strong className="whitespace-nowrap text-xl tabular-nums">{selected.representativeTeamScore ?? '–'} : {selected.opponentTeamScore ?? '–'}</strong>
            <span className="text-right text-sm font-medium">{teamNames.get(selected.opponentTeamId) ?? '对手球队'}</span>
          </div>
          {canWrite && <Button variant="ghost" onClick={()=>startMatch(selected)}>编辑比赛信息／参赛球员</Button>}
        </Card>
        {!selected.playerPersonIds.includes(personId) && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {currentName} 未列入本场参赛名单。记录表现前请先编辑比赛并确认其参赛。
        </p>}
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h2 className="font-semibold">快捷记录 · {currentName}</h2>
            <p className="text-xs text-stone-500">选择项目打开表单，确认后才保存</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {quickTypes.filter(t => types.includes(t)).map(t =>
              <button key={t} type="button" onClick={()=>startPerformance(t)}
                aria-label={`记录${performanceTitle(t)}`}
                disabled={!canWrite || !personId || saving}
                className="group flex min-h-16 items-center gap-3 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-left shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50">
                <span aria-hidden="true" className="shrink-0 text-2xl leading-none">{quickActionIcons[t]}</span>
                <span className="min-w-0 flex-1 text-sm font-medium text-stone-800">{performanceTitle(t)}</span>
                <span className="shrink-0 text-xs tabular-nums text-stone-400">
                  {eventsLoading || eventsError ? '—' : typeCount(t)}
                </span>
              </button>)}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-3">
            {types.includes('appearance') && <Button className="h-11" variant="secondary"
              disabled={!canWrite || !personId || saving} onClick={()=>startPerformance('appearance')}>
              <Clock3 className="size-4"/> 出场记录
            </Button>}
            {moreTypes.length > 0 && <Button className="h-11" variant="secondary"
              aria-expanded={moreOpen} aria-controls="football-more-performance"
              disabled={!canWrite || !personId || saving} onClick={()=>setMoreOpen(open => !open)}>
              <Plus className="size-4"/> 更多表现
              <ChevronDown className={`size-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`}/>
            </Button>}
          </div>
          {moreOpen && moreTypes.length > 0 && <div id="football-more-performance"
            className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 sm:p-4">
            <p className="text-xs text-stone-500">其他表现 · 选择类型后仍可补充信息并确认保存</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {moreTypes.map(t => <button key={t} type="button"
                disabled={!canWrite || !personId || saving} onClick={()=>startPerformance(t)}
                className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-left text-sm text-stone-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-50">
                <span>{performanceTitle(t)}</span><Plus aria-hidden="true" className="size-4 shrink-0 text-stone-400"/>
              </button>)}
            </div>
          </div>}
        </Card>
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">已记录表现</h2>
          {eventsLoading && <p className="text-sm text-stone-500">读取表现中…</p>}
          {eventsError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">读取表现失败：{eventsError}</p>}
          {!eventsLoading && !eventsError && !performances.length && <p className="text-sm text-stone-500">暂无表现记录。点击上方快捷按钮新增。</p>}
          {performances.map(p=><div key={p.id} className="flex items-center gap-2 rounded-xl border border-stone-100 px-3 py-2">
            <Trophy className="size-4 shrink-0 text-stone-400"/>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{performanceTitle(p.performanceType)}
                <span className="ml-2 font-normal text-stone-500">{familyPeople.find(x=>x.id===p.playerPersonId)?.name ?? '其他参赛球员'}</span></p>
              <p className="text-xs text-stone-400">
                {p.performanceType==='goal' ? (goalMethods[p.goalMethod ?? ''] ?? p.goalMethod ?? '进球方式可补充') : ''}
                {p.performanceType==='shot' ? (shotOutcomes[p.shotOutcome ?? ''] ?? p.shotOutcome ?? '射门结果可补充') : ''}
                {p.performanceType==='appearance' ? [
                  p.minutesPlayed !== null && p.minutesPlayed !== undefined ? p.minutesPlayed + ' 分钟' : '时长可补充',
                  p.position ?? '', entryModes[p.entryMode ?? ''] ?? ''
                ].filter(Boolean).join(' · ') : ''}
                {p.notes ? ' · ' + p.notes : ''}
              </p>
            </div>
            {canWrite && <Button variant="ghost" onClick={()=>startPerformance(p.performanceType,p)}>编辑</Button>}
            {canWrite && <Button variant="ghost" size="icon" disabled={saving}
              aria-label="删除表现" onClick={()=>void deleteRecord('football_performance',p.id,p.version)}><Trash2 className="size-4"/></Button>}
          </div>)}
        </Card>
        {canWrite && <Button variant="ghost" onClick={()=>void deleteRecord('football_match',selected.id,selected.version)}>
          <Trash2 className="size-4"/> 删除本场比赛
        </Button>}
      </>}
      {!isDetail && tab === 'stats' && <>
        {statsError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{statsError}</p>}
        {statsLoading ? <Card className="p-10 text-center text-sm text-stone-500">正在统计已筛选比赛…</Card>
          : !schema ? <Card className="p-6 text-sm text-stone-500">统计暂时无法查看，请稍后重试。</Card>
          : statsError ? null
          : <FootballStatsDashboard matches={statMatches} events={statEvents}
              playerId={personId} playerName={currentName}/>}
      </>}
    </>}
    {matchForm && spaceId && <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 sm:items-center sm:p-6">
      <form role="dialog" aria-modal="true" aria-label={matchEditing?'编辑比赛':'新增比赛'}
        onSubmit={saveMatch} className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white sm:max-h-[86dvh] sm:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-5 py-4">
          <h2 className="font-semibold">{matchEditing?'编辑':'新建'}比赛</h2>
          <Button variant="ghost" type="button" disabled={saving} onClick={()=>setMatchForm(null)}><X className="size-4"/></Button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>日期 *<input className={input} type="date" required value={matchForm.matchDate}
              onChange={e=>setMatchForm({...matchForm,matchDate:e.target.value})}/></label>
            <label className={label}>比赛类型<select className={input} value={matchForm.matchType}
              onChange={e=>setMatchForm({...matchForm,matchType:e.target.value as FootballMatchDraft['matchType']})}>
              <option value="official">正式比赛</option><option value="friendly">友谊赛</option></select></label>
          </div>
          <FootballReferencePicker userId={user?.id ?? ''} spaceId={spaceId} model="activity" label="赛事" optional
            known={competitions} disabled={saving} value={matchForm.competitionActivityId}
            onChange={id=>setMatchForm(prev=>prev ? {...prev,competitionActivityId:id} : prev)}
            onCreate={name => startReference('competition', null, null, name)}/>
          <div className="grid grid-cols-2 gap-3">
            {(['representativeTeamId','opponentTeamId'] as const).map(k=><div className="min-w-0" key={k}>
              <FootballReferencePicker userId={user?.id ?? ''} spaceId={spaceId} model="person_group"
                label={k === 'representativeTeamId' ? '代表球队' : '对手球队'}
                known={teams} disabled={saving} value={matchForm[k]}
                onChange={id=>setMatchForm(prev=>prev ? {...prev,[k]:id} : prev)}
                onCreate={name=>startReference('team', k, null, name)}/>
            </div>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['representativeTeamScore','opponentTeamScore'] as const).map(k=><label className={label} key={k}>
              {k==='representativeTeamScore'?'我方比分':'对方比分'}
              <input className={input} type="number" min="0" value={matchForm[k]}
                onChange={e=>setMatchForm({...matchForm,[k]:e.target.value})} placeholder="可以稍后填写"/></label>)}
          </div>
          <FootballPersonPicker spaceId={spaceId} members={members} selected={matchForm.playerPersonIds} multiple
            knownPeople={otherPeople}
            onChange={ids=>setMatchForm({...matchForm,playerPersonIds:ids})} label="参赛球员（家庭成员优先）"
            disabled={saving} onCreate={name => startPlayer(name, 'match')}/>
          <label className={label}>备注<textarea className="min-h-20 w-full rounded-xl border border-stone-200 p-3 text-sm"
            value={matchForm.notes} onChange={e=>setMatchForm({...matchForm,notes:e.target.value})}/></label>
          {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-stone-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="secondary" disabled={saving} onClick={()=>setMatchForm(null)}>取消</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving?'保存中…':'保存比赛'}</Button>
        </div>
      </form>
    </div>}
    {performanceForm && schema && selected && spaceId && <FootballPerformanceSheet
      spaceId={spaceId} members={members} matchTitle={matchLabel(selected,teamNames)}
      schema={schema} draft={performanceForm} onChange={setPerformanceForm}
      saving={saving} error={formError} editing={Boolean(performanceEditing)}
      onSubmit={savePerformance} onClose={()=>{if(!saving){setPerformanceForm(null);setPerformanceEditing(null);}}}/>}
    {playerDialog && spaceId && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6">
      <form role="dialog" aria-modal="true" aria-label="新建球员" onSubmit={saveNewPlayer}
        className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">新建球员</h2>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setPlayerDialog(false)}><X className="size-4"/></Button>
        </div>
        <label className={label}>姓名 *
          <input autoFocus required maxLength={100} className={input} value={newPlayerName}
            onChange={e => setNewPlayerName(e.target.value)}/>
        </label>
        <p className="text-xs text-stone-500">新建的球员不会自动加入家庭成员。</p>
        {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setPlayerDialog(false)}>取消</Button>
          <Button type="submit" variant="primary" disabled={saving}>确认新建</Button>
        </div>
      </form>
    </div>}
    {quickRef && spaceId && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6">
      <form role="dialog" aria-modal="true" aria-label="新增球队或赛事" onSubmit={saveReference}
        className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between"><h2 className="font-semibold">{refEditing ? '编辑' : '新建'}{quickRef==='team'?'球队':'赛事'}</h2>
          <Button variant="ghost" type="button" disabled={saving} onClick={()=>setQuickRef(null)}><X className="size-4"/></Button></div>
        <div className="flex gap-2">
          <RecordIconField spaceId={spaceId} modelKey={quickRef==='team'?'person_group':'activity'} icon={refIcon}
            recordId={refEditing?.id} original={refEditing?.presentation?.icon} onChange={setRefIcon}/>
          <label className={label + ' flex-1'}>名称 *<input className={input} required value={refName} onChange={e=>setRefName(e.target.value)}/></label>
        </div>
        <label className={label}>说明（可选）
          <textarea className="min-h-20 w-full rounded-xl border border-stone-200 p-3 text-sm"
            maxLength={quickRef === 'team' ? 2000 : 5000} value={refDescription}
            onChange={e => setRefDescription(e.target.value)}/>
        </label>
        {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" disabled={saving} onClick={()=>setQuickRef(null)}>取消</Button>
          <Button variant="primary" type="submit" disabled={saving}>保存</Button>
        </div>
      </form>
    </div>}
  </div>;
}
