import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, CalendarClock, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { showScrollbarWhileScrolling } from '../components/ui/modal-behavior';
import { ApiError, apiRequest } from '../lib/api-client';
import { queryModelRecords } from '../lib/canonical-query';

type ContainerModel = 'activity' | 'goal' | 'habit';
type EntityRef = { kind: 'record'; modelKey: string; recordId: string };
type Relation = { id: string; source: EntityRef; target: EntityRef; sourceLabel?: string; targetLabel?: string };
type Page<T> = { items: T[]; nextCursor: string | null };
type Candidate = { id: string; name?: string; summary?: string };
type Countdown = { name: string; anchorDate: string; kind: string };
const models = [
  { key: 'task', title: '待办', route: '/tasks' },
  { key: 'event', title: '日程', route: '/calendar' },
  { key: 'day_record', title: '日子', route: '/days' },
  { key: 'activity', title: '活动', route: '/activities' },
  { key: 'goal', title: '目标', route: '/goals' },
  { key: 'habit', title: '习惯', route: '/habits' },
  { key: 'anniversary', title: '纪念日', route: '/anniversaries' },
  { key: 'wish', title: '许愿池', route: '/wishes' },
] as const;
const modelName = (key: string) => models.find(model => model.key === key)?.title ?? key;
const core = (spaceId: string) => `/api/lifespace/core/v1/spaces/${encodeURIComponent(spaceId)}`;
const ref = (modelKey: string, recordId: string): EntityRef => ({ kind: 'record', modelKey, recordId });
const explain = (reason: unknown) => reason instanceof ApiError
  ? reason.message + (reason.requestId ? ' · ' + reason.requestId : '')
  : reason instanceof Error ? reason.message : '请求失败';

function daysUntil(anchorDate: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) => Number(parts.find(entry => entry.type === name)?.value);
  const today = Date.UTC(part('year'), part('month') - 1, part('day'));
  const anchor = Date.parse(`${anchorDate}T00:00:00Z`);
  return Math.round((anchor - today) / 86_400_000);
}

export function ContainerRelations({ spaceId, modelKey, record, timezone, writable, onClose }: {
  spaceId: string;
  modelKey: ContainerModel;
  record: { id: string; name: string; description?: string | null; endDate?: string | null; targetDate?: string | null };
  timezone: string;
  writable: boolean;
  onClose: () => void;
}) {
  const [outgoing, setOutgoing] = useState<Relation[]>([]);
  const [incoming, setIncoming] = useState<Relation[]>([]);
  const [outCursor, setOutCursor] = useState<string | null>(null);
  const [inCursor, setInCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('task');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateCursor, setCandidateCursor] = useState<string | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [countdownOpen, setCountdownOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [countdownName, setCountdownName] = useState('');
  const [countdownDate, setCountdownDate] = useState('');
  const [countdowns, setCountdowns] = useState<Record<string, Countdown>>({});
  const relationsUrl = `${core(spaceId)}/semantic-relations`;

  const queryRelations = useCallback(async (direction: 'source' | 'target', cursor: string | null) => {
    const params = new URLSearchParams({
      [direction === 'source' ? 'sourceModelKey' : 'targetModelKey']: modelKey,
      [direction === 'source' ? 'sourceRecordId' : 'targetRecordId']: record.id,
      predicate: 'relates_to', hydrate: direction === 'source' ? 'target' : 'source', limit: '50',
    });
    if (cursor) params.set('cursor', cursor);
    return apiRequest<Page<Relation>>(`${relationsUrl}?${params}`);
  }, [relationsUrl, modelKey, record.id]);

  const refreshRelations = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [from, to] = await Promise.all([queryRelations('source', null), queryRelations('target', null)]);
      setOutgoing(from.items); setOutCursor(from.nextCursor);
      setIncoming(to.items); setInCursor(to.nextCursor);
    } catch (cause) { setError(explain(cause)); }
    finally { setLoading(false); }
  }, [queryRelations]);

  useEffect(() => { void refreshRelations(); }, [refreshRelations]);

  useEffect(() => {
    let cancelled = false;
    // Only fetch a small bounded set of linked Day Records for countdown cards.
    const dayLinks = outgoing.filter(edge => edge.target.modelKey === 'day_record').slice(0, 12);
    if (!dayLinks.length) { setCountdowns({}); return; }
    void Promise.all(dayLinks.map(async edge => {
      try {
        const day = await apiRequest<Countdown>(`${core(spaceId)}/models/day_record/records/${encodeURIComponent(edge.target.recordId)}`);
        return { id: edge.target.recordId, day };
      } catch { return null; } // The relation is still visible even when a target detail cannot be projected.
    })).then(results => {
      if (!cancelled) setCountdowns(Object.fromEntries(results.filter((item): item is { id: string; day: Countdown } => Boolean(item))
        .map(item => [item.id, item.day])));
    });
    return () => { cancelled = true; };
  }, [outgoing, spaceId]);

  async function moreRelations(direction: 'source' | 'target') {
    const cursor = direction === 'source' ? outCursor : inCursor;
    if (!cursor || loading) return;
    setLoading(true); setError('');
    try {
      const next = await queryRelations(direction, cursor);
      if (direction === 'source') { setOutgoing(list => [...list, ...next.items]); setOutCursor(next.nextCursor); }
      else { setIncoming(list => [...list, ...next.items]); setInCursor(next.nextCursor); }
    } catch (cause) { setError(explain(cause)); }
    finally { setLoading(false); }
  }

  async function searchCandidates(cursor: string | null = null) {
    if (!search.trim() || candidateLoading) return;
    setCandidateLoading(true); setError('');
    try {
      const page = await queryModelRecords<Candidate>(spaceId, selectedModel, {
        search: { text: search.trim() }, page: { limit: 30, ...(cursor ? { cursor } : {}) },
      });
      const items = page.items.filter(item => !(selectedModel === modelKey && item.id === record.id));
      setCandidates(list => cursor ? [...list, ...items] : items);
      setCandidateCursor(page.nextCursor);
    } catch (cause) { setError(explain(cause)); }
    finally { setCandidateLoading(false); }
  }

  async function link(candidate: Candidate) {
    setWorking(true); setError('');
    try {
      await apiRequest(relationsUrl, {
        method: 'POST', body: JSON.stringify({
          source: ref(modelKey, record.id), predicate: 'relates_to', target: ref(selectedModel, candidate.id),
        }),
      });
      setPickerOpen(false); setCandidates([]); setSearch('');
      await refreshRelations();
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  }

  async function unlink(edge: Relation) {
    if (!writable || !window.confirm('仅移除关联，不会删除被关联的记录。确定继续？')) return;
    setWorking(true); setError('');
    try {
      await apiRequest(`${relationsUrl}/${encodeURIComponent(edge.id)}`, { method: 'DELETE' });
      await refreshRelations();
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  }

  async function addCountdown(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || modelKey !== 'activity' || !countdownDate || !countdownName.trim()) return;
    setWorking(true); setError('');
    try {
      // Native record creation and its association must succeed or fail together; no orphan countdown.
      await apiRequest(`${core(spaceId)}/models/batch`, {
        method: 'POST', body: JSON.stringify({
          atomicConsistency: true,
          operations: [
            { operation: 'create', modelKey: 'day_record', clientRef: 'countdown', data: {
              name: countdownName.trim().slice(0, 100), kind: 'countdown', anchorDate: countdownDate,
            } },
            { operation: 'relation_create', predicate: 'relates_to',
              source: ref('activity', record.id),
              target: { kind: 'record', modelKey: 'day_record', clientRef: 'countdown' } },
          ],
        }),
      });
      setCountdownOpen(false);
      await refreshRelations();
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || !taskName.trim()) return;
    setWorking(true); setError('');
    try {
      // Attach a new task atomically so a failed relation cannot leave an unrelated task behind.
      await apiRequest(`${core(spaceId)}/models/batch`, {
        method: 'POST', body: JSON.stringify({
          atomicConsistency: true,
          operations: [
            { operation: 'create', modelKey: 'task', clientRef: 'task', data: {
              name: taskName.trim().slice(0, 100), dueDate: taskDueDate || null,
            } },
            { operation: 'relation_create', predicate: 'relates_to',
              source: ref(modelKey, record.id),
              target: { kind: 'record', modelKey: 'task', clientRef: 'task' } },
          ],
        }),
      });
      setTaskOpen(false); setTaskName(''); setTaskDueDate('');
      await refreshRelations();
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  }

  function startTask() {
    setTaskName(''); setTaskDueDate('');
    setTaskOpen(true); setPickerOpen(false); setCountdownOpen(false);
  }

  function startCountdown() {
    setCountdownName(`${record.name}倒计时`.slice(0, 100));
    setCountdownDate(record.endDate || '');
    setCountdownOpen(true);
    setPickerOpen(false); setTaskOpen(false);
  }

  function openPicker() {
    setPickerOpen(true); setCountdownOpen(false); setTaskOpen(false);
    setCandidates([]); setSearch(''); setCandidateCursor(null);
  }

  function listing(edges: Relation[], outgoingDirection: boolean) {
    return <div className="space-y-2">
      {edges.map(edge => {
        const target = outgoingDirection ? edge.target : edge.source;
        const title = outgoingDirection ? edge.targetLabel : edge.sourceLabel;
        const model = models.find(item => item.key === target.modelKey);
        return <div key={edge.id} className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2">
          <Link2 className="size-4 shrink-0 text-stone-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-stone-800">{title || target.recordId}</div>
            <div className="text-xs text-stone-500">{modelName(target.modelKey)}{!outgoingDirection ? ' · 此记录关联了当前容器' : ''}</div>
          </div>
          {model ? <a href={model.route} aria-label={`前往${model.title}模块`} className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"><ArrowUpRight className="size-4" /></a> : null}
          {outgoingDirection && writable ? <button type="button" aria-label={`取消关联${title || target.recordId}`}
            disabled={working} onClick={() => void unlink(edge)} className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="size-4" /></button> : null}
        </div>;
      })}
    </div>;
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6"
    role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !working) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={`${record.name}关联内容`} onScroll={showScrollbarWhileScrolling}
      className="max-h-[92dvh] w-full max-w-2xl space-y-5 overflow-y-auto overscroll-contain scrollbar-overlay rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold text-stone-900">{record.name}</h2>
          <p className="text-xs text-stone-500">容器详情 · 关联的记录保留自己的生命周期</p></div>
        <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose} disabled={working}><X className="size-4" /></Button>
      </div>
      {record.description ? <p className="whitespace-pre-wrap text-sm text-stone-600">{record.description}</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {modelKey === 'activity' ? <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">活动倒计时</h3>
          {writable ? <Button variant="secondary" onClick={startCountdown}><CalendarClock className="size-4" /> 新增倒计时</Button> : null}
        </div>
        {Object.entries(countdowns).filter(([, day]) => day.kind === 'countdown').map(([id, day]) => {
          const days = daysUntil(day.anchorDate, timezone);
          return <div key={id} className="flex items-center justify-between rounded-2xl bg-emerald-50 p-4">
            <div className="min-w-0"><p className="font-medium text-emerald-900">{day.name}</p>
              <p className="text-xs text-emerald-700">目标日期 {day.anchorDate}</p></div>
            <div className="text-right"><p className="text-2xl font-bold tabular-nums text-emerald-800">{Math.abs(days)}</p>
              <p className="text-xs text-emerald-700">{days > 0 ? '天后' : days === 0 ? '今天' : '天前'}</p></div>
          </div>;
        })}
        {!outgoing.some(edge => countdowns[edge.target.recordId]?.kind === 'countdown') && !loading
          ? <p className="text-xs text-stone-500">尚未关联倒计时。可使用活动结束日期快速创建一个日子倒计时。</p> : null}
      </section> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">关联内容</h3>
          {writable ? <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={startTask}><Plus className="size-4" /> 新建待办</Button>
            <Button variant="secondary" onClick={openPicker}><Link2 className="size-4" /> 关联已有记录</Button>
          </div> : null}</div>
        {loading && !outgoing.length ? <p className="text-sm text-stone-500">正在加载…</p> : null}
        {!outgoing.length && !loading ? <p className="text-sm text-stone-500">还没有关联日程、待办或其他记录。</p> : listing(outgoing, true)}
        {outCursor ? <Button variant="ghost" disabled={loading} onClick={() => void moreRelations('source')}>加载更多关联</Button> : null}
      </section>

      {incoming.length || inCursor ? <section className="space-y-3 border-t border-stone-100 pt-4">
        <h3 className="text-sm font-semibold">被其他记录关联</h3>
        {listing(incoming, false)}
        {inCursor ? <Button variant="ghost" disabled={loading} onClick={() => void moreRelations('target')}>加载更多</Button> : null}
      </section> : null}

      {pickerOpen ? <section className="space-y-3 rounded-2xl border border-stone-200 p-4">
        <h3 className="font-semibold">关联已有记录</h3>
        <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
          <select aria-label="关联记录类型" className="h-10 rounded-xl border border-stone-200 px-3 text-sm" value={selectedModel}
            onChange={event => { setSelectedModel(event.target.value); setCandidates([]); setCandidateCursor(null); }}>
            {models.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}
          </select>
          <input aria-label="搜索已有记录" className="h-10 min-w-0 rounded-xl border border-stone-200 px-3 text-sm"
            placeholder="输入名称搜索" value={search} onChange={event => { setSearch(event.target.value); setCandidates([]); setCandidateCursor(null); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void searchCandidates(); } }} />
          <Button variant="secondary" disabled={!search.trim() || candidateLoading} onClick={() => void searchCandidates()}><Search className="size-4" /> 搜索</Button>
        </div>
        {candidates.map(item => <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl bg-stone-50 p-3">
          <span className="min-w-0 truncate text-sm">{item.name || item.summary || item.id}</span>
          <Button variant="secondary" disabled={working} onClick={() => void link(item)}>关联</Button>
        </div>)}
        {!candidates.length && !candidateLoading ? <p className="text-xs text-stone-500">选择要添加的内容，原来的内容会保留在原处。</p> : null}
        {candidateCursor ? <Button variant="ghost" disabled={candidateLoading} onClick={() => void searchCandidates(candidateCursor)}>加载更多搜索结果</Button> : null}
        <Button variant="ghost" onClick={() => setPickerOpen(false)}>收起</Button>
      </section> : null}

      {taskOpen ? <form className="space-y-3 rounded-2xl border border-stone-200 p-4" onSubmit={event => void addTask(event)}>
        <h3 className="font-semibold">新建关联待办</h3>
        <p className="text-xs text-stone-500">新建的待办会自动放到这里。</p>
        <label className="block text-sm font-medium">待办名称<input required maxLength={100} value={taskName} onChange={event => setTaskName(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <label className="block text-sm font-medium">截止日期（可选）<input type="date" value={taskDueDate} onChange={event => setTaskDueDate(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={working} onClick={() => setTaskOpen(false)}>取消</Button>
          <Button variant="primary" type="submit" disabled={working}>{working ? '创建中…' : '创建并关联'}</Button></div>
      </form> : null}

      {countdownOpen && modelKey === 'activity' ? <form className="space-y-3 rounded-2xl border border-stone-200 p-4" onSubmit={event => void addCountdown(event)}>
        <h3 className="font-semibold">新建关联倒计时</h3>
        <p className="text-xs text-stone-500">新建的倒计时会同时显示在「日子」中。</p>
        <label className="block text-sm font-medium">倒计时名称<input required maxLength={100} value={countdownName} onChange={event => setCountdownName(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <label className="block text-sm font-medium">目标日期<input type="date" required value={countdownDate} onChange={event => setCountdownDate(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={working} onClick={() => setCountdownOpen(false)}>取消</Button>
          <Button variant="primary" type="submit" disabled={working}>{working ? '创建中…' : '创建倒计时'}</Button></div>
      </form> : null}
    </div>
  </div>;
}
