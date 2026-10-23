import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BarChart3, CalendarDays, Plus, RefreshCw, Shield, Trophy, Trash2, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { RecordIconField, RecordIconMark, emptyIconDraft, presentationToSave, type RecordIcon, type RecordIconDraft } from '../components/record-icon';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { ApiError, apiRequest } from '../lib/api-client';
import { queryModelRecords } from '../lib/canonical-query';
import { useModalScrollLock } from '../lib/modal-scroll';

export type Match = {
  id: string; version: number; matchDate: string; matchType: 'official' | 'friendly';
  competitionActivityId: string | null; representativeTeamId: string; opponentTeamId: string;
  representativeTeamScore: number | null; opponentTeamScore: number | null;
  playerPersonIds: string[]; notes: string | null;
};
export type FootballGoal = { id: string; version: number; matchId: string; scorerPersonId: string; goalMethod: string | null; notes: string | null };
type Reference = { id: string; name: string; description?: string | null; presentation?: { icon?: RecordIcon | null } };
type MatchDraft = {
  matchDate: string; matchType: 'official' | 'friendly'; competitionActivityId: string;
  representativeTeamId: string; opponentTeamId: string; representativeTeamScore: string;
  opponentTeamScore: string; playerPersonIds: string[]; notes: string;
};
type GoalDraft = { scorerPersonId: string; goalMethod: string; notes: string };
type Stats = { total: number; wins: number; draws: number; losses: number; scored: number; conceded: number };
export function calculateStats(matches: Match[]): Stats {
  const completed = matches.filter(match => Number.isInteger(match.representativeTeamScore) && Number.isInteger(match.opponentTeamScore));
  return completed.reduce((acc, item) => {
    const own = item.representativeTeamScore!, opponent = item.opponentTeamScore!;
    acc.total++; acc.scored += own; acc.conceded += opponent;
    if (own > opponent) acc.wins++; else if (own === opponent) acc.draws++; else acc.losses++;
    return acc;
  }, { total: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 });
}
const classInput = 'h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400';
const field = 'block space-y-1 text-sm font-medium text-stone-600';
function modelUrl(spaceId: string, model: string, id?: string) {
  return `/api/lifespace/core/v1/spaces/${encodeURIComponent(spaceId)}/models/${model}/records${id ? '/' + encodeURIComponent(id) : ''}`;
}
async function records<T>(spaceId: string, key: string, sort: string | null): Promise<T[]> {
  let cursor: string | null = null; const items: T[] = [];
  for (let page = 0; page < 10; page++) {
    const result: { items: T[]; nextCursor: string | null } = await queryModelRecords<T>(spaceId, key, {
      ...(sort ? { sort: [{ field: sort, direction: 'desc' }] } : {}),
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    items.push(...result.items); cursor = result.nextCursor; if (!cursor) return items;
  }
  throw new Error('足球记录超过有界加载上限，请使用更窄的查询或增加服务端统计能力');
}
function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message + (error.requestId ? ' · ' + error.requestId : '');
  return error instanceof Error ? error.message : '请求失败';
}
function blankMatch(): MatchDraft {
  return { matchDate: '', matchType: 'official', competitionActivityId: '', representativeTeamId: '', opponentTeamId: '',
    representativeTeamScore: '', opponentTeamScore: '', playerPersonIds: [], notes: '' };
}
function matchDraft(match: Match): MatchDraft {
  return { matchDate: match.matchDate, matchType: match.matchType, competitionActivityId: match.competitionActivityId || '',
    representativeTeamId: match.representativeTeamId, opponentTeamId: match.opponentTeamId,
    representativeTeamScore: match.representativeTeamScore === null ? '' : String(match.representativeTeamScore),
    opponentTeamScore: match.opponentTeamScore === null ? '' : String(match.opponentTeamScore),
    playerPersonIds: match.playerPersonIds || [], notes: match.notes || '' };
}
function parseMatch(draft: MatchDraft) {
  if (!draft.matchDate || !draft.representativeTeamId || !draft.opponentTeamId) throw new Error('日期及两支球队为必填');
  if (draft.representativeTeamId === draft.opponentTeamId) throw new Error('双方球队不能相同');
  if (Boolean(draft.representativeTeamScore) !== Boolean(draft.opponentTeamScore)) throw new Error('两队比分应同时填写或都留空');
  const score = (value: string) => {
    if (value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error('比分必须是非负整数');
    return n;
  };
  return {
    matchDate: draft.matchDate, matchType: draft.matchType,
    competitionActivityId: draft.competitionActivityId || null,
    representativeTeamId: draft.representativeTeamId, opponentTeamId: draft.opponentTeamId,
    representativeTeamScore: score(draft.representativeTeamScore), opponentTeamScore: score(draft.opponentTeamScore),
    playerPersonIds: draft.playerPersonIds, notes: draft.notes.trim() || null,
  };
}
const methodName: Record<string, string> = {
  left_foot: '左脚', right_foot: '右脚', header: '头球', other: '其他', unknown: '不明',
};
export function FootballPage() {
  const { currentFamily, members, loading: householdLoading } = useHousehold();
  const [tab, setTab] = useState<'matches' | 'stats' | 'references'>('matches');
  const [matches, setMatches] = useState<Match[]>([]);
  const [goals, setGoals] = useState<FootballGoal[]>([]);
  const [teams, setTeams] = useState<Reference[]>([]);
  const [competitions, setCompetitions] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Match | null>(null);
  const [draft, setDraft] = useState<MatchDraft | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [quickAdd, setQuickAdd] = useState<'team' | 'competition' | null>(null);
  const [quickName, setQuickName] = useState('');
  const [quickIcon, setQuickIcon] = useState<RecordIconDraft>(emptyIconDraft());
  const [saving, setSaving] = useState(false);
  const [year, setYear] = useState('');
  const [type, setType] = useState('');
  const [team, setTeam] = useState('');
  const canWrite = Boolean(currentFamily && currentFamily.role !== 'viewer');
  const spaceId = currentFamily?.id;
  const membersByPersonId = useMemo(() => new Map(members.filter(m => m.personId).map(m => [m.personId!, m.displayName || '家庭成员'])), [members]);
  const teamNames = useMemo(() => new Map(teams.map(t => [t.id, t.name])), [teams]);
  const teamRecords = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);
  const competitionNames = useMemo(() => new Map(competitions.map(t => [t.id, t.name])), [competitions]);
  useModalScrollLock(Boolean(draft || goalDraft || quickAdd));

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true); setError('');
    try {
      const [m, g, t, a] = await Promise.all([
        records<Match>(spaceId, 'football_match', 'matchDate'),
        records<FootballGoal>(spaceId, 'football_goal', null),
        records<Reference>(spaceId, 'person_group', 'name'),
        records<Reference>(spaceId, 'activity', 'startDate'),
      ]);
      setMatches(m); setGoals(g); setTeams(t); setCompetitions(a);
      setSelected(existing => existing ? m.find(item => item.id === existing.id) ?? null : null);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }, [spaceId]);
  useEffect(() => { void refresh; void load(); }, [load, refresh]);
  useEffect(() => { setSelected(null); setEditing(null); setDraft(null); setGoalDraft(null); }, [spaceId]);

  const filtered = useMemo(() => matches.filter(m => (!year || m.matchDate.startsWith(year)) && (!type || m.matchType === type)
    && (!team || m.representativeTeamId === team)), [matches, year, type, team]);
  const stats = useMemo(() => calculateStats(filtered), [filtered]);
  const filteredIds = useMemo(() => new Set(filtered.map(m => m.id)), [filtered]);
  const goalRecords = goals.filter(g => filteredIds.has(g.matchId));
  const byPlayer = useMemo(() => {
    const counts = new Map<string, { played: number; scored: number }>();
    for (const m of filtered) for (const id of new Set(m.playerPersonIds ?? [])) {
      const value = counts.get(id) ?? { played: 0, scored: 0 }; value.played++; counts.set(id, value);
    }
    for (const g of goalRecords) {
      const value = counts.get(g.scorerPersonId) ?? { played: 0, scored: 0 };
      value.scored++; counts.set(g.scorerPersonId, value);
    }
    return [...counts.entries()].sort((a,b) => b[1].scored - a[1].scored);
  }, [filtered, goalRecords]);
  const months = useMemo(() => {
    const grouped = new Map<string, { scored: number; conceded: number }>();
    for (const m of filtered) {
      if (m.representativeTeamScore === null || m.opponentTeamScore === null) continue;
      const key = m.matchDate.slice(0, 7), val = grouped.get(key) ?? { scored: 0, conceded: 0 };
      val.scored += m.representativeTeamScore; val.conceded += m.opponentTeamScore; grouped.set(key, val);
    }
    return [...grouped.entries()].sort(([a],[b]) => a.localeCompare(b));
  }, [filtered]);

  async function saveMatch(event: FormEvent) {
    event.preventDefault();
    if (!spaceId || !draft || !canWrite) return;
    setSaving(true); setError('');
    try {
      await apiRequest(modelUrl(spaceId, 'football_match', editing?.id), {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...parseMatch(draft), ...(editing ? { version: editing.version } : {}) }),
      });
      setEditing(null); setDraft(null); setRefresh(x => x + 1);
    } catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  }
  async function deleteRecord(model: 'football_match' | 'football_goal', id: string, version: number) {
    if (!spaceId || !canWrite || !window.confirm('确认删除该记录？')) return;
    setSaving(true); setError('');
    try {
      await apiRequest(modelUrl(spaceId, model, id), { method: 'DELETE', body: JSON.stringify({ version }) });
      if (model === 'football_match') { setSelected(null); setEditing(null); setDraft(null); }
      setRefresh(x => x + 1);
    } catch (cause) { setError(errorText(cause)); } finally { setSaving(false); }
  }
  async function saveGoal(event: FormEvent) {
    event.preventDefault();
    if (!spaceId || !selected || !goalDraft || !canWrite) return;
    setSaving(true); setError('');
    try {
      if (!goalDraft.scorerPersonId) throw new Error('请选择进球人');
      await apiRequest(modelUrl(spaceId, 'football_goal'), {
        method: 'POST',
        body: JSON.stringify({ matchId: selected.id, scorerPersonId: goalDraft.scorerPersonId,
          goalMethod: goalDraft.goalMethod || null, notes: goalDraft.notes.trim() || null }),
      });
      setGoalDraft(null); setRefresh(x => x + 1);
    } catch (cause) { setError(errorText(cause)); } finally { setSaving(false); }
  }
  async function saveReference(event: FormEvent) {
    event.preventDefault();
    if (!spaceId || !quickAdd || !canWrite) return;
    const name = quickName.trim(); if (!name) return;
    setSaving(true); setError('');
    const target = quickAdd;
    try {
      const presentation = await presentationToSave(spaceId, target === 'team' ? 'person_group' : 'activity', quickIcon);
      const item = await apiRequest<Reference>(modelUrl(spaceId, target === 'team' ? 'person_group' : 'activity'), {
        method: 'POST',
        body: JSON.stringify(target === 'team' ? { name, description: null, memberPersonIds: [], ...presentation }
          : { name, description: null, attendeePersonIds: [], startDate: null, endDate: null, ...presentation }),
      });
      if (target === 'team') { setTeams(list => [...list, item]); setDraft(d => d ? { ...d, opponentTeamId: item.id } : d); }
      else { setCompetitions(list => [...list, item]); setDraft(d => d ? { ...d, competitionActivityId: item.id } : d); }
      setQuickAdd(null); setQuickName(''); setQuickIcon(emptyIconDraft());
    } catch (cause) { setError(errorText(cause)); } finally { setSaving(false); }
  }

  if (householdLoading) return <Card className="p-8">正在加载家庭信息…</Card>;
  return <div className="space-y-4">
    <PageHeader title="足球比赛">
      {canWrite ? <Button variant="primary" onClick={() => { setEditing(null); setDraft(blankMatch()); }}><Plus className="size-4"/> 记录比赛</Button> : null}
    </PageHeader>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="足球模块">
      {([{ id:'matches', label:'比赛', icon:CalendarDays },{ id:'stats',label:'统计',icon:BarChart3 },{ id:'references',label:'球队与赛事',icon:Shield }] as const)
        .map(item => <button role="tab" aria-selected={tab===item.id} key={item.id} onClick={() => setTab(item.id)}
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${tab===item.id ? 'bg-emerald-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'}`}>
          <item.icon className="size-4"/>{item.label}</button>)}
    </div>
    {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
      {error}{error.includes('MODEL') || error.includes('模型') ? <p className="mt-2 text-xs">请先在对应 LifeSpace 环境发布 football_match 和 football_goal Schema。</p> : null}
    </Card> : null}
    {!spaceId ? <Card className="p-6 text-sm">请先选择家庭。</Card> : loading ? <Card className="p-6 text-sm text-stone-500">正在加载比赛…</Card> : <>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-stone-500">年份 <select className={classInput} value={year} onChange={e => setYear(e.target.value)}>
          <option value="">全部</option>{[...new Set(matches.map(m => m.matchDate.slice(0,4)))].sort().reverse().map(y => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="text-xs text-stone-500">比赛类型 <select className={classInput} value={type} onChange={e => setType(e.target.value)}><option value="">全部</option><option value="official">正式</option><option value="friendly">友谊</option></select></label>
        <label className="text-xs text-stone-500">代表球队 <select className={classInput} value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">全部</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <Button variant="ghost" onClick={() => setRefresh(v => v + 1)}><RefreshCw className="size-4"/> 刷新</Button>
      </div>
      {tab === 'matches' ? <div className="grid gap-3 md:grid-cols-2">
        {filtered.length ? filtered.map(m => <Card key={m.id} className="space-y-3 p-4">
          <p className="text-xs text-stone-500">{m.matchDate} · {m.matchType === 'official' ? '正式比赛' : '友谊赛'}{m.competitionActivityId ? ' · ' + (competitionNames.get(m.competitionActivityId) ?? '赛事') : ''}</p>
          <div className="flex items-center justify-between gap-2 text-center">
            <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-medium">
              {teamRecords.get(m.representativeTeamId)?.presentation?.icon && currentFamily ? <RecordIconMark icon={teamRecords.get(m.representativeTeamId)?.presentation?.icon} spaceId={currentFamily.id} modelKey="person_group" recordId={m.representativeTeamId}/> : <Shield className="size-4 shrink-0 text-stone-400"/>}
              {teamNames.get(m.representativeTeamId) ?? '代表球队'}</span>
            <strong className="shrink-0 text-xl tabular-nums">{m.representativeTeamScore ?? '–'} : {m.opponentTeamScore ?? '–'}</strong>
            <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-medium">
              {teamRecords.get(m.opponentTeamId)?.presentation?.icon && currentFamily ? <RecordIconMark icon={teamRecords.get(m.opponentTeamId)?.presentation?.icon} spaceId={currentFamily.id} modelKey="person_group" recordId={m.opponentTeamId}/> : <Shield className="size-4 shrink-0 text-stone-400"/>}
              {teamNames.get(m.opponentTeamId) ?? '对方球队'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setSelected(m)}>比赛详情／进球</Button>
            {canWrite ? <Button variant="ghost" onClick={() => { setEditing(m); setDraft(matchDraft(m)); }}>编辑</Button> : null}
          </div>
        </Card>) : <Card className="p-8 text-sm text-stone-500">暂无符合条件的比赛。</Card>}
      </div> : tab === 'stats' ? <div className="space-y-4">
        <p className="text-xs text-stone-500">统计只使用已录入双方比分的比赛；个人进球仅统计已登记的 FootballGoal，不能推断为全队全部进球。</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['完整比分场次',String(stats.total)],['胜率',stats.total ? Math.round(stats.wins/stats.total*100)+'%' : '—'],
            ['进球',String(stats.scored)],['失球',String(stats.conceded)],
          ].map(([label,value])=><Card key={label} className="p-4"><p className="text-xs text-stone-500">{label}</p><strong className="mt-2 block text-2xl tabular-nums">{value}</strong></Card>)}
        </div>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">胜／平／负</h2>
          {([['胜',stats.wins,'bg-emerald-500'],['平',stats.draws,'bg-amber-400'],['负',stats.losses,'bg-rose-400']] as const)
            .map(([label,value,tone])=><div key={label} className="flex items-center gap-3 text-sm"><span className="w-5">{label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-stone-100"><div className={`h-full ${tone}`} style={{ width: stats.total ? value/stats.total*100+'%' : '0%' }}/></div>
            <span className="w-8 text-right tabular-nums">{value}</span></div>)}
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">月度进球与失球</h2>
          {months.length ? months.map(([month,value])=><div key={month} className="grid grid-cols-[64px_1fr] items-center gap-3 text-sm">
            <span>{month}</span><div className="space-y-1">
              <div className="flex items-center gap-2"><span className="w-8">进</span><div className="h-2 min-w-1 rounded bg-emerald-500" style={{width:stats.scored ? value.scored/Math.max(stats.scored,1)*100+'%' : '0%'}}/> {value.scored}</div>
              <div className="flex items-center gap-2"><span className="w-8">失</span><div className="h-2 min-w-1 rounded bg-rose-400" style={{width:stats.conceded ? value.conceded/Math.max(stats.conceded,1)*100+'%' : '0%'}}/> {value.conceded}</div>
            </div>
          </div>) : <p className="text-sm text-stone-500">暂无比分数据</p>}
        </Card>
        <Card className="space-y-3 p-5"><h2 className="font-semibold">球员统计</h2>
          {byPlayer.length ? byPlayer.map(([id,v])=><div key={id} className="flex items-center justify-between border-b border-stone-100 py-2 text-sm">
            <span>{membersByPersonId.get(id) ?? '家庭成员'}</span><span className="text-stone-500">{v.played} 场出场 · {v.scored} 粒已记录进球</span></div>)
            : <p className="text-sm text-stone-500">暂无球员数据</p>}
        </Card>
      </div> : <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-5"><h2 className="font-semibold">球队 (PersonGroup)</h2>
          {teams.map(item=><div className="flex items-center gap-2 border-b border-stone-100 py-2 text-sm" key={item.id}>
            {item.presentation?.icon && spaceId ? <RecordIconMark icon={item.presentation.icon} spaceId={spaceId} modelKey="person_group" recordId={item.id}/> : <Shield className="size-4 text-stone-400"/>}{item.name}
          </div>)}
          {canWrite ? <Button variant="secondary" onClick={()=>{setQuickAdd('team');setQuickName('');}}><Plus className="size-4"/> 新建球队</Button> : null}
        </Card>
        <Card className="space-y-2 p-5"><h2 className="font-semibold">赛事 (Activity)</h2>
          {competitions.map(item=><div className="flex items-center gap-2 border-b border-stone-100 py-2 text-sm" key={item.id}>
            {item.presentation?.icon && spaceId ? <RecordIconMark icon={item.presentation.icon} spaceId={spaceId} modelKey="activity" recordId={item.id}/> : <Trophy className="size-4 text-stone-400"/>}{item.name}
          </div>)}
          {canWrite ? <Button variant="secondary" onClick={()=>{setQuickAdd('competition');setQuickName('');}}><Plus className="size-4"/> 新建赛事</Button> : null}
        </Card>
      </div>}
    </>}
    {selected ? <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">比赛详情 · {selected.matchDate}</h2>
        <Button variant="ghost" size="icon" aria-label="关闭" onClick={() => setSelected(null)}><X className="size-4"/></Button></div>
      <p className="text-base font-medium">{teamNames.get(selected.representativeTeamId) ?? '代表球队'} {selected.representativeTeamScore ?? '–'} : {selected.opponentTeamScore ?? '–'} {teamNames.get(selected.opponentTeamId) ?? '对方球队'}</p>
      {selected.notes ? <p className="text-sm text-stone-500">{selected.notes}</p> : null}
      <div className="flex items-center justify-between"><h3 className="font-medium">进球记录</h3>{canWrite ? <Button variant="secondary" onClick={() => setGoalDraft({scorerPersonId:'',goalMethod:'',notes:''})}><Plus className="size-4"/> 进球</Button> : null}</div>
      {goals.filter(g => g.matchId === selected.id).map(g=><div key={g.id} className="flex items-center gap-2 rounded-xl bg-stone-50 p-3 text-sm">
        <Trophy className="size-4 text-amber-600"/><span className="flex-1">{membersByPersonId.get(g.scorerPersonId) ?? '家庭成员'} · {methodName[g.goalMethod || ''] ?? '方式未填'} {g.notes ? ' · '+g.notes : ''}</span>
        {canWrite ? <Button variant="ghost" size="icon" disabled={saving} onClick={() => void deleteRecord('football_goal',g.id,g.version)}><Trash2 className="size-4"/></Button> : null}
      </div>)}
      {canWrite ? <Button variant="ghost" onClick={() => void deleteRecord('football_match',selected.id,selected.version)}><Trash2 className="size-4"/> 删除比赛</Button> : null}
    </Card> : null}
    {draft && spaceId ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 sm:items-center sm:p-6" role="presentation">
      <form onSubmit={saveMatch} role="dialog" aria-modal="true" aria-label="编辑足球比赛" className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between"><h2 className="font-semibold">{editing ? '编辑' : '新建'}比赛</h2><Button type="button" variant="ghost" onClick={()=>setDraft(null)}><X className="size-4"/></Button></div>
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>比赛日期 *<input type="date" required className={classInput} value={draft.matchDate} onChange={e=>setDraft({...draft,matchDate:e.target.value})}/></label>
          <label className={field}>类型<select className={classInput} value={draft.matchType} onChange={e=>setDraft({...draft,matchType:e.target.value as MatchDraft['matchType']})}><option value="official">正式比赛</option><option value="friendly">友谊赛</option></select></label>
        </div>
        <label className={field}>赛事 (Activity)<select className={classInput} value={draft.competitionActivityId} onChange={e=>setDraft({...draft,competitionActivityId:e.target.value})}>
          <option value="">不关联赛事</option>{competitions.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <Button type="button" variant="ghost" onClick={()=>{setQuickAdd('competition');setQuickName('');}}>＋ 新建赛事</Button>
        <div className="grid grid-cols-2 gap-3">
          {(['representativeTeamId','opponentTeamId'] as const).map(key=><label className={field} key={key}>{key==='representativeTeamId'?'代表球队 *':'对手球队 *'}
            <select className={classInput} required value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}><option value="">请选择</option>{teams.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>)}
        </div>
        <Button type="button" variant="ghost" onClick={()=>{setQuickAdd('team');setQuickName('');}}>＋ 新建球队</Button>
        <div className="grid grid-cols-2 gap-3">
          {(['representativeTeamScore','opponentTeamScore'] as const).map(key=><label className={field} key={key}>{key==='representativeTeamScore'?'我方比分':'对方比分'}
            <input type="number" min={0} className={classInput} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})} placeholder="赛前可留空"/></label>)}
        </div>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">参赛成员</legend><div className="grid grid-cols-2 gap-2">
          {members.filter(m=>m.personId).map(m=><label key={m.personId} className="flex gap-2 text-sm"><input type="checkbox" checked={draft.playerPersonIds.includes(m.personId!)}
            onChange={e=>setDraft({...draft,playerPersonIds:e.target.checked?[...draft.playerPersonIds,m.personId!]:draft.playerPersonIds.filter(id=>id!==m.personId)})}/>{m.displayName||'家庭成员'}</label>)}
        </div></fieldset>
        <label className={field}>备注<textarea className="min-h-20 w-full rounded-xl border border-stone-200 p-3" value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={()=>setDraft(null)}>取消</Button><Button variant="primary" type="submit" disabled={saving}>保存比赛</Button></div>
      </form>
    </div> : null}
    {goalDraft ? <div className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6" role="presentation">
      <form onSubmit={saveGoal} role="dialog" aria-modal="true" aria-label="记录进球" className="w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <h2 className="font-semibold">添加进球</h2>
        <label className={field}>进球人 *<select required className={classInput} value={goalDraft.scorerPersonId} onChange={e=>setGoalDraft({...goalDraft,scorerPersonId:e.target.value})}>
          <option value="">选择成员</option>{members.filter(m=>m.personId).map(m=><option key={m.personId} value={m.personId}>{m.displayName||'家庭成员'}</option>)}</select></label>
        <label className={field}>方式<select className={classInput} value={goalDraft.goalMethod} onChange={e=>setGoalDraft({...goalDraft,goalMethod:e.target.value})}><option value="">未填写</option>
          {Object.entries(methodName).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className={field}>备注<textarea className="min-h-16 w-full rounded-xl border border-stone-200 p-3" value={goalDraft.notes} onChange={e=>setGoalDraft({...goalDraft,notes:e.target.value})}/></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={()=>setGoalDraft(null)}>取消</Button><Button type="submit" variant="primary" disabled={saving}>保存</Button></div>
      </form>
    </div> : null}
    {quickAdd ? <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6" role="presentation">
      <form onSubmit={saveReference} role="dialog" aria-modal="true" aria-label="快速新建" className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <h2 className="font-semibold">新建{quickAdd==='team'?'球队':'赛事'}</h2>
        <div className="flex items-center gap-2">{spaceId ? <RecordIconField icon={quickIcon} onChange={setQuickIcon} spaceId={spaceId} modelKey={quickAdd === 'team' ? 'person_group' : 'activity'}/> : null}
          <label className={`${field} flex-1`}>名称 *<input className={classInput} required maxLength={100} value={quickName} onChange={e=>setQuickName(e.target.value)}/></label></div>
        <p className="text-xs text-stone-500">创建为 LifeSpace {quickAdd==='team'?'PersonGroup':'Activity'}，可稍后补充人员、说明或图标。</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={()=>setQuickAdd(null)}>取消</Button><Button type="submit" variant="primary" disabled={saving}>创建并选中</Button></div>
      </form>
    </div> : null}
  </div>;
}
