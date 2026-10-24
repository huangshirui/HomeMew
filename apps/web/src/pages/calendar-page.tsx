import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Gift, MapPin, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RecordTitleField } from '../components/record-title-field';
import { useHousehold } from '../components/household-provider';
import { RecordIconMark, emptyIconDraft, iconDraftFor, presentationToSave, type RecordIcon, type RecordIconDraft } from '../components/record-icon';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { showScrollbarWhileScrolling } from '../components/ui/modal-behavior';
import { WeekTimeGrid } from '../components/week-time-grid';
import { useModalScrollLock } from '../lib/modal-scroll';
import { Card } from '../components/ui/card';
import { apiRequest } from '../lib/api-client';
import { householdErrorMessage } from '../lib/user-facing-error';
import { queryModelRecords } from '../lib/canonical-query';
import { eventLocationDraftValue, eventLocationLabel, type EventLocation, type LocationValue } from '../lib/location-value';

type TemporalRange =
  | { kind: 'date'; start: string; endExclusive: string }
  | { kind: 'instant'; start: string; endExclusive: string };

type EventRecord = {
  id: string;
  spaceId: string;
  modelKey: 'event';
  presentation?: { icon: RecordIcon | null };
  modelVersion: number;
  summary: string;
  description: string | null;
  location: EventLocation;
  when: TemporalRange;
  attendeePersonIds: string[];
  status: 'active' | 'cancelled';
  version: number;
  createdAt: string;
  updatedAt: string;
};

type AnniversaryRecord = { id: string; name: string; month: number; day: number; year: number | null; };
function matchesAnniversary(date: string, record: AnniversaryRecord): boolean {
  // Leap-day anniversaries only occur in leap years. No silent date substitution.
  return Number(date.slice(5, 7)) === record.month && Number(date.slice(8)) === record.day;
}
function AnniversaryDayItems({ records }: { records: AnniversaryRecord[] }) {
  return records.length ? <div className="space-y-2">
    {records.map(record => <Link key={record.id} to="/anniversaries"
      className="flex items-center gap-3 rounded-xl bg-violet-50 px-4 py-3 text-left text-sm text-violet-900 hover:bg-violet-100">
      <Gift className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-semibold">{record.name}</span>
      <span className="text-xs">纪念日</span>
    </Link>)}
  </div> : null;
}

export type EventDraft = {
  icon: RecordIconDraft;
  summary: string;
  description: string;
  location: string;
  locationPoint?: LocationValue | null;
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

function startOfWeek(date: string) {
  return addDays(date, -((dateFromKey(date).getUTCDay() + 6) % 7));
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

export function defaultDraft(timeZone: string, date?: string): EventDraft {
  const startDate = date ?? currentDateInZone(timeZone);
  return {
    summary: '',
    icon: emptyIconDraft(),
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
      icon: iconDraftFor(event.presentation?.icon),
      description: event.description ?? '',
      location: eventLocationLabel(event.location),
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
    icon: iconDraftFor(event.presentation?.icon),
    description: event.description ?? '',
    location: eventLocationLabel(event.location),
    isAllDay: false,
    startDate: start.date,
    endDate: end.date,
    startTime: start.time,
    endTime: end.time,
    timezone: viewingTimezone,
    attendeePersonIds: event.attendeePersonIds ?? [],
  };
}

export function eventPayload(draft: EventDraft, previousLocation?: EventLocation) {
  if (!draft.summary.trim()) throw new Error('请输入日程名称');
  if (!draft.startDate || !draft.endDate) throw new Error('请选择日期');
  const common = {
    summary: draft.summary.trim(),
    description: draft.description.trim() || null,
    location: draft.locationPoint && draft.locationPoint.name === draft.location.trim()
      ? draft.locationPoint : eventLocationDraftValue(draft.location, previousLocation),
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
  return householdErrorMessage(cause, fallback);
}

export function CalendarPage() {
  const { currentFamily, members, loading: householdLoading } = useHousehold();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(dateKey(new Date())));
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [attendeeFilter, setAttendeeFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'date' | 'instant'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [nextSearchCursor, setNextSearchCursor] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [anniversaries, setAnniversaries] = useState<AnniversaryRecord[]>([]);
  const [anniversaryError, setAnniversaryError] = useState('');
  const anniversaryGeneration = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const canWrite = currentFamily ? currentFamily.role !== 'viewer' : false;
  useModalScrollLock(Boolean(draft || expandedDay));

  const gridDays = useMemo(
    () => view === 'month' ? monthGrid(month) : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [month, view, weekStart],
  );
  const gridStart = gridDays[0];
  const gridEndExclusive = addDays(gridDays[gridDays.length - 1], 1);
  const searchActive = Boolean(appliedSearch);

  const queryEvents = useCallback((cursor: string | null = null) => {
    if (!currentFamily) throw new Error('请先选择家庭');
    const filters = [
      { field: 'status', op: 'eq' as const, value: 'active' },
      ...(searchActive ? [] : [{
        field: 'when',
        op: 'overlaps' as const,
        value: {
          kind: 'local_date_window',
          startDate: gridStart,
          endDateExclusive: gridEndExclusive,
          timezone: currentFamily.timezone,
        },
      }]),
      ...(attendeeFilter ? [{ field: 'attendeePersonIds', op: 'contains' as const, value: attendeeFilter }] : []),
      ...(kindFilter !== 'all' ? [{ field: 'when', op: 'kindIs' as const, value: kindFilter }] : []),
    ];
    return queryModelRecords<EventRecord>(currentFamily.id, 'event', {
      ...(searchActive ? { search: { text: appliedSearch } } : {}),
      filter: { and: filters },
      sort: [{ field: 'when', direction: searchActive ? 'desc' : 'asc' }],
      page: { limit: searchActive ? 80 : 200, ...(cursor ? { cursor } : {}) },
      context: { viewingTimezone: currentFamily.timezone },
    });
  }, [currentFamily, gridEndExclusive, gridStart, searchActive, appliedSearch, attendeeFilter, kindFilter]);

  const loadEvents = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!currentFamily) {
      setEvents([]);
      setNextSearchCursor(null);
      return;
    }
    setLoading(true);
    setEvents([]);
    setError(null);
    setNextSearchCursor(null);
    setMoreLoading(false);
    try {
      const collected: EventRecord[] = [];
      let cursor: string | null = null;
      do {
        const page = await queryEvents(cursor);
        if (generation !== requestGeneration.current) return;
        collected.push(...page.items);
        cursor = page.nextCursor;
        if (searchActive) break;
      } while (cursor);
      if (generation === requestGeneration.current) {
        setEvents(collected);
        setNextSearchCursor(searchActive ? cursor : null);
      }
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setEvents([]);
        setError(messageOf(cause, '无法加载家庭日程'));
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [currentFamily, queryEvents, searchActive]);

  useEffect(() => {
    const generation = ++anniversaryGeneration.current;
    if (!currentFamily) { setAnniversaries([]); return; }
    const months = [...new Set(gridDays.map(day => Number(day.slice(5, 7))))];
    setAnniversaryError('');
    void (async () => {
      try {
        const collected: AnniversaryRecord[] = [];
        for (const month of months) {
          let cursor: string | null = null;
          for (let page = 0; page < 10; page += 1) {
            const result: { items: AnniversaryRecord[]; nextCursor: string | null } = await queryModelRecords<AnniversaryRecord>(currentFamily.id, 'anniversary', {
              filter: { field: 'month', op: 'eq', value: month },
              sort: [{ field: 'day', direction: 'asc' }],
              page: { limit: 200, ...(cursor ? { cursor } : {}) },
            });
            if (generation !== anniversaryGeneration.current) return;
            collected.push(...result.items);
            cursor = result.nextCursor;
            if (!cursor) break;
            if (page === 9) throw new Error('纪念日查询超出分页限制');
          }
        }
        if (generation === anniversaryGeneration.current) setAnniversaries(collected);
      } catch (cause) {
        if (generation === anniversaryGeneration.current) {
          setAnniversaries([]);
          setAnniversaryError(messageOf(cause, '纪念日加载失败'));
        }
      }
    })();
    return () => { anniversaryGeneration.current += 1; };
  }, [currentFamily, gridStart, gridEndExclusive, refreshToken]);

  useEffect(() => {
    void refreshToken;
    void loadEvents();
    return () => { requestGeneration.current += 1; };
  }, [loadEvents, refreshToken]);

  async function loadMoreSearch() {
    if (!searchActive || !nextSearchCursor || loading || moreLoading) return;
    const generation = requestGeneration.current;
    setMoreLoading(true);
    try {
      const page = await queryEvents(nextSearchCursor);
      if (generation !== requestGeneration.current) return;
      setEvents((previous) => [...previous, ...page.items]);
      setNextSearchCursor(page.nextCursor);
    } catch (cause) {
      if (generation === requestGeneration.current) setError(messageOf(cause, '加载更多搜索结果失败'));
    } finally {
      if (generation === requestGeneration.current) setMoreLoading(false);
    }
  }

  useEffect(() => {
    if (!currentFamily) return;
    const today = currentDateInZone(currentFamily.timezone);
    setMonth(today.slice(0, 7));
    setWeekStart(startOfWeek(today));
    setSelectedDay(null);
    setExpandedDay(null);
    setEditing(null);
    setDraft(null);
  }, [currentFamily?.id, currentFamily?.timezone]);

  useEffect(() => {
    if (!expandedDay) return;
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setExpandedDay(null);
    }
    window.addEventListener('keydown', closeWithEscape);
    return () => window.removeEventListener('keydown', closeWithEscape);
  }, [expandedDay]);

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

  const anniversariesByDay = useMemo(() => {
    const result = new Map<string, AnniversaryRecord[]>();
    for (const date of gridDays) {
      const items = anniversaries.filter(record => matchesAnniversary(date, record));
      if (items.length) result.set(date, items);
    }
    return result;
  }, [gridDays, anniversaries]);

  function openCreate(date?: string) {
    if (!currentFamily) return;
    setEditing(null);
    setDraft(defaultDraft(currentFamily.timezone, date));
    setError(null);
  }

  function openCreateAt(date: string, time: string) {
    if (!currentFamily || !canWrite) return;
    const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + 60;
    const nextDay = minutes >= 1440;
    setEditing(null);
    setDraft({
      ...defaultDraft(currentFamily.timezone, date),
      startTime: time,
      endDate: nextDay ? addDays(date, 1) : date,
      endTime: `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    });
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
      const payload = { ...eventPayload(draft, editing?.location), ...await presentationToSave(currentFamily.id, 'event', draft.icon, editing?.presentation?.icon) };
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

  const todayInFamily = currentFamily ? currentDateInZone(currentFamily.timezone) : dateKey(new Date());
  const monthToday = todayInFamily.slice(0, 7);

  function switchView(next: 'month' | 'week') {
    if (next === view) return;
    setExpandedDay(null);
    if (next === 'week') {
      const focusDay = selectedDay && gridDays.includes(selectedDay)
        ? selectedDay : todayInFamily.startsWith(month) ? todayInFamily : `${month}-01`;
      setWeekStart(startOfWeek(focusDay));
      setSelectedDay(focusDay);
    } else {
      const focusDay = selectedDay && gridDays.includes(selectedDay) ? selectedDay : weekStart;
      setMonth(focusDay.slice(0, 7));
      setSelectedDay(focusDay);
    }
    setView(next);
  }

  function navigatePeriod(offset: number) {
    setExpandedDay(null);
    setSelectedDay(null);
    if (view === 'month') setMonth((previous) => addMonths(previous, offset));
    else setWeekStart((previous) => addDays(previous, offset * 7));
  }

  function jumpToday() {
    setExpandedDay(null);
    setSelectedDay(todayInFamily);
    setMonth(monthToday);
    setWeekStart(startOfWeek(todayInFamily));
  }

  function clearSearch() {
    setSearchInput('');
    setAppliedSearch('');
  }

  if (householdLoading) {
    return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">正在加载家庭日历…</Card>;
  }

  if (!currentFamily) {
    return (
      <div className="space-y-6">
        <CalendarHeader onCreate={() => undefined} canWrite={false} onToggleFilters={() => undefined} filtersExpanded={false} filtersActive={false} />
        <Card className="grid min-h-72 place-items-center p-8 text-center text-sm text-stone-500">请先创建或加入一个家庭。</Card>
      </div>
    );
  }

  const activeDay = selectedDay && gridDays.includes(selectedDay)
    ? selectedDay
    : gridDays.includes(todayInFamily) ? todayInFamily : view === 'week' ? weekStart : `${month}-01`;
  const activeEvents = eventsByDay.get(activeDay) ?? [];

  return (
    <div className="space-y-3 sm:space-y-4">
      <CalendarHeader onCreate={() => openCreate()} canWrite={canWrite} onToggleFilters={() => setFilterOpen((value) => !value)} filtersExpanded={filterOpen} filtersActive={Boolean(appliedSearch || attendeeFilter || kindFilter !== 'all')} />

      {filterOpen ? <div id="calendar-search-filters" className="space-y-3 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-stone-200/80 sm:p-4">
        <form
          className="flex min-w-0 items-center gap-2"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedSearch(searchInput.trim());
            setFilterOpen(false);
            setRefreshToken((value) => value + 1);
          }}
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索家庭日程</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索名称、说明或地点"
              className="h-10 w-full min-w-0 rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm text-stone-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <Button type="submit" variant="primary">搜索</Button>
          {searchActive ? <Button onClick={clearSearch} variant="ghost" aria-label="退出搜索">清除</Button> : null}
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-stone-500">筛选</span>
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">按参与成员筛选</span>
            <select
              className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none focus:border-emerald-400 sm:min-w-36"
              value={attendeeFilter}
              onChange={(event) => setAttendeeFilter(event.target.value)}
              aria-label="按参与成员筛选"
            >
              <option value="">全部成员</option>
              {members.filter((member) => member.personId).map((member) => (
                <option key={member.personId} value={member.personId}>{member.displayName || member.userId}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">按日程类型筛选</span>
            <select
              className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none focus:border-emerald-400 sm:min-w-32"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as 'all' | 'date' | 'instant')}
              aria-label="按日程类型筛选"
            >
              <option value="all">全部类型</option>
              <option value="date">全天日程</option>
              <option value="instant">定时日程</option>
            </select>
          </label>
          {(attendeeFilter || kindFilter !== 'all') ? (
            <button
              type="button"
              onClick={() => { setAttendeeFilter(''); setKindFilter('all'); }}
              className="h-10 shrink-0 rounded-xl px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            >
              重置筛选
            </button>
          ) : null}
        </div>
      </div> : null}

      {anniversaryError ? <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
        纪念日未能同步：{anniversaryError}
      </div> : null}
      {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100" role="alert">{error}</div> : null}

      {searchActive ? (
        <section className="space-y-3" aria-label="家庭日程搜索结果">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-stone-900">搜索结果 · {appliedSearch}</h2>
              <p className="mt-1 text-xs text-stone-500">全家庭范围 · 已显示 {events.length} 项{nextSearchCursor ? '，还有更多结果' : ''}</p>
            </div>
            <Button variant="ghost" onClick={clearSearch}>返回日历</Button>
          </div>
          {loading ? <Card className="p-8 text-center text-sm text-stone-500">正在搜索日程…</Card> : events.length ? (
            <Card className="divide-y divide-stone-100 overflow-hidden">
              {events.map((event) => {
                const span = eventSpan(event, currentFamily.timezone);
                return (
                  <button key={event.id} type="button" onClick={() => openEdit(event)} className="flex w-full min-w-0 items-start gap-3 px-4 py-4 text-left hover:bg-stone-50">
                    <span className="w-24 shrink-0 text-xs font-medium tabular-nums text-stone-500">{span.start}<span className="mt-1 block">{timeLabel(event, currentFamily.timezone)}</span></span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold text-stone-900"><RecordIconMark
              icon={event.presentation?.icon} spaceId={event.spaceId} modelKey="event" recordId={event.id} className="mr-1" />{event.summary}</span>
                      {event.location ? <span className="mt-1 block break-words text-xs text-stone-500">{eventLocationLabel(event.location)}</span> : null}
                      {span.endInclusive > span.start ? <span className="mt-1 block text-xs text-stone-400">持续至 {span.endInclusive}</span> : null}
                    </span>
                  </button>
                );
              })}
            </Card>
          ) : <Card className="p-8 text-center text-sm text-stone-500">没有找到匹配的日程，试试其他关键词或筛选条件。</Card>}
          {nextSearchCursor ? (
            <div className="text-center">
              <Button variant="secondary" disabled={moreLoading || loading} onClick={() => void loadMoreSearch()}>
                {moreLoading ? '正在加载…' : '加载更多结果'}
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-stone-200/80 sm:p-4">
            <div className="min-w-0">
              <p className="font-semibold text-stone-900">
                {view === 'month' ? displayMonth(month) : `${Number(weekStart.slice(5, 7))}月${Number(weekStart.slice(8))}日 — ${Number(addDays(weekStart, 6).slice(5, 7))}月${Number(addDays(weekStart, 6).slice(8))}日`}
              </p>
              <p className="mt-1 text-xs text-stone-500">{currentFamily.timezone}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-stone-100 p-1" role="group" aria-label="日历视图">
                <button type="button" onClick={() => switchView('month')} aria-pressed={view === 'month'} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'month' ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-500 hover:text-stone-900'}`}>月</button>
                <button type="button" onClick={() => switchView('week')} aria-pressed={view === 'week'} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'week' ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-500 hover:text-stone-900'}`}>周</button>
              </div>
              <Button variant="secondary" size="icon" aria-label={view === 'month' ? '上个月' : '上一周'} onClick={() => navigatePeriod(-1)}><ChevronLeft className="size-4" /></Button>
              <Button variant="secondary" onClick={jumpToday}>今天</Button>
              <Button variant="secondary" size="icon" aria-label={view === 'month' ? '下个月' : '下一周'} onClick={() => navigatePeriod(1)}><ChevronRight className="size-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="刷新" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></Button>
            </div>
          </div>

          {loading ? <p className="text-center text-xs text-stone-500" role="status">正在更新日程…</p> : null}

          {view === 'month' ? (
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
                  const dayAnniversaries = anniversariesByDay.get(day) ?? [];
                  const inMonth = day.startsWith(month);
                  const isToday = day === todayInFamily;
                  const isSelected = day === activeDay;
                  return (
                    <div key={day} className={`group relative min-w-0 border-b border-r border-stone-100 p-0.5 sm:min-h-36 sm:p-2 ${inMonth ? 'bg-white' : 'bg-stone-50/60'}`}>
                      {canWrite ? <button
                        type="button"
                        aria-label={`${day}，在空白处新建日程`}
                        title="点击空白处新建日程"
                        onClick={() => openCreate(day)}
                        className="absolute inset-0 z-0 hidden cursor-crosshair hover:bg-emerald-50/30 focus-visible:bg-emerald-50/30 focus-visible:outline-2 focus-visible:outline-emerald-500 sm:block"
                      /> : null}
                      <button
                        type="button"
                        className={`relative z-10 flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold sm:hidden ${isSelected ? 'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-200' : inMonth ? 'text-stone-700' : 'text-stone-400'}`}
                        onClick={() => setSelectedDay(day)}
                        aria-pressed={isSelected}
                        aria-label={`${day}，${dayEvents.length} 项日程，${dayAnniversaries.length} 项纪念日`}
                      >
                        <span className={`grid size-6 place-items-center rounded-full ${isToday ? 'bg-emerald-600 text-white' : ''}`}>{Number(day.slice(-2))}</span>
                        <span className="flex gap-0.5" aria-hidden="true">{dayEvents.length ? <span className="size-1.5 rounded-full bg-emerald-500" /> : null}{dayAnniversaries.length ? <span className="size-1.5 rounded-full bg-violet-500" /> : null}</span>
                      </button>
                      <button
                        type="button"
                        className={`relative z-10 hidden size-7 place-items-center rounded-full text-xs font-medium sm:grid ${isToday ? 'bg-emerald-600 text-white' : inMonth ? 'text-stone-700 hover:bg-stone-100' : 'text-stone-400'}`}
                        onClick={() => setExpandedDay(day)}
                        aria-label={`${day}，查看全部 ${dayEvents.length} 项日程和 ${dayAnniversaries.length} 项纪念日`}
                      >
                        {Number(day.slice(-2))}
                      </button>
                      <div className="relative z-10 mt-1.5 hidden space-y-1 sm:block">
                        {dayAnniversaries.slice(0, 2).map(item => (
                          <Link key={`${day}-ann-${item.id}`} to="/anniversaries"
                            title={`纪念日 · ${item.name}`}
                            className="block w-full truncate rounded-lg bg-violet-50 px-2 py-1 text-xs text-violet-900 hover:bg-violet-100">
                            🎁 {item.name}
                          </Link>
                        ))}
                        {dayEvents.slice(0, Math.max(0, 4 - Math.min(2, dayAnniversaries.length))).map((event) => (
                          <button
                            key={`${day}-${event.id}`}
                            type="button"
                            onClick={() => openEdit(event)}
                            className="block w-full truncate rounded-lg bg-emerald-50 px-1.5 py-1 text-left text-[11px] leading-4 text-emerald-900 transition hover:bg-emerald-100 sm:px-2 sm:text-xs"
                            title={`${timeLabel(event, currentFamily.timezone)} ${event.summary}`}
                          >
                            <span className="mr-1 font-medium text-emerald-700">{timeLabel(event, currentFamily.timezone)}</span><RecordIconMark
                              icon={event.presentation?.icon} spaceId={event.spaceId} modelKey="event" recordId={event.id}
                              className="mr-1" />{event.summary}
                          </button>
                        ))}
                        {dayEvents.length + dayAnniversaries.length > 4 ? (
                          <button type="button" className="w-full rounded-lg px-1 py-1.5 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500"
                            aria-label={`${day} 查看全部 ${dayEvents.length + dayAnniversaries.length} 项安排`}
                            onClick={() => setExpandedDay(day)}>
                            查看全部 {dayEvents.length + dayAnniversaries.length} 项
                          </button>
                        ) : null}
                      </div>
                      {canWrite && !dayEvents.length && !dayAnniversaries.length ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 bottom-3 hidden items-center justify-center gap-1 text-[11px] text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:flex"><Plus className="size-3" /> 新建日程</span> : null}
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : (
            <WeekTimeGrid
              days={gridDays}
              selectedDay={activeDay}
              eventsByDay={eventsByDay}
              timezone={currentFamily.timezone}
              members={members}
              canWrite={canWrite}
              onSelectDay={setSelectedDay}
              onOpen={(event) => { const record = events.find((item) => item.id === event.id); if (record) openEdit(record); }}
              onCreate={openCreateAt}
            />
          )}

          {view === 'week' && [...anniversariesByDay.values()].some(list => list.length > 0) ? <Card className="space-y-2 p-4"><p className="text-sm font-semibold text-violet-900">本周纪念日</p>{gridDays.filter(day => (anniversariesByDay.get(day)?.length ?? 0) > 0).map(day => <div key={day}><span className="text-xs text-stone-500">{day}</span><AnniversaryDayItems records={anniversariesByDay.get(day) ?? []} /></div>)}</Card> : null}
          {view === 'month' ? <section className="space-y-3 sm:hidden" aria-label={`${activeDay}的日程`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-stone-900">{Number(activeDay.slice(5, 7))}月{Number(activeDay.slice(8))}日 · 日程</h2>
              {canWrite ? <Button variant="secondary" className="shrink-0" onClick={() => openCreate(activeDay)}><Plus className="size-4" /> 新建</Button> : null}
            </div>
            <AnniversaryDayItems records={anniversariesByDay.get(activeDay) ?? []} />
            <CalendarAgenda events={activeEvents} timeZone={currentFamily.timezone} onOpen={openEdit} />
          </section> : null}
        </>
      )}

      {expandedDay && !searchActive && view === 'month' ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedDay(null); }}>
          <div role="dialog" aria-modal="true" aria-label={`${expandedDay}的全部日程`} onScroll={showScrollbarWhileScrolling} className="max-h-[85dvh] w-full max-w-xl overflow-y-auto overscroll-contain scrollbar-overlay rounded-t-3xl bg-[#f6f8f4] p-4 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-stone-900">{Number(expandedDay.slice(5, 7))}月{Number(expandedDay.slice(8))}日 · 全部日程</h2>
                <p className="mt-1 text-xs text-stone-500">{(eventsByDay.get(expandedDay) ?? []).length} 项日程</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="关闭日程列表" autoFocus onClick={() => setExpandedDay(null)}><X className="size-4" /></Button>
            </div>
            <AnniversaryDayItems records={anniversariesByDay.get(expandedDay) ?? []} />
            <CalendarAgenda events={eventsByDay.get(expandedDay) ?? []} timeZone={currentFamily.timezone} onOpen={(event) => { setExpandedDay(null); openEdit(event); }} />
            {canWrite ? <Button variant="primary" className="mt-4 w-full" onClick={() => { const date = expandedDay; setExpandedDay(null); openCreate(date); }}><Plus className="size-4" /> 新建当天日程</Button> : null}
          </div>
        </div>
      ) : null}

      {draft ? (
        <EventEditor
          draft={draft}
          spaceId={currentFamily?.id || ''}
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

function CalendarAgenda({ events, timeZone, onOpen }: {
  events: EventRecord[];
  timeZone: string;
  onOpen: (event: EventRecord) => void;
}) {
  return events.length ? (
    <Card className="divide-y divide-stone-100 overflow-hidden">
      {events.map((event) => (
        <button key={event.id} type="button" onClick={() => onOpen(event)} className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-stone-50">
          <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-stone-500">{timeLabel(event, timeZone)}</span>
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold text-stone-900"><RecordIconMark
              icon={event.presentation?.icon} spaceId={event.spaceId} modelKey="event" recordId={event.id}
              className="mr-1" />{event.summary}</span>
            {event.location ? <span className="mt-1 block break-words text-xs text-stone-500">{eventLocationLabel(event.location)}</span> : null}
          </span>
        </button>
      ))}
    </Card>
  ) : <Card className="p-6 text-center text-sm text-stone-500">这一天还没有日程。</Card>;
}

function CalendarHeader({ onCreate, canWrite, onToggleFilters, filtersExpanded, filtersActive }: {
  onCreate: () => void;
  canWrite: boolean;
  onToggleFilters: () => void;
  filtersExpanded: boolean;
  filtersActive: boolean;
}) {
  return (
    <PageHeader title="家庭日程">
      <Button variant="secondary" onClick={onToggleFilters} aria-expanded={filtersExpanded}
        aria-controls="calendar-search-filters" className={filtersActive ? "text-emerald-800 ring-emerald-300" : ""}>
        <SlidersHorizontal className="size-4" /> 搜索与筛选{filtersActive ? " · 已启用" : ""}
      </Button>
      <Button variant="primary" disabled={!canWrite} onClick={onCreate}><Plus className="size-4" /> 新建日程</Button>
    </PageHeader>
  );
}

export function EventEditor({
  draft,
  spaceId,
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
  spaceId: string;
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
      <form onScroll={showScrollbarWhileScrolling} onSubmit={onSave} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto overscroll-contain scrollbar-overlay rounded-t-3xl bg-stone-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-stone-950">{editing ? (readOnly ? '日程详情' : '编辑日程') : '新建日程'}</p>
            <p className="mt-1 text-xs text-stone-500">按 {draft.timezone} 查看和编辑时间</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}><X className="size-4" /></Button>
        </div>

        <div className="mt-5 grid gap-4">
          <RecordTitleField label="日程名称" icon={draft.icon} onIconChange={icon => set('icon', icon)} disabled={readOnly || saving} original={editing?.presentation?.icon} spaceId={spaceId} modelKey="event" recordId={editing?.id}>
            <input className={inputClass} disabled={readOnly} maxLength={100} value={draft.summary} onChange={(event) => set('summary', event.target.value)} autoFocus={!editing} />
          </RecordTitleField>

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

          <PlaceSearchInput name={draft.location} point={draft.locationPoint}
            existing={editing?.location} disabled={readOnly}
            onChange={(name, point) => onChange({ ...draft, location: name, locationPoint: point })} />

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


type PlaceSearchResult = { items: LocationValue[]; available: boolean; structured: boolean };
function locationMapLinks(value: EventLocation) {
  const name=eventLocationLabel(value);
  if (!name) return null;
  const point=value && typeof value==='object' ? value.coordinates : undefined;
  const amap=new URL(point ? 'https://uri.amap.com/marker' : 'https://uri.amap.com/search');
  if(point) {
    amap.searchParams.set('position', `${point.longitude},${point.latitude}`);
    amap.searchParams.set('name', name);
    amap.searchParams.set('coordinate','wgs84');
  } else amap.searchParams.set('keyword',name);
  amap.searchParams.set('src','homemew');
  const google=new URL('https://www.google.com/maps/search/');
  google.searchParams.set('api','1');
  google.searchParams.set('query',point ? `${point.latitude},${point.longitude}` : name);
  return {amap:amap.toString(),google:google.toString()};
}
function PlaceSearchInput({name,point,existing,onChange,disabled}:{
  name:string;point?:LocationValue|null;existing?:EventLocation;
  onChange:(name:string,point:LocationValue|null)=>void;disabled:boolean;
}) {
  const [items,setItems]=useState<LocationValue[]>([]);
  const [active,setActive]=useState(false);
  const [note,setNote]=useState('');
  const [structured,setStructured]=useState(false);
  const displayed=point?.name===name.trim()?point:
    eventLocationLabel(existing??null)===name.trim()?existing:null;
  const links=locationMapLinks(displayed??name);
  useEffect(()=>{
    const text=name.trim();
    if(disabled||!active||text.length<2){setItems([]);setNote('');return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      void apiRequest<PlaceSearchResult>(`/api/places/search?q=${encodeURIComponent(text)}`,{signal:controller.signal})
        .then(data=>{setItems(data.items);setStructured(data.structured);
          setNote(data.available?(data.items.length?'':'没有找到匹配地点，可直接保存名称'):'地点推荐暂不可用，可直接保存名称');})
        .catch(()=>{if(!controller.signal.aborted){setItems([]);setNote('地点搜索暂不可用，可直接保存名称');}});
    },350);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[name,active,disabled]);
  return <div className="grid gap-1.5 text-sm font-medium text-stone-700">
    <label htmlFor="event-location" className="flex items-center gap-1.5"><MapPin className="size-3.5" /> 地点</label>
    <input id="event-location" className={inputClass} disabled={disabled} maxLength={500}
      autoComplete="off" value={name} placeholder="输入地点名称或自由填写"
      onFocus={()=>setActive(true)}
      onChange={event=>{onChange(event.target.value,null);setActive(true);}} />
    {active&&!disabled&&items.length>0?<div className="max-h-44 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-sm">
      {items.map((item,index)=><button type="button" key={index}
        className="block w-full border-b border-stone-100 px-3 py-2 text-left last:border-0 hover:bg-stone-50"
        onClick={()=>{onChange(item.name,structured?item:null);setItems([]);setActive(false);}}>
        <span className="block text-sm font-medium text-stone-800">{item.name}</span>
        {item.address?<span className="block text-xs text-stone-500">{item.address}</span>:null}
      </button>)}
    </div>:null}
    {active&&!disabled&&note?<p className="text-xs font-normal text-stone-400">{note}</p>:null}
    {point?.coordinates&&point.name===name.trim()?
      <p className="text-xs font-normal text-emerald-700">已选择精确地点，将保存地址与 WGS84 坐标</p>:null}
    {links?<div className="flex flex-wrap gap-3 text-xs font-normal">
      <a href={links.amap} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">高德地图 ↗</a>
      <a href={links.google} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">Google 地图 ↗</a>
      {!displayed || typeof displayed==='string' || !displayed.coordinates
        ? <span className="text-stone-400">仅按名称搜索，位置可能不唯一</span>:null}
    </div>:null}
  </div>;
}
