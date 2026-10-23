import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { RecordIconField, RecordIconMark, emptyIconDraft, iconDraftFor, presentationToSave, type RecordIconDraft } from '../components/record-icon';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { apiRequest } from '../lib/api-client';
import { queryModelRecords } from '../lib/canonical-query';
import { useModalScrollLock } from '../lib/modal-scroll';
import { type FootballMatch, type FootballPerformance, type FootballPerson, type FootballReference, modelUrl } from './football-domain';
import { FootballReferencePicker } from './football-reference-picker';
import { readRecentFootballReferences, rememberFootballReference } from './football-recent-references';

const input = 'h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500';
const personPath = (space: string, id?: string) => '/api/lifespace/core/v1/spaces/' + encodeURIComponent(space) +
  '/people' + (id ? '/' + encodeURIComponent(id) : '');
type EditablePerson = FootballPerson & { version: number; linkedUser?: boolean };
type PeopleResult = { items: EditablePerson[]; nextCursor: string | null };
type TeamDraft = { name: string; description: string; icon: RecordIconDraft };

function failure(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }

/** The football module manages non-member Persons, never the membership-linked Family directory. */
export function FootballManagePage() {
  const { currentFamily, user, members, loading: familyLoading } = useHousehold();
  const navigate = useNavigate();
  const spaceId = currentFamily?.id ?? '';
  const canWrite = Boolean(currentFamily && currentFamily.role !== 'viewer');
  const [tab, setTab] = useState<'teams' | 'players'>('teams');
  const [teams, setTeams] = useState<FootballReference[]>([]);
  const [teamFocus, setTeamFocus] = useState('');
  const [players, setPlayers] = useState<EditablePerson[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerCursor, setPlayerCursor] = useState<string | null>(null);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [editingTeam, setEditingTeam] = useState<FootballReference | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft | null>(null);
  const [editingPerson, setEditingPerson] = useState<EditablePerson | null>(null);
  const [personDraft, setPersonDraft] = useState('');
  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const familyPersonIds = useMemo(() => new Set(members.map(item => item.personId).filter(Boolean)), [members]);
  const editablePlayers = players.filter(p => !p.linkedUser && !familyPersonIds.has(p.id));
  useModalScrollLock(Boolean(teamDraft || personDialogOpen));

  // Show actual football-used and device-recent teams, not every PersonGroup in the Space.
  useEffect(() => {
    if (!spaceId || !user?.id) { setTeams([]); return; }
    let alive = true;
    async function hydrate() {
      const ids = new Set(readRecentFootballReferences(user!.id, spaceId, 'person_group').map(x => x.id));
      try {
        const page = await queryModelRecords<FootballMatch>(spaceId, 'football_match',
          { sort: [{ field: 'matchDate', direction: 'desc' }], page: { limit: 50 } });
        for (const match of page.items) { ids.add(match.representativeTeamId); ids.add(match.opponentTeamId); }
      } catch (cause) { if (alive) setError(failure(cause)); }
      const records = await Promise.all([...ids].slice(0, 60).map(id =>
        apiRequest<FootballReference>(modelUrl(spaceId, 'person_group', id)).catch(() => null)));
      if (alive) setTeams(records.filter((record): record is FootballReference => record !== null));
    }
    void hydrate();
    return () => { alive = false; };
  }, [spaceId, user?.id]);

  const fetchPlayers = useCallback(async (query: string, cursor: string | null, append: boolean) => {
    if (!spaceId) return;
    setPlayerBusy(true);
    try {
      const url = personPath(spaceId) + '?limit=50' +
        (query.trim() ? '&q=' + encodeURIComponent(query.trim()) : '') +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const result = await apiRequest<PeopleResult>(url);
      setPlayers(prev => append ? [...new Map([...prev, ...result.items].map(x => [x.id, x])).values()] : result.items);
      setPlayerCursor(result.nextCursor);
    } catch (cause) { setError(failure(cause)); }
    finally { setPlayerBusy(false); }
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId || tab !== 'players') return;
    let active = true;
    const timer = window.setTimeout(() => { if (active) void fetchPlayers(playerSearch, null, false); }, 270);
    return () => { active = false; window.clearTimeout(timer); };
  }, [spaceId, tab, playerSearch, fetchPlayers]);

  const startTeam = (record?: FootballReference, name = '') => {
    setEditingTeam(record ?? null);
    setTeamDraft({ name: record?.name ?? name, description: record?.description ?? '',
      icon: iconDraftFor(record?.presentation?.icon) });
    setError('');
  };
  const saveTeam = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!spaceId || !canWrite || !teamDraft || busy) return;
    setBusy(true); setError('');
    try {
      const presentation = await presentationToSave(spaceId, 'person_group', teamDraft.icon, editingTeam?.presentation?.icon);
      const payload = editingTeam
        ? { name: teamDraft.name.trim(), description: teamDraft.description.trim() || null, version: editingTeam.version, ...presentation }
        : { name: teamDraft.name.trim(), description: teamDraft.description.trim() || null, memberPersonIds: [], ...presentation };
      const ref = await apiRequest<FootballReference>(modelUrl(spaceId, 'person_group', editingTeam?.id), {
        method: editingTeam ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      setTeams(prev => [...new Map([...prev.filter(x => x.id !== ref.id), ref].map(x => [x.id, x])).values()]);
      rememberFootballReference(user?.id ?? '', spaceId, 'person_group', ref);
      setTeamFocus(ref.id); setTeamDraft(null); setEditingTeam(null); setSuccess('球队已保存');
    } catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  };
  const deleteTeam = async (ref: FootballReference) => {
    if (!spaceId || !canWrite || busy) return;
    setBusy(true); setError('');
    try {
      for (const field of ['representativeTeamId','opponentTeamId']) {
        const result = await queryModelRecords<FootballMatch>(spaceId, 'football_match',
          { filter: { field, op: 'contains', value: ref.id }, page: { limit: 1 } });
        if (result.items.length) throw Error('球队被比赛引用，请先修改相关比赛');
      }
      if (!window.confirm('删除球队“' + ref.name + '”？它可能还被其他应用使用。')) return;
      await apiRequest(modelUrl(spaceId, 'person_group', ref.id), {
        method: 'DELETE', body: JSON.stringify({ version: ref.version }),
      });
      setTeams(prev => prev.filter(x => x.id !== ref.id)); setTeamFocus(''); setSuccess('球队已删除');
    } catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  };
  const startPlayer = (record?: EditablePerson) => {
    setEditingPerson(record ?? null); setPersonDraft(record?.displayName ?? ''); setPersonDialogOpen(true); setError('');
  };
  const savePlayer = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!spaceId || !canWrite || busy || !personDraft.trim()) return;
    if (editingPerson?.linkedUser || (editingPerson && familyPersonIds.has(editingPerson.id))) {
      setError('家庭成员由家庭管理维护，不能在足球中修改'); return;
    }
    setBusy(true); setError('');
    try {
      const person = await apiRequest<EditablePerson>(personPath(spaceId, editingPerson?.id), {
        method: editingPerson ? 'PATCH' : 'POST',
        body: JSON.stringify({ displayName: personDraft.trim(),
          ...(editingPerson ? { version: editingPerson.version } : {}) }),
      });
      setPlayers(prev => [...new Map([...prev.filter(x => x.id !== person.id), person].map(x => [x.id, x])).values()]);
      setEditingPerson(null); setPersonDraft(''); setPersonDialogOpen(false); setSuccess('球员已保存');
    } catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  };
  const deletePlayer = async (person: EditablePerson) => {
    if (!spaceId || !canWrite || busy || person.linkedUser || familyPersonIds.has(person.id)) return;
    setBusy(true); setError('');
    try {
      const refs = await Promise.all([
        queryModelRecords<FootballMatch>(spaceId, 'football_match', {
          filter: { field: 'playerPersonIds', op: 'contains', value: person.id }, page: { limit: 1 },
        }),
        queryModelRecords<FootballPerformance>(spaceId, 'football_performance', {
          filter: { field: 'playerPersonId', op: 'contains', value: person.id }, page: { limit: 1 },
        }),
      ]);
      if (refs.some(result => result.items.length)) throw Error('球员被比赛或表现记录引用，请先处理关联');
      if (!window.confirm('删除球员“' + person.displayName + '”？该 Person 可能被其他模块使用。')) return;
      await apiRequest(personPath(spaceId, person.id), {
        method: 'DELETE', body: JSON.stringify({ version: person.version }),
      });
      setPlayers(prev => prev.filter(x => x.id !== person.id)); setSuccess('球员已删除');
    } catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  };

  if (familyLoading) return <Card className="p-6">正在读取家庭资料…</Card>;
  return <div className="space-y-4">
    <PageHeader title="球队与球员管理">
      <Button variant="secondary" onClick={() => navigate('/football')}>
        <ChevronLeft className="size-4"/> 返回足球比赛
      </Button>
      <Button variant="secondary" onClick={() => navigate('/activities')}>赛事管理 → 活动</Button>
    </PageHeader>
    <div className="flex gap-2">
      {[{id:'teams' as const,title:'球队'},{id:'players' as const,title:'球员'}].map(entry =>
        <Button key={entry.id} variant={tab === entry.id ? 'primary' : 'secondary'} onClick={() => setTab(entry.id)}>
          {entry.title}
        </Button>)}
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {!spaceId ? <Card className="p-6">请先选择家庭。</Card> :
      tab === 'teams' ? <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-stone-500">最近使用及已记录比赛中的球队。其他 PersonGroup 可以通过名称搜索定位。</p>
          {canWrite && <Button variant="primary" onClick={() => startTeam()}><Plus className="size-4"/> 新建球队</Button>}
        </div>
        <FootballReferencePicker userId={user?.id ?? ''} spaceId={spaceId} model="person_group"
          label="搜索定位球队" optional known={teams} value={teamFocus}
          onChange={id => {setTeamFocus(id); if (id && !teams.some(item => item.id === id)) {
            void apiRequest<FootballReference>(modelUrl(spaceId, 'person_group', id))
              .then(item => setTeams(prev => [...prev, item])).catch(cause => setError(failure(cause)));
          }}}/>
        <div className="divide-y divide-stone-100">
          {teams.filter(item => !teamFocus || item.id === teamFocus).map(team =>
            <div key={team.id} className="flex items-center gap-3 py-3">
              {team.presentation?.icon && <RecordIconMark icon={team.presentation.icon}
                spaceId={spaceId} modelKey="person_group" recordId={team.id}/>}
              <span className="min-w-0 flex-1 truncate text-sm">{team.name}</span>
              {canWrite && <>
                <Button variant="ghost" onClick={() => startTeam(team)}>编辑</Button>
                <Button variant="ghost" size="icon" aria-label={'删除球队' + team.name}
                  disabled={busy} onClick={() => void deleteTeam(team)}><Trash2 className="size-4"/></Button>
              </>}
            </div>)}
          {!teams.length && <p className="p-4 text-sm text-stone-500">暂无已用球队，可搜索已有 PersonGroup 或新建球队。</p>}
        </div>
      </Card> : <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-stone-500">只管理未关联登录用户的 Space Person；家庭成员在家庭管理中维护。</p>
          {canWrite && <Button variant="primary" onClick={() => startPlayer()}><Plus className="size-4"/> 新建球员</Button>}
        </div>
        <input className={input} placeholder="搜索球员姓名" value={playerSearch}
          onChange={e => setPlayerSearch(e.target.value)}/>
        <div className="divide-y divide-stone-100">
          {editablePlayers.map(person => <div key={person.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1 truncate text-sm">{person.displayName}</span>
            {canWrite && <>
              <Button variant="ghost" onClick={() => startPlayer(person)}>编辑</Button>
              <Button variant="ghost" size="icon" aria-label={'删除球员' + person.displayName}
                disabled={busy} onClick={() => void deletePlayer(person)}><Trash2 className="size-4"/></Button>
            </>}
          </div>)}
          {!playerBusy && !editablePlayers.length && <p className="p-4 text-sm text-stone-500">没有找到可管理的非家庭球员</p>}
        </div>
        {playerBusy && <p className="text-xs text-stone-500">正在加载球员…</p>}
        {playerCursor && <Button variant="secondary" className="w-full"
          disabled={playerBusy} onClick={() => void fetchPlayers(playerSearch, playerCursor, true)}>加载更多球员</Button>}
      </Card>}
    {teamDraft && <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 sm:items-center sm:p-6">
      <form role="dialog" aria-modal="true" aria-label="编辑球队" className="w-full max-w-md space-y-3 rounded-t-3xl bg-white p-5 sm:rounded-3xl"
        onSubmit={saveTeam}>
        <h2 className="text-lg font-semibold">{editingTeam ? '编辑球队' : '新建球队'}</h2>
        <RecordIconField spaceId={spaceId} modelKey="person_group" icon={teamDraft.icon}
          recordId={editingTeam?.id} original={editingTeam?.presentation?.icon}
          onChange={icon => setTeamDraft(prev => prev ? {...prev,icon} : prev)}/>
        <label className="block text-sm">球队名称 *
          <input autoFocus required maxLength={100} className={input} value={teamDraft.name}
            onChange={e => setTeamDraft(prev => prev ? {...prev,name:e.target.value} : prev)}/>
        </label>
        <label className="block text-sm">说明
          <textarea className="min-h-20 w-full rounded-xl border border-stone-200 p-3" value={teamDraft.description}
            onChange={e => setTeamDraft(prev => prev ? {...prev,description:e.target.value} : prev)}/>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setTeamDraft(null)} disabled={busy}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy}>保存</Button>
        </div>
      </form>
    </div>}
    {personDialogOpen ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 sm:items-center sm:p-6">
      <form role="dialog" aria-modal="true" aria-label="编辑球员" className="w-full max-w-md space-y-3 rounded-t-3xl bg-white p-5 sm:rounded-3xl"
        onSubmit={savePlayer}>
        <h2 className="font-semibold">{editingPerson ? '编辑球员' : '新建球员'}</h2>
        <label className="block text-sm">姓名 *
          <input autoFocus required maxLength={100} className={input} value={personDraft}
            onChange={e => setPersonDraft(e.target.value)}/>
        </label>
        <p className="text-xs text-stone-500">创建非家庭成员 Space Person，不自动加入家庭，也不产生登录账号。</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" disabled={busy} onClick={() => {setPersonDraft('');setEditingPerson(null);setPersonDialogOpen(false);}}>取消</Button>
          <Button variant="primary" type="submit" disabled={busy}>保存</Button>
        </div>
      </form>
    </div> : null}
  </div>;
}
