import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CalendarClock, CalendarDays, CheckSquare, Link2, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useHousehold } from './household-provider';
import { eventPayload, defaultDraft, EventEditor, type EventDraft } from '../pages/calendar-page';
import { taskPayload, TaskEditor, type TaskDraft } from '../pages/tasks-page';
import { emptyIconDraft } from './record-icon';
import { presentationToSave } from './record-icon';
import { useModalScrollLock } from '../lib/modal-scroll';
import { showScrollbarWhileScrolling } from '../components/ui/modal-behavior';
import { apiRequest } from '../lib/api-client';
import { householdErrorMessage } from '../lib/user-facing-error';
import { queryModelRecords } from '../lib/canonical-query';
import { RecordLifecycleMenu, type LifecycleAction, type LifecycleStatus } from './record-lifecycle-menu';

type ContainerModel = 'activity' | 'goal' | 'habit';
type EntityRef = { kind: 'record'; modelKey: string; recordId: string };
type RelatedRecord = {
  name?: string | null; summary?: string | null; title?: string | null; displayName?: string | null;
  dueDate?: string | null; anchorDate?: string | null; startDate?: string | null;
  endDate?: string | null; targetDate?: string | null; month?: number; day?: number;
  when?: { kind: 'date' | 'instant'; start: string; endExclusive: string };
};
type Relation = { id: string; source: EntityRef; target: EntityRef; sourceLabel?: string; targetLabel?: string;
  sourceRecord?: RelatedRecord; targetRecord?: RelatedRecord };

/** Hydration includes record data even if the model's referenceLabel resolves to rec_*. */
export function relatedRecordTitle(label: string | undefined, record: RelatedRecord | undefined, id: string): string {
  const values = [label, record?.name, record?.summary, record?.title, record?.displayName];
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized && normalized !== id && !/^rec_[A-Za-z0-9_-]+$/.test(normalized)) return normalized;
  }
  return '名称暂不可用';
}
type Page<T> = { items: T[]; nextCursor: string | null };
type Candidate = { id: string; name?: string; summary?: string; title?: string };
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
const modelName = (key: string) => models.find(model => model.key === key)?.title ?? '其他内容';
const statusText: Record<LifecycleStatus,string> = { active:'进行中', paused:'已暂停', achieved:'已达成', abandoned:'已放弃', ended:'已结束' };
const core = (spaceId: string) => `/api/lifespace/core/v1/spaces/${encodeURIComponent(spaceId)}`;
const ref = (modelKey: string, recordId: string): EntityRef => ({ kind: 'record', modelKey, recordId });
const explain = (reason: unknown) => householdErrorMessage(reason, '操作失败，请稍后再试。');

function daysUntil(anchorDate: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) => Number(parts.find(entry => entry.type === name)?.value);
  const today = Date.UTC(part('year'), part('month') - 1, part('day'));
  const anchor = Date.parse(`${anchorDate}T00:00:00Z`);
  return Math.round((anchor - today) / 86_400_000);
}


type TimelineDate = { date: string; sortKey: string };
type OverviewOrder = 'asc' | 'desc';

function dateInFamilyZone(instant: Date, timezone: string): TimelineDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '00';
  const date = value('year') + '-' + value('month') + '-' + value('day');
  return { date, sortKey: date + 'T' + value('hour') + ':' + value('minute') + ':' + value('second') };
}

/** Use a linked record's business date, never the relation's creation timestamp. */
function relatedTimelineDate(modelKey: string, record: RelatedRecord | undefined, timezone: string, today: string): TimelineDate | null {
  if (!record) return null;
  if (modelKey === 'anniversary' && record.month && record.day) {
    // Annual recurrence: use the next valid occurrence, including leap days.
    const month = record.month, day = record.day;
    const thisYear = Number(today.slice(0, 4));
    for (let year = thisYear; year < thisYear + 9; year += 1) {
      const valid = new Date(Date.UTC(year, month - 1, day));
      if (valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) continue;
      const date = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      if (date >= today) return { date, sortKey: date + 'T00:00:00' };
    }
    return null;
  }
  const raw = modelKey === 'event' ? record.when?.start
    : modelKey === 'task' ? record.dueDate
      : modelKey === 'day_record' ? record.anchorDate
        : modelKey === 'activity' ? (record.startDate || record.endDate)
          : modelKey === 'goal' ? (record.targetDate || record.startDate)
            : null;
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, sortKey: raw + 'T00:00:00' };
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? null : dateInFamilyZone(instant, timezone);
}

function CollapsibleDescription({ description }: { description: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  useEffect(() => {
    setExpanded(false);
    const element = paragraph.current;
    if (!element) return;
    const measure = () => setCanExpand(element.scrollHeight > 61);
    measure();
    const observer = new ResizeObserver(measure);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [description]);
  return <div className="space-y-1.5">
    <p className="text-xs font-medium text-stone-500">说明</p>
    <p id={id} ref={paragraph} className={'whitespace-pre-wrap break-words text-sm leading-5 text-stone-600 ' +
      (expanded ? 'max-h-64 overflow-y-auto overscroll-contain pr-2' : 'max-h-[60px] overflow-hidden')}>
      {description}
    </p>
    {canExpand ? <button type="button" aria-controls={id} aria-expanded={expanded}
      className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
      onClick={() => setExpanded(value => !value)}>{expanded ? '收起说明' : '展开全文'}</button> : null}
  </div>;
}

export function ContainerRelations({ spaceId, modelKey, record, timezone, writable, participants, onEdit, onClose, mode = 'page', status, lifecycleBusy, onLifecycleAction }: {
  spaceId: string;
  modelKey: ContainerModel;
  record: { id: string; name: string; description?: string | null; startDate?: string | null; endDate?: string | null; targetDate?: string | null };
  timezone: string;
  writable: boolean;
  participants?: string;
  onEdit?: () => void;
  onClose?: () => void;
  mode?: 'page' | 'modal';
  status?: LifecycleStatus;
  lifecycleBusy?: boolean;
  onLifecycleAction?: (action: LifecycleAction) => void;
}) {
  const { members } = useHousehold();
  const [tab, setTab] = useState<'overview' | 'events' | 'tasks' | 'more'>('overview');
  const [overviewOrder, setOverviewOrder] = useState<OverviewOrder>('asc');
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
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
  useModalScrollLock(Boolean(eventDraft));

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

  function startEvent() {
    const draft = defaultDraft(timezone, record.startDate || undefined);
    setEventDraft(draft);
    setTaskOpen(false); setCountdownOpen(false); setPickerOpen(false);
  }

  async function addEvent(event: FormEvent) {
    event.preventDefault();
    if (!writable || !eventDraft || working) return;
    setWorking(true); setError('');
    try {
      const payload = {
        ...eventPayload(eventDraft),
        ...await presentationToSave(spaceId, 'event', eventDraft.icon),
      };
      await apiRequest(`${core(spaceId)}/models/batch`, {
        method: 'POST', body: JSON.stringify({
          atomicConsistency: true,
          operations: [
            { operation: 'create', modelKey: 'event', clientRef: 'new_event', data: payload },
            { operation: 'relation_create', predicate: 'relates_to',
              source: ref(modelKey, record.id),
              target: { kind: 'record', modelKey: 'event', clientRef: 'new_event' } },
          ],
        }),
      });
      setEventDraft(null);
      await refreshRelations();
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  }

  async function addFullTask(event: FormEvent) {
    event.preventDefault();
    if (!writable || !taskDraft || working) return;
    setWorking(true); setError('');
    try {
      const payload = { ...taskPayload(taskDraft), ...await presentationToSave(spaceId, 'task', taskDraft.icon) };
      await apiRequest(`${core(spaceId)}/models/batch`, {
        method: 'POST', body: JSON.stringify({
          atomicConsistency: true,
          operations: [
            { operation: 'create', modelKey: 'task', clientRef: 'task', data: payload },
            { operation: 'relation_create', predicate: 'relates_to', source: ref(modelKey, record.id),
              target: { kind: 'record', modelKey: 'task', clientRef: 'task' } },
          ],
        }),
      });
      setTaskDraft(null);
      await refreshRelations();
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  }

  function startTask() {
    if (mode === 'page') {
      setTaskDraft({ name: '', description: '', dueDate: '',
        assigneePersonIds: [], icon: emptyIconDraft() });
      setTaskOpen(false);
    } else {
      setTaskName(''); setTaskDueDate(''); setTaskOpen(true);
    }
    setPickerOpen(false); setCountdownOpen(false);
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

  function listing(edges: Relation[], outgoingDirection: boolean, timeline = false) {
    const today = dateInFamilyZone(new Date(), timezone).date;
    const entries = edges.map(edge => ({
      edge,
      dateInfo: timeline ? relatedTimelineDate(edge.target.modelKey, edge.targetRecord, timezone, today) : null,
    }));
    if (timeline) entries.sort((left, right) => {
      if (!left.dateInfo) return right.dateInfo ? 1 : left.edge.id.localeCompare(right.edge.id);
      if (!right.dateInfo) return -1;
      const result = left.dateInfo.sortKey.localeCompare(right.dateInfo.sortKey);
      return (overviewOrder === 'asc' ? result : -result) || left.edge.id.localeCompare(right.edge.id);
    });
    const markerAt = timeline ? entries.findIndex(item =>
      !item.dateInfo || (overviewOrder === 'asc' ? item.dateInfo.date >= today : item.dateInfo.date <= today)) : -1;
    const todayMarker = <div role="separator" aria-label={'今天 ' + today} className="flex items-center gap-3 py-2">
      <span className="h-px min-w-0 flex-1 bg-emerald-300" />
      <span className="shrink-0 text-xs font-semibold text-emerald-700">今天 · {today}</span>
      <span className="h-px min-w-0 flex-1 bg-emerald-300" />
    </div>;
    return <div className="space-y-2">
      {entries.map(({ edge, dateInfo }, index) => {
        const target = outgoingDirection ? edge.target : edge.source;
        const title = relatedRecordTitle(outgoingDirection ? edge.targetLabel : edge.sourceLabel,
          outgoingDirection ? edge.targetRecord : edge.sourceRecord, target.recordId);
        const model = models.find(item => item.key === target.modelKey);
        const destination = model && ['activity','goal','habit'].includes(target.modelKey)
          ? model.route + '/' + encodeURIComponent(target.recordId)
          : model?.route;
        return <Fragment key={edge.id}>
          {timeline && index === markerAt ? todayMarker : null}
          <div className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2">
            <Link2 className="size-4 shrink-0 text-stone-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-stone-800">{title}</div>
              <div className="text-xs text-stone-500">{modelName(target.modelKey)}
                {timeline ? (dateInfo ? ' · ' + dateInfo.date : ' · 未排期') : ''}
                {!outgoingDirection ? ' · 此记录关联了当前容器' : ''}
              </div>
            </div>
            {destination ? <a href={destination}
              aria-label={['activity','goal','habit'].includes(target.modelKey) ? '查看' + title + '详情' : '前往' + model!.title + '列表'}
              title={['activity','goal','habit'].includes(target.modelKey) ? '打开详情' : '查看所属列表'}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"><ArrowUpRight className="size-4" /></a> : null}
            {outgoingDirection && writable ? <button type="button" aria-label={'取消关联' + title}
              disabled={working} onClick={() => void unlink(edge)} className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600">
              <Trash2 className="size-4" /></button> : null}
          </div>
        </Fragment>;
      })}
      {timeline && markerAt === -1 ? todayMarker : null}
    </div>;
  }

  const filteredEdges = mode === 'modal' || tab === 'overview' ? outgoing
    : tab === 'events' ? outgoing.filter(edge => edge.target.modelKey === 'event')
      : tab === 'tasks' ? outgoing.filter(edge => edge.target.modelKey === 'task')
        : outgoing.filter(edge => !['event','task'].includes(edge.target.modelKey));
  return <>
  <div className={mode === 'modal'
      ? 'fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 sm:items-center sm:p-6'
      : 'w-full'} role={mode === 'modal' ? 'presentation' : undefined}
    onMouseDown={event => { if (mode === 'modal' && event.target === event.currentTarget && !working) onClose?.(); }}>
    <div role={mode === 'modal' ? 'dialog' : undefined} aria-modal={mode === 'modal' ? true : undefined}
      aria-label={mode === 'modal' ? `${record.name}关联内容` : undefined}
      onScroll={mode === 'modal' ? showScrollbarWhileScrolling : undefined}
      className={mode === 'modal'
        ? 'max-h-[92dvh] w-full max-w-2xl space-y-5 overflow-y-auto overscroll-contain scrollbar-overlay rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl sm:p-6'
        : 'w-full space-y-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 sm:p-6'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-xl font-semibold text-stone-900">{record.name}</h2>
            {status ? <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600" aria-label={`当前状态：${statusText[status]}`}>{statusText[status]}</span> : null}
          </div>
          {modelKey === 'activity' ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-500">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" />
              {record.startDate || record.endDate ? `${record.startDate || '开始日期待定'} → ${record.endDate || '结束日期待定'}` : '活动日期待定'}</span>
            {participants ? <span className="inline-flex items-center gap-1.5"><Users className="size-4" /> {participants}</span> : null}
          </div> : null}
        </div>
        {writable && onEdit && modelKey === 'activity' ? <Button variant="secondary" onClick={onEdit}><Pencil className="size-4" /> 编辑活动</Button> : null}
        {writable && status && onLifecycleAction && modelKey !== 'activity' ?
          <RecordLifecycleMenu model={modelKey} status={status} recordName={record.name}
            disabled={lifecycleBusy} onAction={onLifecycleAction} onEdit={onEdit} /> : null}
        {mode === 'modal' ? <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose} disabled={working}><X className="size-4" /></Button> : null}
      </div>
      {record.description ? (modelKey === 'activity'
        ? <CollapsibleDescription key={record.id} description={record.description} />
        : <p className="whitespace-pre-wrap text-sm text-stone-600">{record.description}</p>) : null}
      {mode === 'page' && writable ? <div className="flex flex-wrap gap-2 rounded-2xl bg-emerald-50/60 p-3">
        {modelKey === 'activity' ? <Button variant="secondary" onClick={startEvent}><CalendarDays className="size-4" /> 新建日程</Button> : null}
        <Button variant="secondary" onClick={startTask}><CheckSquare className="size-4" /> 新建待办</Button>
        {modelKey === 'activity' ? <Button variant="secondary" onClick={startCountdown}><CalendarClock className="size-4" /> 添加倒计时</Button> : null}
        <Button variant="secondary" onClick={openPicker}><Link2 className="size-4" /> 关联已有内容</Button>
        {modelKey === 'activity' && onEdit ? <Button variant="ghost" onClick={onEdit}><Users className="size-4" /> 管理参与人</Button> : null}
      </div> : null}
      {mode === 'page' ? <div role="tablist" aria-label="详情内容" className="flex flex-wrap gap-2 border-b border-stone-100 pb-3">
        {(modelKey === 'activity' ? [['overview','概览'],['events','日程'],['tasks','待办'],['more','更多内容']]
          : modelKey === 'goal' ? [['overview','概览'],['tasks','行动计划'],['more','相关内容']]
          : [['overview','概览'],['more','相关内容']] as string[][]).map(([value,label]) =>
          <button key={value} role="tab" type="button" aria-selected={tab === value}
            onClick={() => setTab(value as typeof tab)}
            className={`rounded-lg px-4 py-2 text-sm ${tab === value ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-stone-500 hover:bg-stone-50'}`}>{label}</button>)}
      </div> : null}
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {modelKey === 'activity' && (mode === 'modal' || tab === 'overview' || tab === 'more') ? <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">重要日子</h3>
          {writable ? <Button variant="secondary" onClick={startCountdown}><CalendarClock className="size-4" /> 添加倒计时</Button> : null}
        </div>
        {Object.entries(countdowns).filter(([, day]) => day.kind === 'countdown')
          .sort((left, right) => overviewOrder === 'asc'
            ? left[1].anchorDate.localeCompare(right[1].anchorDate)
            : right[1].anchorDate.localeCompare(left[1].anchorDate)).map(([id, day]) => {
          const days = daysUntil(day.anchorDate, timezone);
          return <div key={id} className="flex items-center justify-between rounded-2xl bg-emerald-50 p-4">
            <div className="min-w-0"><p className="font-medium text-emerald-900">{day.name}</p>
              <p className="text-xs text-emerald-700">目标日期 {day.anchorDate}</p></div>
            <div className="text-right"><p className="text-2xl font-bold tabular-nums text-emerald-800">{Math.abs(days)}</p>
              <p className="text-xs text-emerald-700">{days > 0 ? '天后' : days === 0 ? '今天' : '天前'}</p></div>
          </div>;
        })}
        {!outgoing.some(edge => countdowns[edge.target.recordId]?.kind === 'countdown') && !loading
          ? <p className="text-xs text-stone-500">例如旅行出发日、比赛开赛日。添加倒计时后，也会显示在「日子」中。</p> : null}
      </section> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{modelKey === 'activity' ? (tab === 'events' ? '活动日程' : tab === 'tasks' ? '活动待办' : '活动安排') : modelKey === 'goal' ? (tab === 'tasks' ? '行动计划' : '相关内容') : '相关内容'}</h3>
          {mode === 'page' && modelKey === 'activity' && tab === 'overview' ? <label className="flex items-center gap-2 text-xs text-stone-500">
            时间顺序
            <select aria-label="概览时间顺序" value={overviewOrder} onChange={event => setOverviewOrder(event.target.value as OverviewOrder)}
              className="h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-700">
              <option value="asc">正序</option><option value="desc">倒序</option>
            </select>
          </label> : null}
          {writable && mode === 'modal' ? <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={startTask}><Plus className="size-4" /> 添加待办</Button>
            <Button variant="secondary" onClick={openPicker}><Link2 className="size-4" /> 添加已有内容</Button>
          </div> : null}</div>
        {loading && !outgoing.length ? <p className="text-sm text-stone-500">正在加载…</p> : null}
        {!filteredEdges.length && !loading ? <p className="text-sm text-stone-500">{tab === 'events' ? '还没有关联日程，可以使用上面的“新建日程”。' : tab === 'tasks' ? '还没有关联待办，可以使用上面的“新建待办”。' : '还没有相关安排，从上面的快捷按钮开始添加吧。'}</p> : listing(filteredEdges, true, mode === 'page' && modelKey === 'activity' && tab === 'overview')}
        {outCursor ? <Button variant="ghost" disabled={loading} onClick={() => void moreRelations('source')}>加载更多关联</Button> : null}
      </section>

      {(mode === 'modal' || tab === 'more') && (incoming.length || inCursor) ? <section className="space-y-3 border-t border-stone-100 pt-4">
        <h3 className="text-sm font-semibold">其他相关内容</h3>
        {listing(incoming, false)}
        {inCursor ? <Button variant="ghost" disabled={loading} onClick={() => void moreRelations('target')}>加载更多</Button> : null}
      </section> : null}

      {pickerOpen ? <section className="space-y-3 rounded-2xl border border-stone-200 p-4">
        <h3 className="font-semibold">从已有内容中添加</h3>
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
          <span className="min-w-0 truncate text-sm">{item.name || item.summary || item.title || '名称暂不可用'}</span>
          <Button variant="secondary" disabled={working} onClick={() => void link(item)}>关联</Button>
        </div>)}
        {!candidates.length && !candidateLoading ? <p className="text-xs text-stone-500">输入关键词找到内容，加入这里只是建立关联，不会移动或复制原内容。</p> : null}
        {candidateCursor ? <Button variant="ghost" disabled={candidateLoading} onClick={() => void searchCandidates(candidateCursor)}>加载更多搜索结果</Button> : null}
        <Button variant="ghost" onClick={() => setPickerOpen(false)}>收起</Button>
      </section> : null}

      {taskOpen ? <form className="space-y-3 rounded-2xl border border-stone-200 p-4" onSubmit={event => void addTask(event)}>
        <h3 className="font-semibold">添加准备待办</h3>
        <p className="text-xs text-stone-500">例如订酒店、采购物品、准备行李；创建后也能在「待办」中查看。</p>
        <label className="block text-sm font-medium">待办名称<input required maxLength={100} value={taskName} onChange={event => setTaskName(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <label className="block text-sm font-medium">截止日期（可选）<input type="date" value={taskDueDate} onChange={event => setTaskDueDate(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={working} onClick={() => setTaskOpen(false)}>取消</Button>
          <Button variant="primary" type="submit" disabled={working}>{working ? '创建中…' : '创建并关联'}</Button></div>
      </form> : null}

      {countdownOpen && modelKey === 'activity' ? <form className="space-y-3 rounded-2xl border border-stone-200 p-4" onSubmit={event => void addCountdown(event)}>
        <h3 className="font-semibold">添加重要日子</h3>
        <p className="text-xs text-stone-500">例如距离出发还有几天；保存后也会出现在「日子」中。</p>
        <label className="block text-sm font-medium">倒计时名称<input required maxLength={100} value={countdownName} onChange={event => setCountdownName(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <label className="block text-sm font-medium">目标日期<input type="date" required value={countdownDate} onChange={event => setCountdownDate(event.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-stone-200 px-3" /></label>
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={working} onClick={() => setCountdownOpen(false)}>取消</Button>
          <Button variant="primary" type="submit" disabled={working}>{working ? '创建中…' : '创建倒计时'}</Button></div>
      </form> : null}
    </div>
  </div>
  {taskDraft ? <TaskEditor draft={taskDraft} spaceId={spaceId} editing={null}
    members={members.filter(member => member.personId)} canWrite={writable} saving={working}
    onChange={setTaskDraft} onClose={() => { if (!working) setTaskDraft(null); }}
    onSave={event => void addFullTask(event)} /> : null}
  {eventDraft ? <EventEditor draft={eventDraft} spaceId={spaceId} editing={null}
    members={members.filter(member => member.personId)} canWrite={writable} saving={working}
    onChange={setEventDraft} onClose={() => { if (!working) setEventDraft(null); }}
    onSave={event => void addEvent(event)} /> : null}
  </>;
}
