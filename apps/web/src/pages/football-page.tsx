import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, CalendarDays, ChevronDown, ChevronLeft, Clock3, Plus, RefreshCw, Shield, SlidersHorizontal, Trash2, Trophy, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { RecordIconField, RecordIconMark, emptyIconDraft, iconDraftFor, presentationToSave, type RecordIconDraft } from '../components/record-icon';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { ApiError, apiRequest } from '../lib/api-client';
import { queryModelRecords } from '../lib/canonical-query';
import { useModalScrollLock } from '../lib/modal-scroll';
import { FootballPersonPicker } from './football-person-picker';
import { FootballPerformanceSheet } from './football-performance-sheet';
import {
  type FootballMatch, type FootballMatchDraft, type FootballPerformance,
  type FootballPerformanceDraft, type FootballReference, type MatchFilter, type PerformanceSchema,
  blankFilters, blankMatch, blankPerformance, commonTypes, entryModes, enumOptions,
  goalMethods, shotOutcomes, matchDraft, matchPayload, matchQueryFilter, metricValue, modelUrl,
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
  return cause instanceof ApiError ? cause.message + (cause.requestId ? ' · ' + cause.requestId : '')
    : cause instanceof Error ? cause.message : '请求失败';
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
  const { currentFamily, members, loading: householdLoading } = useHousehold();
  const navigate = useNavigate();
  const managing = useLocation().pathname.endsWith('/manage');
  const spaceId = currentFamily?.id;
  const canWrite = Boolean(currentFamily && currentFamily.role !== 'viewer');
  const [tab, setTab] = useState<'record' | 'stats'>('record');
  const [matches, setMatches] = useState<FootballMatch[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<FootballMatch | null>(null);
  const [performances, setPerformances] = useState<FootballPerformance[]>([]);
  const [eventsError, setEventsError] = useState('');
  const [schema, setSchema] = useState<PerformanceSchema | null>(null);
  const [schemaError, setSchemaError] = useState('');
  const [teams, setTeams] = useState<FootballReference[]>([]);
  const [competitions, setCompetitions] = useState<FootballReference[]>([]);
  const [personId, setPersonId] = useState('');
  const [filters, setFilters] = useState<MatchFilter>(blankFilters);
  const [filterOpen, setFilterOpen] = useState(false);
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
  const [metric, setMetric] = useState('goal');
  const [groupBy, setGroupBy] = useState<'month' | 'year' | 'opponent' | 'competition'>('month');
  const [statMatches, setStatMatches] = useState<FootballMatch[]>([]);
  const [statEvents, setStatEvents] = useState<FootballPerformance[]>([]);
  const [statsError, setStatsError] = useState('');
  const [statsLoading, setStatsLoading] = useState(false);
  const matchReq = useRef(0);
  const statsReq = useRef(0);
  const eventReq = useRef(0);
  const refsReq = useRef(0);
  const schemaReq = useRef(0);
  const teamNames = useMemo(() => new Map(teams.map(t => [t.id, t.name])), [teams]);
  const teamRecords = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);
  const competitionNames = useMemo(() => new Map(competitions.map(t => [t.id, t.name])), [competitions]);
  const familyPeople = useMemo(() => members.filter(m => m.personId).map(m => ({
    id: m.personId!, name: m.displayName || '家庭成员',
  })), [members]);
  const visibleMemberIds = useMemo(() => new Set(familyPeople.map(p => p.id)), [familyPeople]);
  const currentName = familyPeople.find(p => p.id === personId)?.name ?? '选择球员';
  useModalScrollLock(Boolean(matchForm || performanceForm || quickRef));

  useEffect(() => {
    if (!spaceId) { setPersonId(''); return; }
    const saved = rememberedPerson(spaceId);
    const chosen = familyPeople.find(p => p.id === saved)?.id ??
      familyPeople.find(p => p.name.toLocaleLowerCase().includes('kk'))?.id ??
      familyPeople[0]?.id ?? '';
    setPersonId(chosen);
    setFilters(prev => ({ ...prev, playerPersonId: chosen }));
  }, [spaceId, familyPeople]);
  function selectPerson(id: string) {
    setPersonId(id);
    if (spaceId) rememberPerson(spaceId, id);
    setFilters(prev => ({ ...prev, playerPersonId: id }));
  }
  useEffect(() => {
    setSelected(null); setPerformances([]); setEventsError(''); setMatches([]); setNextCursor(null);
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
    if (!spaceId) return;
    const id = ++refsReq.current;
    Promise.all([
      queryAllBounded<FootballReference>(spaceId, 'person_group', { sort: [{ field: 'name', direction: 'asc' }] }, 4),
      queryAllBounded<FootballReference>(spaceId, 'activity', { sort: [{ field: 'startDate', direction: 'desc' }] }, 4),
    ]).then(([t, a]) => {
      if (refsReq.current !== id) return;
      setTeams(t); setCompetitions(a);
    }).catch(e => { if (refsReq.current === id) setError(message(e)); });
  }, [spaceId, refresh]);

  const loadMatchPage = useCallback(async (cursor: string | null, append: boolean) => {
    if (!spaceId) return;
    const req = ++matchReq.current;
    setLoading(true); if (!append) setError('');
    try {
      const result = await queryModelRecords<FootballMatch>(spaceId, 'football_match', {
        ...(matchQueryFilter(filters) ? { filter: matchQueryFilter(filters) } : {}),
        sort: [{ field: 'matchDate', direction: 'desc' }],
        page: { limit: 40, ...(cursor ? { cursor } : {}) },
      });
      if (req !== matchReq.current) return;
      setMatches(prev => append ? [...prev, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (cause) { if (req === matchReq.current) setError(message(cause)); }
    finally { if (req === matchReq.current) setLoading(false); }
  }, [spaceId, filters]);
  useEffect(() => { if (tab === 'record') void loadMatchPage(null, false); }, [tab, loadMatchPage, refresh]);

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
    if (tab !== 'stats' || !spaceId || !personId || !schema) return;
    const req = ++statsReq.current;
    setStatsLoading(true); setStatsError('');
    const query = { ...(matchQueryFilter({ ...filters, playerPersonId: personId }) ?
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
  }, [tab, spaceId, personId, schema?.version, filters, refresh]);

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
      setRefresh(n => n + 1); setSuccess('比赛已保存');
    } catch (cause) { setFormError(message(cause)); }
    finally { setSaving(false); }
  }
  function startPerformance(type: string, record?: FootballPerformance) {
    if (!schema || !selected) return;
    if (!enumOptions(schema, 'performanceType').includes(type)) {
      setError('该表现类型尚未在 LifeSpace 当前环境发布'); return;
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
      if (model === 'football_match') setSelected(null);
      setRefresh(n => n + 1); setSuccess('记录已删除');
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }
  function startReference(kind: ReferenceKind, target: 'representativeTeamId' | 'opponentTeamId' | null = null) {
    setQuickRef(kind); setRefTarget(target); setRefName(''); setRefIcon(emptyIconDraft()); setFormError('');
  }
  async function saveReference(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!spaceId || !quickRef || !canWrite || saving) return;
    if (!refName.trim()) return;
    setSaving(true); setFormError('');
    try {
      const key = quickRef === 'team' ? 'person_group' : 'activity';
      const presentation = await presentationToSave(spaceId, key, refIcon);
      const ref = await apiRequest<FootballReference>(modelUrl(spaceId, key), {
        method: 'POST', body: JSON.stringify(quickRef === 'team'
          ? { name: refName.trim(), description: null, memberPersonIds: [], ...presentation }
          : { name: refName.trim(), description: null, attendeePersonIds: [],
            startDate: null, endDate: null, ...presentation }),
      });
      if (quickRef === 'team') {
        setTeams(prev => [...prev, ref]);
        if (refTarget) setMatchForm(prev => prev ? { ...prev, [refTarget]: ref.id } : prev);
      } else {
        setCompetitions(prev => [...prev, ref]);
        setMatchForm(prev => prev ? { ...prev, competitionActivityId: ref.id } : prev);
      }
      setQuickRef(null); setRefName(''); setRefIcon(emptyIconDraft());
    } catch (e) { setFormError(message(e)); }
    finally { setSaving(false); }
  }

  const types = schema ? enumOptions(schema, 'performanceType') : [];
  const moreTypes = types.filter(t => !quickTypes.includes(t) && t !== 'appearance');
  const typeCount = (kind: string) => performanceEventCount(performances.filter(p => p.playerPersonId === personId), kind);
  const statMetrics = [
    ...(types.filter(t => t !== 'appearance').map(t => ({ key: t, name: performanceTitle(t) + '数' }))),
    { key: 'goalsPerMatch', name: '场均进球' }, { key: 'assistsPerMatch', name: '场均助攻' },
    { key: 'appearances', name: '参赛场次' }, { key: 'minutes', name: '出场分钟' }, { key: 'starts', name: '首发场次' },
  ];
  const statValue = metricValue(metric, statMatches, statEvents, personId);
  const groupedStats = useMemo(() => {
    const groups = new Map<string, FootballMatch[]>();
    for (const match of statMatches) {
      const key = groupBy === 'month' ? match.matchDate.slice(0, 7)
        : groupBy === 'year' ? match.matchDate.slice(0, 4)
          : groupBy === 'opponent' ? (teamNames.get(match.opponentTeamId) ?? '其他对手')
            : competitionNames.get(match.competitionActivityId ?? '') ?? '未指定赛事';
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, m]) => ({ name, value: metricValue(metric, m, statEvents, personId) }));
  }, [statMatches, statEvents, metric, groupBy, personId, teamNames, competitionNames]);
  const maxValue = Math.max(1, ...groupedStats.map(g => g.value ?? 0));
  const onFilter = (patch: Partial<MatchFilter>) => setFilters(prev => ({ ...prev, ...patch }));

  if (householdLoading) return <Card className="p-8">正在加载家庭信息…</Card>;

  return <div className="space-y-4">
    <PageHeader title={managing ? '球队与赛事' : '足球比赛'}>
      {managing ? <Button variant="secondary" onClick={() => navigate('/football')}>
        <ChevronLeft className="size-4"/> 返回足球比赛
      </Button> : <>
        {!selected && <Button variant="secondary" onClick={() => setFilterOpen(v => !v)}
          aria-expanded={filterOpen} aria-controls="football-search-filters"
          className={Object.entries(filters).some(([key, value]) => key !== 'playerPersonId' && value) ? 'text-emerald-800 ring-emerald-300' : ''}>
          <SlidersHorizontal className="size-4"/> 搜索与筛选{Object.entries(filters).some(([key,value]) => key !== 'playerPersonId' && value) ? ' · 已启用' : ''}
        </Button>}
        {tab === 'record' && canWrite && <Button variant="primary" onClick={() => startMatch()}><Plus className="size-4"/> 新建比赛</Button>}
      </>}
    </PageHeader>
    {!managing && <div className="flex flex-wrap items-center justify-between gap-3">
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
          <Shield className="size-4"/> <span className="hidden sm:inline">球队与赛事</span><span className="sm:hidden">管理</span>
        </Button>
      </div>
    </div>}
    {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!managing && schemaError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      当前 LifeSpace 环境尚不能读取足球表现模型；比赛资料仍可查看和编辑，新增表现要先在 LifeSpace 发布 football_performance 并授权。{schemaError}
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
            <div className="divide-y divide-stone-100">
              {group.items.map(item => <div key={item.id} className="flex min-h-14 items-center gap-3 py-2">
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
          </Card>)}
      </div>
    </div>}
    {!spaceId ? <Card className="p-6">请先选择家庭。</Card> : !managing && <>
      {!selected && filterOpen && <div id="football-search-filters"
        className="space-y-3 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-stone-200/80 sm:p-4">
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
          <label className="min-w-32 flex-1 text-sm text-stone-600">赛事<select className={input}
            value={filters.competitionActivityId} onChange={e=>onFilter({competitionActivityId:e.target.value})}>
            <option value="">全部赛事</option>{competitions.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="min-w-32 flex-1 text-sm text-stone-600">代表球队<select className={input}
            value={filters.representativeTeamId} onChange={e=>onFilter({representativeTeamId:e.target.value})}>
            <option value="">全部球队</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="min-w-32 flex-1 text-sm text-stone-600">对手球队<select className={input}
            value={filters.opponentTeamId} onChange={e=>onFilter({opponentTeamId:e.target.value})}>
            <option value="">全部球队</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <Button variant="ghost" onClick={() => setFilters({ ...blankFilters(), playerPersonId: personId })}>重置筛选</Button>
        </div>
      </div>}
      {tab === 'record' && !selected && <>
        {showReferences && <div className="grid gap-3 md:grid-cols-2">
          <Card className="space-y-3 p-4"><div className="flex items-center justify-between">
            <h2 className="font-semibold">球队</h2>{canWrite && <Button variant="secondary" onClick={()=>startReference('team')}><Plus className="size-4"/> 新增</Button>}</div>
            <div className="max-h-52 space-y-2 overflow-y-auto">{teams.map(t=><p key={t.id} className="text-sm text-stone-600">{t.name}</p>)}</div>
          </Card>
          <Card className="space-y-3 p-4"><div className="flex items-center justify-between">
            <h2 className="font-semibold">赛事</h2>{canWrite && <Button variant="secondary" onClick={()=>startReference('competition')}><Plus className="size-4"/> 新增</Button>}</div>
            <div className="max-h-52 space-y-2 overflow-y-auto">{competitions.map(t=><p key={t.id} className="text-sm text-stone-600">{t.name}</p>)}</div>
          </Card>
        </div>}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">比赛记录</h2>
          <Button variant="ghost" onClick={()=>void loadMatchPage(null,false)}><RefreshCw className="size-4"/> 刷新</Button>
        </div>
        {loading && matches.length===0 && <Card className="p-6 text-sm text-stone-500">正在查询比赛…</Card>}
        <div className="space-y-2">
          {matches.map(m => <Card key={m.id} className="space-y-2 p-3 sm:p-4">
            <p className="text-xs text-stone-400">{m.matchDate} · {m.matchType === 'official' ? '正式比赛' : '友谊赛'} · {competitionNames.get(m.competitionActivityId ?? '') ?? '未关联赛事'}</p>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium">
                {teamRecords.get(m.representativeTeamId)?.presentation?.icon &&
                  <RecordIconMark icon={teamRecords.get(m.representativeTeamId)!.presentation!.icon!}
                    spaceId={spaceId} modelKey="person_group" recordId={m.representativeTeamId}/>}
                <span className="truncate">{teamNames.get(m.representativeTeamId) ?? '代表球队'}</span>
              </div>
              <strong className="whitespace-nowrap text-lg tabular-nums">{m.representativeTeamScore ?? '–'} : {m.opponentTeamScore ?? '–'}</strong>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1 text-sm font-medium">
                <span className="truncate">{teamNames.get(m.opponentTeamId) ?? '对手球队'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={()=>{setSelected(m);setSuccess('');}}>进入记录</Button>
              {canWrite && <Button variant="ghost" onClick={()=>startMatch(m)}>编辑比赛</Button>}
            </div>
          </Card>)}
          {!loading && !matches.length && <Card className="p-8 text-sm text-stone-500">当前范围没有比赛；可以新建比赛或调整筛选。</Card>}
        </div>
        {nextCursor && <Button className="w-full" variant="secondary" disabled={loading} onClick={()=>void loadMatchPage(nextCursor,true)}>加载更多比赛</Button>}
      </>}
      {tab === 'record' && selected && <>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={()=>setSelected(null)}><ChevronLeft className="size-4"/> 返回比赛列表</Button>
          <span className="ml-auto text-xs text-stone-500">当前球员：{currentName}</span>
        </div>
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
      {tab === 'stats' && <>
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>统计指标
              <select className={input} value={metric} onChange={e=>setMetric(e.target.value)}>
                {statMetrics.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}
              </select></label>
            <label className={label}>图表分组
              <select className={input} value={groupBy} onChange={e=>setGroupBy(e.target.value as typeof groupBy)}>
                <option value="month">按月份</option><option value="year">按年份</option>
                <option value="opponent">按对手</option><option value="competition">按赛事</option>
              </select></label>
          </div>
          <p className="text-xs text-stone-500">当前球员：{currentName} · 根据所选年份、赛事、球队、对手筛选比赛后计算。只根据已记录表现统计。</p>
          {statsError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{statsError}</p>}
          {statsLoading ? <p className="py-8 text-center text-sm text-stone-500">正在分析已筛选比赛…</p> : !schema ? <p className="text-sm text-stone-500">模型发布后可查看统计。</p> : statsError ? null : <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-stone-50 p-4"><p className="text-xs text-stone-500">{statMetrics.find(m=>m.key===metric)?.name ?? metric}</p>
                <strong className="mt-2 block text-3xl tabular-nums">{statValue===null?'—':statValue.toFixed(metric.includes('PerMatch')?2:0)}</strong></div>
              <div className="rounded-xl bg-stone-50 p-4"><p className="text-xs text-stone-500">参赛场次</p>
                <strong className="mt-2 block text-3xl tabular-nums">{statMatches.length}</strong></div>
            </div>
            <h3 className="font-semibold">指标分布</h3>
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {groupedStats.map(g=><div key={g.name} className="grid grid-cols-[90px_minmax(0,1fr)_48px] items-center gap-2 text-sm">
                <span className="truncate">{g.name}</span>
                <div className="h-4 overflow-hidden rounded-full bg-stone-100">
                  {g.value!==null && <div className="h-full rounded-full bg-emerald-500" style={{ width: String(g.value/maxValue*100)+'%' }}/>}
                </div>
                <span className="text-right tabular-nums">{g.value===null?'—':g.value.toFixed(metric.includes('PerMatch')?2:0)}</span>
              </div>)}
              {!groupedStats.length && <p className="text-sm text-stone-500">当前筛选下暂无比赛数据</p>}
            </div>
            {metric==='minutes' && <p className="text-xs text-amber-700">出场时间仅计算已完整录入的片段，缺少片段时长的分组显示「—」。</p>}
          </>}
        </Card>
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
          <label className={label}>赛事
            <select className={input} value={matchForm.competitionActivityId}
              onChange={e=>setMatchForm({...matchForm,competitionActivityId:e.target.value})}>
              <option value="">无</option>{competitions.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <Button variant="ghost" type="button" onClick={()=>startReference('competition')}>＋ 新建赛事</Button>
          <div className="grid grid-cols-2 gap-3">
            {(['representativeTeamId','opponentTeamId'] as const).map(k=><label className={label} key={k}>
              {k==='representativeTeamId'?'代表球队 *':'对手球队 *'}
              <select className={input} required value={matchForm[k]}
                onChange={e=>setMatchForm({...matchForm,[k]:e.target.value})}>
                <option value="">请选择</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <button className="text-xs text-emerald-700" type="button" onClick={()=>startReference('team',k)}>＋ 新建球队</button>
            </label>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['representativeTeamScore','opponentTeamScore'] as const).map(k=><label className={label} key={k}>
              {k==='representativeTeamScore'?'我方比分':'对方比分'}
              <input className={input} type="number" min="0" value={matchForm[k]}
                onChange={e=>setMatchForm({...matchForm,[k]:e.target.value})} placeholder="可以稍后填写"/></label>)}
          </div>
          <FootballPersonPicker spaceId={spaceId} members={members} selected={matchForm.playerPersonIds} multiple
            onChange={ids=>setMatchForm({...matchForm,playerPersonIds:ids})} label="参赛球员（家庭成员优先）" disabled={saving}/>
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
    {quickRef && spaceId && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6">
      <form role="dialog" aria-modal="true" aria-label="新增球队或赛事" onSubmit={saveReference}
        className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between"><h2 className="font-semibold">新建{quickRef==='team'?'球队':'赛事'}</h2>
          <Button variant="ghost" type="button" disabled={saving} onClick={()=>setQuickRef(null)}><X className="size-4"/></Button></div>
        <div className="flex gap-2">
          <RecordIconField spaceId={spaceId} modelKey={quickRef==='team'?'person_group':'activity'} icon={refIcon} onChange={setRefIcon}/>
          <label className={label + ' flex-1'}>名称 *<input className={input} required value={refName} onChange={e=>setRefName(e.target.value)}/></label>
        </div>
        {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" disabled={saving} onClick={()=>setQuickRef(null)}>取消</Button>
          <Button variant="primary" type="submit" disabled={saving}>保存</Button>
        </div>
      </form>
    </div>}
  </div>;
}
