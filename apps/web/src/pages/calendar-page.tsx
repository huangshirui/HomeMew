import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ApiError, apiRequest } from '../lib/api-client';
import { queryModelRecords } from '../lib/canonical-query';

type TemporalRange =
  | { kind: 'date'; start: string; endExclusive: string }
  | { kind: 'instant'; start: string; endExclusive: string };

type EventRecord = {
  id: string;
  spaceId: string;
  modelKey: 'event';
  modelVersion: number;
  summary: string;
  description: string | null;
  location: string | null;
  when: TemporalRange;
  attendeePersonIds: string[];
  status: 'active' | 'cancelled';
  version: number;
  createdAt: string;
  updatedAt: string;
};

type EventDraft = {
  summary: string;
  description: string;
  location: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  attendeePersonIds: string[];
};

type CalendarRange = { startDate: string; endDateExclusive: string };

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const inputClass = 'h-10 w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const textareaClass = 'min-h-24 w-full resize-y rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

function dateFromKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function addMonths(value: string, amount: number) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function monthRange(month: string): CalendarRange {
  const startDate = `${month}-01`;
  return { startDate, endDateExclusive: `${addMonths(month, 1)}-01` };
}

function monthGrid(month: string) {
  const { startDate } = monthRange(month);
  const first = dateFromKey(startDate);
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const gridStart = addDays(startDate, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function localDateParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

function currentDateInZone(timeZone: string) {
  return localDateParts(new Date(), timeZone).date;
}

function localDateTimeToIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('日期或时间格式不正确');
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = desired;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localDateParts(new Date(candidate), timeZone);
    const [actualYear, actualMonth, actualDay] = parts.date.split('-').map(Number);
    const [actualHour, actualMinute] = parts.time.split(':').map(Number);
    const actual = Date.UTC(actualYear, actualMonth - 1, actualDay, actualHour, actualMinute, 0, 0);
    candidate += desired - actual;
  }

  const confirmed = localDateParts(new Date(candidate), timeZone);
  if (confirmed.date !== date || confirmed.time !== time) {
    throw new Error(`“${date} ${time}”在 ${timeZone} 中不是有效的本地时间`);
  }
  return new Date(candidate).toISOString();
}

function displayMonth(month: string) {
  const [year, rawMonth] = month.split('-').map(Number);
  return `${year}年${rawMonth}月`;
}

function defaultDraft(timeZone: string, date?: string): EventDraft {
  const startDate = date ?? currentDateInZone(timeZone);
  return {
    summary: '',
    description: '',
    location: '',
    isAllDay: false,
    startDate,
    endDate: startDate,
    startTime: '09:00',
    endTime: '10:00',
    timezone: timeZone,
    attendeePersonIds: [],
  };
}

function draftFromEvent(event: EventRecord, viewingTimezone: string): EventDraft {
  if (event.when.kind === 'date') {
    return {
      summary: event.summary,
      description: event.description ?? '',
      location: event.location ?? '',
      isAllDay: true,
      startDate: event.when.start,
      endDate: addDays(event.when.endExclusive, -1),
      startTime: '09:00',
      endTime: '10:00',
      timezone: viewingTimezone,
      attendeePersonIds: event.attendeePersonIds ?? [],
    };
  }
  const start = localDateParts(new Date(event.when.start), viewingTimezone);
  const end = localDateParts(new Date(event.when.endExclusive), viewingTimezone);
  return {
    summary: event.summary,
    description: event.description ?? '',
    location: event.location ?? '',
    isAllDay: false,
    startDate: start.date,
    endDate: end.date,
    startTime: start.time,
    endTime: end.time,
    timezone: viewingTimezone,
    attendeePersonIds: event.attendeePersonIds ?? [],
  };
}

function eventPayload(draft: EventDraft) {
  if (!draft.summary.trim()) throw new Error('请输入日程名称');
  if (!draft.startDate || !draft.endDate) throw new Error('请选择日期');
  const common = {
    summary: draft.summary.trim(),
    description: draft.description.trim() || null,
    location: draft.location.trim() || null,
    attendeePersonIds: draft.attendeePersonIds,
  };
  if (draft.isAllDay) {
    if (draft.endDate < draft.startDate) throw new Error('结束日期不能早于开始日期');
    return {
      ...common,
      when: {
        kind: 'date' as const,
        start: draft.startDate,
        endExclusive: addDays(draft.endDate, 1),
      },
    };
  }
  if (!draft.startTime || !draft.endTime) throw new Error('请选择开始和结束时间');
  const start = localDateTimeToIso(draft.startDate, draft.startTime, draft.timezone);
  const endExclusive = localDateTimeToIso(draft.endDate, draft.endTime, draft.timezone);
  if (endExclusive <= start) throw new Error('结束时间必须晚于开始时间');
  return {
    ...common,
    when: { kind: 'instant' as const, start, endExclusive },
  };
}

function eventSpan(event: EventRecord, timeZone: string) {
  if (event.when.kind === 'date') {
    return { start: event.when.start, endInclusive: addDays(event.when.endExclusive, -1) };
  }
  return {
    start: localDateParts(new Date(event.when.start), timeZone).date,
    endInclusive: localDateParts(new Date(Date.parse(event.when.endExclusive) - 1), timeZone).date,
  };
}

function timeLabel(event: EventRecord, timeZone: string) {
  if (event.when.kind === 'date') return '全天';
  return localDateParts(new Date(event.when.start), timeZone).time;
}

function messageOf(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return `${cause.message}${cause.requestId ? ` · ${cause.requestId}` : ''}`;
  return cause instanceof Error ? cause.message : fallback;
}

export function CalendarPage() {
  const { currentFamily, members, loading: householdLoading } = useHousehold();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const canWrite = currentFamily ? currentFamily.role !== 'viewer' : false;

  const gridDays = useMemo(() => monthGrid(month), [month]);
  const gridStart = gridDays[0];
  const gridEndExclusive = addDays(gridDays[gridDays.length - 1], 1);

  const loadEvents = useCallback(async () => {
    if (!currentFamily) {
      setEvents([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const collected: EventRecord[] = [];
      let cursor: string | null = null;
      do {
        const filters = [
          {
            field: 'when',
            op: 'overlaps' as const,
            value: {
              kind: 'local_date_window',
              startDate: gridStart,
              endDateExclusive: gridEndExclusive,
              timezone: currentFamily.timezone,
            },
          },
          { field: 'status', op: 'eq' as const, value: 'active' },
        ];
        const resultPage: { items: EventRecord[]; nextCursor: string | null } = await queryModelRecords<EventRecord>(currentFamily.id, 'event', {
          filter: { and: filters },
          sort: [{ field: 'when', direction: 'asc' }],
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
          context: { viewingTimezone: currentFamily.timezone },
        });
        collected.push(...resultPage.items);
        cursor = resultPage.nextCursor;
      } while (cursor);
      setEvents(collected);
    } catch (cause) {
      setEvents([]);
      setError(messageOf(cause, '无法加载家庭日程'));
    } finally {
      setLoading(false);
    }
  }, [currentFamily, gridEndExclusive, gridStart]);

  useEffect(() => {
    void refreshToken;
    void loadEvents();
  }, [loadEvents, refreshToken]);

  useEffect(() => {
    if (!currentFamily) return;
    setMonth(currentDateInZone(currentFamily.timezone).slice(0, 7));
    setEditing(null);
    setDraft(null);
  }, [currentFamily?.id, currentFamily?.timezone]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRecord[]>();
    if (!currentFamily) return map;
    for (const event of events) {
      const span = eventSpan(event, currentFamily.timezone);
      let day = span.start < gridStart ? gridStart : span.start;
      const end = span.endInclusive >= gridEndExclusive ? addDays(gridEndExclusive, -1) : span.endInclusive;
      while (day <= end) {
        const list = map.get(day) ?? [];
        list.push(event);
        map.set(day, list);
        day = addDays(day, 1);
      }
    }
    return map;
  }, [currentFamily, events, gridEndExclusive, gridStart]);

  function openCreate(date?: string) {
    if (!currentFamily) return;
    setEditing(null);
    setDraft(defaultDraft(currentFamily.timezone, date));
    setError(null);
  }

  function openEdit(event: EventRecord) {
    if (!currentFamily) return;
    setEditing(event);
    setDraft(draftFromEvent(event, currentFamily.timezone));
    setError(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditing(null);
    setDraft(null);
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    if (!currentFamily || !draft || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      const payload = eventPayload(draft);
      if (editing) {
        await apiRequest<EventRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/event/records/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, version: editing.version }),
        });
      } else {
        await apiRequest<EventRecord>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/event/records`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '保存日程失败'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent() {
    if (!currentFamily || !editing || !canWrite) return;
    if (!window.confirm(`删除“${editing.summary}”？`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/models/event/records/${encodeURIComponent(editing.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: editing.version }),
      });
      setEditing(null);
      setDraft(null);
      setRefreshToken((value) => value + 1);
    } catch (cause) {
      setError(messageOf(cause, '删除日程失败'));
    } finally {
      setSaving(false);
    }
  }

  const monthToday = currentFamily ? currentDateInZone(currentFamily.timezone).slice(0, 7) : new Date().toISOString().slice(0, 7);

  if (householdLoading) {
    return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">正在加载家庭日历…</Card>;
  }

  if (!currentFamily) {
    return (
      <div className="space-y-6">
        <CalendarHeader onCreate={() => undefined} canWrite={false} />
        <Card className="grid min-h-72 place-items-center p-8 text-center text-sm text-stone-500">请先创建或加入一个家庭。</Card>
      </div>
    );
  }

  const todayInFamily = currentDateInZone(currentFamily.timezone);
  const activeDay = selectedDay?.startsWith(month)
    ? selectedDay
    : todayInFamily.startsWith(month) ? todayInFamily : `${month}-01`;
  const activeEvents = eventsByDay.get(activeDay) ?? [];

  return (
    <div className="space-y-6">
      <CalendarHeader onCreate={() => openCreate()} canWrite={canWrite} />

      <div className="flex flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200/80 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-stone-900">{displayMonth(month)}</p>
          <p className="mt-1 text-xs text-stone-500">{currentFamily.timezone}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="上个月" onClick={() => setMonth((value) => addMonths(value, -1))}><ChevronLeft className="size-4" /></Button>
          <Button variant="secondary" onClick={() => setMonth(monthToday)}>今天</Button>
          <Button variant="secondary" size="icon" aria-label="下个月" onClick={() => setMonth((value) => addMonths(value, 1))}><ChevronRight className="size-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="刷新" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>

      {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div> : null}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-stone-100 bg-stone-50/70">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-2 text-center text-xs font-medium text-stone-500 sm:px-2 sm:py-3">
              <span className="sm:hidden">{day}</span><span className="hidden sm:inline">周{day}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((day) => {
            const dayEvents = eventsByDay.get(day) ?? [];
            const inMonth = day.startsWith(month);
            const isToday = day === todayInFamily;
            const isSelected = day === activeDay;
            return (
              <div key={day} className={`min-w-0 border-b border-r border-stone-100 p-0.5 sm:min-h-36 sm:p-2 ${inMonth ? 'bg-white' : 'bg-stone-50/60'}`}>
                <button
                  type="button"
                  className={`flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold sm:hidden ${isSelected ? 'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-200' : inMonth ? 'text-stone-700' : 'text-stone-400'}`}
                  onClick={() => setSelectedDay(day)}
                  aria-pressed={isSelected}
                  aria-label={`${day}，${dayEvents.length} 项日程`}
                >
                  <span className={`grid size-6 place-items-center rounded-full ${isToday ? 'bg-emerald-600 text-white' : ''}`}>{Number(day.slice(-2))}</span>
                  {dayEvents.length ? <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" /> : <span aria-hidden="true" className="size-1.5" />}
                </button>
                <button
                  type="button"
                  className={`hidden size-7 place-items-center rounded-full text-xs font-medium sm:grid ${isToday ? 'bg-emerald-600 text-white' : inMonth ? 'text-stone-700 hover:bg-stone-100' : 'text-stone-400'}`}
                  onClick={() => canWrite && openCreate(day)}
                  aria-label={`${day} 新建日程`}
                  disabled={!canWrite}
                >
                  {Number(day.slice(-2))}
                </button>
                <div className="mt-1.5 hidden space-y-1 sm:block">
                  {dayEvents.slice(0, 4).map((event) => (
                    <button
                      key={`${day}-${event.id}`}
                      type="button"
                      onClick={() => openEdit(event)}
                      className="block w-full truncate rounded-lg bg-emerald-50 px-1.5 py-1 text-left text-[11px] leading-4 text-emerald-900 transition hover:bg-emerald-100 sm:px-2 sm:text-xs"
                      title={`${timeLabel(event, currentFamily.timezone)} ${event.summary}`}
                    >
                      <span className="mr-1 font-medium text-emerald-700">{timeLabel(event, currentFamily.timezone)}</span>{event.summary}
                    </button>
                  ))}
                  {dayEvents.length > 4 ? <p className="px-1 text-[10px] text-stone-400">还有 {dayEvents.length - 4} 项</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <section className="space-y-3 sm:hidden" aria-label={`${activeDay}的日程`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-stone-900">{Number(activeDay.slice(5, 7))}月{Number(activeDay.slice(8))}日 · 日程</h2>
          {canWrite ? <Button variant="secondary" className="shrink-0" onClick={() => openCreate(activeDay)}><Plus className="size-4" /> 新建</Button> : null}
        </div>
        {activeEvents.length ? (
          <Card className="divide-y divide-stone-100 overflow-hidden">
            {activeEvents.map((event) => (
              <button key={event.id} type="button" onClick={() => openEdit(event)} className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-stone-50">
                <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-stone-500">{timeLabel(event, currentFamily.timezone)}</span>
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-stone-900">{event.summary}</span>
                  {event.location ? <span className="mt-1 block break-words text-xs text-stone-500">{event.location}</span> : null}
                </span>
              </button>
            ))}
          </Card>
        ) : <Card className="p-6 text-center text-sm text-stone-500">这一天还没有日程。</Card>}
      </section>

      {draft ? (
        <EventEditor
          draft={draft}
          editing={editing}
          members={members.filter((member) => member.personId)}
          canWrite={canWrite}
          saving={saving}
          onChange={setDraft}
          onClose={closeEditor}
          onSave={saveEvent}
          onDelete={editing ? deleteEvent : undefined}
        />
      ) : null}
    </div>
  );
}

function CalendarHeader({ onCreate, canWrite }: { onCreate: () => void; canWrite: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:items-end">
      <div>
        <div className="flex items-center gap-3 sm:block">
          <span className="grid size-10 shrink-0 sm:size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><CalendarDays className="size-5" /></span>
          <h1 className="text-2xl sm:mt-4 sm:text-3xl font-semibold tracking-tight text-stone-950">家庭日程</h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">直接使用 LifeSpace Event / TemporalRange 数据，家庭切换后日历同步切换。</p>
      </div>
      <Button variant="primary" disabled={!canWrite} onClick={onCreate}><Plus className="size-4" /> 新建日程</Button>
    </div>
  );
}

function EventEditor({
  draft,
  editing,
  members,
  canWrite,
  saving,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: EventDraft;
  editing: EventRecord | null;
  members: ReturnType<typeof useHousehold>['members'];
  canWrite: boolean;
  saving: boolean;
  onChange: (draft: EventDraft) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  onDelete?: () => void;
}) {
  const readOnly = !canWrite;
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => onChange({ ...draft, [key]: value });

  function togglePerson(personId: string) {
    const next = draft.attendeePersonIds.includes(personId)
      ? draft.attendeePersonIds.filter((id) => id !== personId)
      : [...draft.attendeePersonIds, personId];
    set('attendeePersonIds', next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={editing ? '编辑日程' : '新建日程'}>
      <form onSubmit={onSave} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-stone-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-stone-950">{editing ? (readOnly ? '日程详情' : '编辑日程') : '新建日程'}</p>
            <p className="mt-1 text-xs text-stone-500">按 {draft.timezone} 查看和编辑时间</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}><X className="size-4" /></Button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-stone-700">
            日程名称
            <input className={inputClass} disabled={readOnly} maxLength={100} value={draft.summary} onChange={(event) => set('summary', event.target.value)} autoFocus={!editing} />
          </label>

          <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-stone-200">
            <input id="calendar-all-day" type="checkbox" className="size-4 accent-emerald-600" disabled={readOnly} checked={draft.isAllDay} onChange={(event) => set('isAllDay', event.target.checked)} />
            <label htmlFor="calendar-all-day" className="text-sm font-medium text-stone-700">全天日程</label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-stone-700">开始日期<input type="date" className={inputClass} disabled={readOnly} value={draft.startDate} onChange={(event) => set('startDate', event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium text-stone-700">结束日期<input type="date" className={inputClass} disabled={readOnly} value={draft.endDate} onChange={(event) => set('endDate', event.target.value)} /></label>
          </div>

          {!draft.isAllDay ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium text-stone-700">开始时间<input type="time" className={inputClass} disabled={readOnly} value={draft.startTime} onChange={(event) => set('startTime', event.target.value)} /></label>
              <label className="grid gap-1.5 text-sm font-medium text-stone-700">结束时间<input type="time" className={inputClass} disabled={readOnly} value={draft.endTime} onChange={(event) => set('endTime', event.target.value)} /></label>
            </div>
          ) : null}

          <label className="grid gap-1.5 text-sm font-medium text-stone-700">
            <span className="flex items-center gap-1.5"><MapPin className="size-3.5" /> 地点</span>
            <input className={inputClass} disabled={readOnly} maxLength={500} value={draft.location} onChange={(event) => set('location', event.target.value)} />
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-stone-700">
            说明
            <textarea className={textareaClass} disabled={readOnly} maxLength={5000} value={draft.description} onChange={(event) => set('description', event.target.value)} />
          </label>

          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-stone-700"><Users className="size-3.5" /> 参与成员</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {members.length ? members.map((member) => {
                const personId = member.personId!;
                const selected = draft.attendeePersonIds.includes(personId);
                return (
                  <button
                    key={personId}
                    type="button"
                    disabled={readOnly}
                    onClick={() => togglePerson(personId)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${selected ? 'bg-emerald-100 text-emerald-800 ring-emerald-200' : 'bg-white text-stone-600 ring-stone-200 hover:bg-stone-50'}`}
                  >
                    {member.displayName || member.userId}
                  </button>
                );
              }) : <span className="text-xs text-stone-400">暂无可选择成员</span>}
            </div>
          </div>

          {editing ? (
            <div className="grid gap-2 rounded-2xl bg-white p-4 text-xs text-stone-500 ring-1 ring-stone-200 sm:grid-cols-2">
              <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" /> 版本 {editing.version}</span>
              <span className="sm:text-right">最后更新 {new Date(editing.updatedAt).toLocaleString('zh-CN')}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
          <div>{onDelete && canWrite ? <Button variant="ghost" disabled={saving} onClick={onDelete}><Trash2 className="size-4" /> 删除</Button> : null}</div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={saving} onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
            {!readOnly ? <Button type="submit" variant="primary" disabled={saving}>{saving ? '保存中…' : '保存'}</Button> : null}
          </div>
        </div>
      </form>
    </div>
  );
}
