import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, CheckSquare2, Clock3, RefreshCw, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { ApiError, apiRequest } from '../lib/api-client';

type EventRecord = { id: string; summary: string; location: string | null; isAllDay: boolean; startAt: string | null; attendeePersonIds: string[]; version: number };
type TaskRecord = { id: string; name: string; dueDate: string | null; assigneePersonIds: string[]; version: number };
type DayRecord = { id: string; name: string; kind: 'elapsed' | 'countdown' | 'cycle'; icon: string | null; computed?: { temporal?: { elapsedDays?: number; remainingDays?: number | null; nextDueDate?: string; isAttentionRequired: boolean } } };
type List<T> = { items: T[]; nextCursor: string | null };

function dateParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
function addDay(date: string) { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); }
function localMidnight(date: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number); const desired = Date.UTC(year, month - 1, day); let candidate = desired;
  for (let i = 0; i < 3; i += 1) {
    const p = dateParts(new Date(candidate), timeZone); const [y, m, d] = p.date.split('-').map(Number); const [h, min] = p.time.split(':').map(Number);
    candidate += desired - Date.UTC(y, m - 1, d, h, min);
  }
  return new Date(candidate).toISOString();
}
function message(cause: unknown) {
  if (cause instanceof ApiError) return `${cause.message}${cause.requestId ? ` · ${cause.requestId}` : ''}`;
  return cause instanceof Error ? cause.message : '无法加载首页';
}
function dayValue(record: DayRecord) {
  const c = record.computed?.temporal;
  if (!c) return '需要关注';
  if (record.kind === 'elapsed') return `已经 ${c.elapsedDays ?? 0} 天`;
  const remaining = c.remainingDays ?? 0;
  if (remaining === 0) return record.kind === 'cycle' ? '今天到期' : '就是今天';
  return remaining > 0 ? `还有 ${remaining} 天` : `已超过 ${Math.abs(remaining)} 天`;
}

export function HomePage() {
  const { currentFamily, members, user, loading: householdLoading } = useHousehold();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [days, setDays] = useState<DayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [actingTask, setActingTask] = useState<string | null>(null);
  const canWrite = Boolean(currentFamily && currentFamily.role !== 'viewer');

  const load = useCallback(async () => {
    if (!currentFamily) { setEvents([]); setTasks([]); setDays([]); return; }
    setLoading(true); setError(null);
    try {
      const today = dateParts(new Date(), currentFamily.timezone).date;
      const tomorrow = addDay(today);
      const eventParams = new URLSearchParams({ status: 'active', rangeStart: localMidnight(today, currentFamily.timezone), rangeEnd: localMidnight(tomorrow, currentFamily.timezone), dateStart: today, dateEndExclusive: tomorrow, sort: 'calendarStart:asc', limit: '50' });
      const taskParams = new URLSearchParams({ status: 'pending', dueDateTo: today, sort: 'dueDate:asc', limit: '20' });
      const dayParams = new URLSearchParams({ status: 'active', attentionOnly: 'true', sort: 'attention:desc', limit: '6' });
      const [eventResult, taskResult, dayResult] = await Promise.all([
        apiRequest<List<EventRecord>>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/events?${eventParams}`),
        apiRequest<List<TaskRecord>>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/tasks?${taskParams}`),
        apiRequest<List<DayRecord>>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/day-records?${dayParams}`),
      ]);
      setEvents(eventResult.items); setTasks(taskResult.items); setDays(dayResult.items);
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }, [currentFamily]);
  useEffect(() => { void refresh; void load(); }, [load, refresh]);

  async function complete(task: TaskRecord) {
    if (!currentFamily || !canWrite) return;
    setActingTask(task.id); setError(null);
    try {
      await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/tasks/${encodeURIComponent(task.id)}/actions/complete`, { method: 'POST', body: JSON.stringify({ version: task.version }) });
      setRefresh((value) => value + 1);
    } catch (cause) { setError(message(cause)); }
    finally { setActingTask(null); }
  }

  if (householdLoading) return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">正在加载首页…</Card>;
  if (!currentFamily) return <Card className="grid min-h-72 place-items-center p-8 text-sm text-stone-500">请先创建或加入一个家庭。</Card>;

  const now = new Date();
  const local = dateParts(now, currentFamily.timezone);
  const hour = Number(local.time.slice(0, 2));
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: currentFamily.timezone, month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  const memberName = (personId: string) => members.find((member) => member.personId === personId)?.displayName;

  return <div className="space-y-6">
    <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm font-medium text-stone-400">{dateLabel} · {currentFamily.name}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">{greeting}{user?.displayName ? `，${user.displayName}` : ''}。</h1><p className="mt-2 text-sm text-stone-500">今天家里有这些事。</p></div>
      <Button variant="ghost" size="icon" aria-label="刷新" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></Button>
    </section>
    {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
      <Card className="overflow-hidden"><CardHeader><div><p className="text-sm font-semibold text-stone-900">今天的日程</p><p className="mt-1 text-xs text-stone-400">{currentFamily.timezone}</p></div><Link to="/calendar"><Button variant="ghost" className="h-9 px-3">全部日程 <ArrowRight className="size-4" /></Button></Link></CardHeader><CardContent className="space-y-1 pt-3">
        {events.length ? events.slice(0, 8).map((event) => {
          const time = event.isAllDay || !event.startAt ? '全天' : dateParts(new Date(event.startAt), currentFamily.timezone).time;
          const people = event.attendeePersonIds.map(memberName).filter(Boolean).join('、');
          const meta = [event.location, people].filter(Boolean).join(' · ');
          return <div key={event.id} className="grid grid-cols-[54px_10px_1fr] items-start gap-3 rounded-2xl px-2 py-3"><span className="pt-0.5 text-sm font-semibold tabular-nums text-stone-500">{time}</span><span className="mt-1.5 size-2.5 rounded-full bg-emerald-500" /><div><p className="text-sm font-semibold text-stone-900">{event.summary}</p>{meta ? <p className="mt-1 text-xs text-stone-400">{meta}</p> : null}</div></div>;
        }) : <p className="px-2 py-8 text-center text-sm text-stone-400">今天没有日程。</p>}
      </CardContent></Card>

      <Card><CardHeader><div><p className="text-sm font-semibold text-stone-900">今天与逾期待办</p><p className="mt-1 text-xs text-stone-400">{tasks.length ? `${tasks.length} 件需要处理` : '已经清空'}</p></div><Link to="/tasks"><Button variant="ghost" className="h-9 px-3">全部 <ArrowRight className="size-4" /></Button></Link></CardHeader><CardContent className="space-y-2 pt-3">
        {tasks.length ? tasks.slice(0, 8).map((task) => {
          const assignees = task.assigneePersonIds.map(memberName).filter(Boolean).join('、'); const overdue = Boolean(task.dueDate && task.dueDate < local.date);
          return <div key={task.id} className="flex items-start gap-3 rounded-2xl p-2"><button type="button" disabled={!canWrite || actingTask === task.id} onClick={() => void complete(task)} className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-stone-300 text-transparent transition hover:border-emerald-500 hover:text-emerald-500 disabled:opacity-50">{actingTask === task.id ? <RefreshCw className="size-3 animate-spin text-stone-400" /> : <Check className="size-3" />}</button><div className="min-w-0"><p className="text-sm font-medium text-stone-800">{task.name}</p><p className={`mt-1 text-xs ${overdue ? 'font-medium text-red-500' : 'text-stone-400'}`}>{task.dueDate ? (overdue ? `已逾期 · ${task.dueDate}` : '今天截止') : '无截止日期'}{assignees ? ` · ${assignees}` : ''}</p></div></div>;
        }) : <p className="px-2 py-8 text-center text-sm text-stone-400">没有到期或逾期待办。</p>}
      </CardContent></Card>
    </section>

    <section className="grid gap-4 md:grid-cols-3">
      <StatCard to="/calendar" icon={<CalendarDays className="size-5" />} label="今日日程" value={`${events.length} 项`} detail={events.length ? '查看家庭日历' : '今天比较轻松'} />
      <StatCard to="/tasks" icon={<CheckSquare2 className="size-5" />} label="需要处理" value={`${tasks.length} 项`} detail={tasks.some((task) => task.dueDate && task.dueDate < local.date) ? '包含逾期待办' : '今天与到期事项'} />
      <StatCard to="/days" icon={<Clock3 className="size-5" />} label="日子提醒" value={days[0] ? `${days[0].icon ? `${days[0].icon} ` : ''}${days[0].name}` : '暂无提醒'} detail={days[0] ? dayValue(days[0]) : '没有需要关注的日子'} />
    </section>
    {days.length > 1 ? <Card className="p-5"><div className="flex items-center gap-2"><Sparkles className="size-4 text-amber-500" /><p className="text-sm font-semibold text-stone-800">还有 {days.length - 1} 项日子需要关注</p><Link to="/days" className="ml-auto text-sm font-medium text-emerald-700">查看</Link></div></Card> : null}
  </div>;
}

function StatCard({ to, icon, label, value, detail }: { to: string; icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <Link to={to}><Card className="h-full p-5 transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between"><span className="grid size-10 place-items-center rounded-2xl bg-stone-100 text-stone-600">{icon}</span><ArrowRight className="size-4 text-stone-300" /></div><p className="mt-5 text-xs font-medium text-stone-400">{label}</p><p className="mt-1 text-lg font-semibold text-stone-900">{value}</p><p className="mt-1 text-sm text-stone-500">{detail}</p></Card></Link>;
}
