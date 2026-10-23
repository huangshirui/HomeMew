import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { FamilyMember } from '../components/household-provider';
import { apiRequest } from '../lib/api-client';
import type { FootballPerson } from './football-domain';

type Props = {
  spaceId: string; members: FamilyMember[];
  selected: string[]; onChange: (ids: string[]) => void;
  multiple?: boolean; label?: string; disabled?: boolean;
  onCreate?: (name: string) => void;
  knownPeople?: FootballPerson[];
};
const input = 'h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500';

export function FootballPersonPicker({ spaceId, members, selected, onChange, multiple = false, label = '球员', disabled, onCreate, knownPeople = [] }: Props) {
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<FootballPerson[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState('');
  const [failure, setFailure] = useState('');
  const family = useMemo(() => members.filter(m => m.personId).map(m => ({
    id: m.personId!, displayName: m.displayName || '家庭成员',
  })), [members]);
  const selectedNames = useMemo(() => new Map([...family, ...knownPeople, ...people].map(p => [p.id, p.displayName])), [family, knownPeople, people]);
  useEffect(() => { setSearch(''); setPeople([]); setOpen(false); setSearched(''); }, [spaceId]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSearched('');
    setBusy(true);
    const timer = window.setTimeout(() => {
      setBusy(true); setFailure('');
      const query = search.trim();
      apiRequest<{ items: FootballPerson[]; nextCursor: string | null }>(
        '/api/lifespace/core/v1/spaces/' + encodeURIComponent(spaceId) + '/people?limit=50' +
        (query ? '&q=' + encodeURIComponent(query) : ''),
      ).then(result => { if (alive) { setPeople(result.items); setSearched(query); } })
        .catch(error => { if (alive) { setSearched(''); setPeople([]); setFailure(error instanceof Error ? error.message : '搜索失败'); } })
        .finally(() => { if (alive) setBusy(false); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [open, search, spaceId]);
  const candidateMap = new Map([...family, ...knownPeople, ...people].map(person => [person.id, person]));
  const candidates = [...candidateMap.values()].filter(person => !search.trim() ||
    person.displayName.toLowerCase().includes(search.trim().toLowerCase()) ||
    people.some(p => p.id === person.id));
  const toggle = (id: string) => {
    if (multiple) onChange(selected.includes(id) ? selected.filter(p => p !== id) : [...selected, id]);
    else { onChange([id]); setOpen(false); }
  };
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm font-medium text-stone-700">{label}</label>
      <button type="button" disabled={disabled} className="text-xs text-emerald-700" onClick={() => setOpen(!open)}>
        {open ? '收起选择' : '搜索选择'}
      </button>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {selected.length ? selected.map(id =>
        <span key={id} className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
          {selectedNames.get(id) ?? '已选择球员'}
          {!disabled && <button type="button" aria-label="取消选择" className="ml-1.5" onClick={() => onChange(selected.filter(p => p !== id))}>×</button>}
        </span>,
      ) : <span className="text-xs text-stone-400">尚未选择</span>}
    </div>
    {open && <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-2">
      <div className="relative"><Search className="absolute left-3 top-3 size-4 text-stone-400"/>
        <input autoComplete="off" className={input + ' pl-9'} placeholder="搜索家庭成员或其他球员" value={search} onChange={e => setSearch(e.target.value)}/>
      </div>
      <p className="px-1 text-xs text-stone-400">家庭成员优先 · 其他 Space Person 按姓名搜索</p>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {candidates.map(p =>
          <button type="button" key={p.id} onClick={() => toggle(p.id)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50">
            <span>{p.displayName}{family.some(m => m.id === p.id) && <span className="ml-1 text-xs text-emerald-600">家庭</span>}</span>
            {selected.includes(p.id) && <span className="text-emerald-700">✓</span>}
          </button>)}
      </div>
      {busy && <p className="px-2 text-xs text-stone-400">正在搜索…</p>}
      {failure && <p role="alert" className="px-2 text-xs text-red-700">{failure}</p>}
      {!busy && !candidates.length && <p className="px-2 text-xs text-stone-400">没有找到匹配的球员</p>}
      {onCreate && !disabled && !busy && !failure && !candidates.length &&
        search.trim().length >= 2 && searched === search.trim() && <button type="button"
          className="w-full rounded-xl bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-800"
          onClick={() => { onCreate(search.trim()); setOpen(false); }}>
          + 新建球员“{search.trim()}”
        </button>}
      {multiple && <button type="button" className="w-full rounded-lg bg-stone-100 py-2 text-sm" onClick={() => setOpen(false)}>完成</button>}
    </div>}
  </div>;
}
