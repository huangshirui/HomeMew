import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { ApiError, apiRequest } from '../lib/api-client';
import { queryModelRecords } from '../lib/canonical-query';
import { RecordIconMark } from '../components/record-icon';
import { type FootballReference, modelUrl } from './football-domain';
import { readRecentFootballReferences, rememberFootballReference, forgetFootballReference, type RecentFootballReference } from './football-recent-references';

type ReferenceModel = 'person_group' | 'activity';

type Props = {
  spaceId: string;
  userId: string;
  model: ReferenceModel;
  value: string;
  onChange: (id: string) => void;
  label: string;
  known: FootballReference[];
  optional?: boolean;
  disabled?: boolean;
  className?: string;
};

const inputClass = 'h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500';

// Keep the named-record search in LifeSpace; never derive options from an unbounded local table scan.
// Canonical Query search is substring LIKE today: debounce and require two characters to limit cost.
export function FootballReferencePicker({
  spaceId, userId, model, value, onChange, label, known, optional = false, disabled = false, className = '',
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<FootballReference[]>([]);
  const [resolved, setResolved] = useState<FootballReference | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<RecentFootballReference[]>([]);
  const [validatingId, setValidatingId] = useState('');
  const serial = useRef(0);
  const selected = useMemo(() => known.find(item => item.id === value)
    ?? matches.find(item => item.id === value)
    ?? (resolved?.id === value ? resolved : null),
    [known, matches, resolved, value]);

  useEffect(() => {
    setOpen(false); setSearch(''); setMatches([]); setResolved(null); setError('');
    setRecent(readRecentFootballReferences(userId, spaceId, model));
    ++serial.current;
  }, [spaceId, userId, model]);

  // Existing references may fall outside the first page of any query. Resolve by exact ID.
  useEffect(() => {
    if (!spaceId || !value || selected) return;
    let active = true;
    apiRequest<FootballReference>(modelUrl(spaceId, model, value))
      .then(item => { if (active) setResolved(item); })
      .catch(() => { if (active) setResolved(null); });
    return () => { active = false; };
  }, [spaceId, model, value, selected]);

  useEffect(() => {
    if (!open || !spaceId) return;
    const term = search.trim();
    const sufficient = [...term].length >= 2;
    const ticket = ++serial.current;
    if (!sufficient) {
      // With an empty search, show only user-picked recents; do not scan unrelated models.
      setMatches([]); setBusy(false); setError(term ? '请输入至少两个字符' : '');
      return;
    }
    const timer = window.setTimeout(() => {
      setBusy(true); setError('');
      queryModelRecords<FootballReference>(spaceId, model, {
        ...(sufficient ? { search: { text: term } } : {}),
        sort: [{ field: 'name', direction: 'asc' }],
        page: { limit: 20 },
      }).then(page => {
        if (ticket !== serial.current) return;
        setMatches(page.items);
        setError(page.nextCursor ? '仅展示前 20 条，请继续输入名称缩小范围' : '');
      }).catch(cause => {
        if (ticket !== serial.current) return;
        setMatches([]);
        setError(cause instanceof Error ? cause.message : '搜索失败');
      }).finally(() => { if (ticket === serial.current) setBusy(false); });
    }, 320);
    return () => { window.clearTimeout(timer); ++serial.current; };
  }, [open, search, spaceId, model]);

  const choose = (id: string, reference?: Pick<FootballReference, 'id' | 'name'>) => {
    if (reference && id) {
      setRecent(rememberFootballReference(userId, spaceId, model, reference));
      setResolved(prev => prev?.id === id ? prev : { id, name: reference.name, version: 0 });
    }
    onChange(id);
    setSearch('');
    setOpen(false);
  };
  const chooseRecent = async (item: RecentFootballReference) => {
    if (validatingId) return;
    setValidatingId(item.id);
    try {
      // A cached name/ID is only a hint; verify current LifeSpace read authorization and existence.
      const record = await apiRequest<FootballReference>(modelUrl(spaceId, model, item.id));
      if (record.id !== item.id) throw Error('缓存记录已失效');
      choose(record.id, record);
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status ?? 0)) {
        setRecent(forgetFootballReference(userId, spaceId, model, item.id));
        setError('该记录已不可访问，已从本机最近使用中移除');
      } else {
        // Network outages and server failures must not silently erase valid local recents.
        setError('暂时无法验证缓存记录，请重试；本机缓存已保留');
      }
    } finally { setValidatingId(''); }
  };
  const removeRecent = (id: string) => {
    setRecent(forgetFootballReference(userId, spaceId, model, id));
  };
  const toggleOpen = () => {
    if (!open) setRecent(readRecentFootballReferences(userId, spaceId, model));
    setOpen(v => !v);
  };
  return <div className={className}>
    <label id={id + '-label'} className="mb-1 block text-sm font-medium text-stone-700">
      {label}{!optional && ' *'}
    </label>
    <div className="relative">
      <button type="button" disabled={disabled} aria-expanded={open} aria-haspopup="listbox"
        aria-labelledby={id + '-label'} aria-controls={id + '-options'}
        onClick={toggleOpen}
        className={inputClass + ' flex items-center justify-between gap-2 text-left disabled:opacity-50'}>
        <span className={'min-w-0 truncate ' + (value ? 'text-stone-800' : 'text-stone-400')}>
          {value ? selected?.name ?? '正在读取选中项…' : optional ? '全部 / 不指定' : '搜索并选择'}
        </span>
        <ChevronDown className="size-4 shrink-0 text-stone-500"/>
      </button>
      {open && <div id={id + '-options'} role="listbox" aria-labelledby={id + '-label'}
        className="relative z-30 mt-2 rounded-2xl border border-stone-200 bg-white p-2 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-stone-400"/>
          <input autoFocus autoComplete="off" value={search}
            className={inputClass + ' pl-9 pr-9'} placeholder={'搜索' + label + '名称'}
            aria-label={'搜索' + label + '名称'} onChange={e => setSearch(e.target.value)}/>
          {search && <button type="button" onClick={() => setSearch('')}
            aria-label="清除搜索词" className="absolute right-2 top-2 rounded-lg p-1 text-stone-500">
            <X className="size-4"/>
          </button>}
        </div>
        {!search.trim() && recent.length > 0 && <div className="mb-2 border-b border-stone-100 pb-2">
          <p className="px-2 py-1 text-xs text-stone-500">本机最近选择 · × 仅移除缓存</p>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {recent.map(item => <div key={item.id} className="flex min-h-10 items-center gap-1 rounded-lg hover:bg-stone-50">
              <button type="button" role="option" aria-selected={item.id === value}
                disabled={Boolean(validatingId)}
                onClick={() => void chooseRecent(item)}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-stone-800">
                {item.name}{item.id === value && <span className="ml-2 text-emerald-700">✓</span>}
              </button>
              <button type="button" aria-label={'从本机缓存移除' + item.name}
                onClick={() => removeRecent(item.id)} title="只移除本机缓存，不删除球队或赛事"
                className="mr-1 rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                <X className="size-4"/>
              </button>
            </div>)}
          </div>
          {validatingId && <p className="px-2 text-xs text-stone-400">验证缓存记录中…</p>}
        </div>}
        <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
          {optional && <button type="button" role="option" aria-selected={!value}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50"
            onClick={() => choose('')}>全部 / 不指定</button>}
          {matches.map(item => <button type="button" key={item.id} role="option"
            aria-selected={item.id === value}
            onClick={() => choose(item.id, item)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50">
            {item.presentation?.icon && <RecordIconMark icon={item.presentation.icon} spaceId={spaceId}
              modelKey={model} recordId={item.id}/>}
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {item.id === value && <span className="text-emerald-700">✓</span>}
          </button>)}
          {!busy && !matches.length && !error && <p className="px-2 py-3 text-sm text-stone-500">{search.trim() ? '没有找到匹配记录' : '输入至少两个字搜索更多记录'}</p>}
        </div>
        {busy && <p className="px-2 py-1 text-xs text-stone-500">正在搜索…</p>}
        {error && <p role="status" className="px-2 py-1 text-xs text-stone-500">{error}</p>}
      </div>}
    </div>
  </div>;
}
