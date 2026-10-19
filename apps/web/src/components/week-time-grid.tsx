import { useEffect, useRef } from 'react';
import { layoutTimedRanges, minutesOnDay } from '../lib/calendar-week-layout';

export type WeekEvent = {
  id: string;
  summary: string;
  when: { kind: 'date' | 'instant'; start: string; endExclusive: string };
  attendeePersonIds: string[];
};
export type WeekMember = { personId: string | null; displayName?: string | null; userId: string };

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const PALETTES = [
  { bg: 'bg-emerald-100', edge: 'border-emerald-500', text: 'text-emerald-950', dot: 'bg-emerald-500', hover: 'hover:bg-emerald-200' },
  { bg: 'bg-sky-100', edge: 'border-sky-500', text: 'text-sky-950', dot: 'bg-sky-500', hover: 'hover:bg-sky-200' },
  { bg: 'bg-rose-100', edge: 'border-rose-500', text: 'text-rose-950', dot: 'bg-rose-500', hover: 'hover:bg-rose-200' },
  { bg: 'bg-violet-100', edge: 'border-violet-500', text: 'text-violet-950', dot: 'bg-violet-500', hover: 'hover:bg-violet-200' },
  { bg: 'bg-amber-100', edge: 'border-amber-500', text: 'text-amber-950', dot: 'bg-amber-500', hover: 'hover:bg-amber-200' },
  { bg: 'bg-teal-100', edge: 'border-teal-500', text: 'text-teal-950', dot: 'bg-teal-500', hover: 'hover:bg-teal-200' },
] as const;
const NEUTRAL = { bg: 'bg-stone-100', edge: 'border-stone-400', text: 'text-stone-900', dot: 'bg-stone-400', hover: 'hover:bg-stone-200' };

function localTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}

function EventLane({ day, events, timezone, getPalette, onOpen, canWrite, onCreate }: {
  day: string;
  events: WeekEvent[];
  timezone: string;
  getPalette: (event: WeekEvent) => typeof NEUTRAL;
  onOpen: (event: WeekEvent) => void;
  canWrite: boolean;
  onCreate: (date: string, time: string) => void;
}) {
  const timed = events.filter((event) => event.when.kind === 'instant');
  const ranges = timed.map((event) => ({
    id: event.id,
    ...minutesOnDay(localTime(event.when.start, timezone), localTime(event.when.endExclusive, timezone), day),
  }));
  const layout = layoutTimedRanges(ranges);
  const eventMap = new Map(timed.map((event) => [event.id, event]));
  return (
    <div
      className="relative min-w-0 border-l border-stone-100"
      style={{
        height: HOUR_HEIGHT * 24,
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0px, transparent ${HOUR_HEIGHT - 1}px, #e7e5e4 ${HOUR_HEIGHT - 1}px, #e7e5e4 ${HOUR_HEIGHT}px)`,
      }}
    >
      {canWrite ? (
        <button
          type="button"
          className="absolute inset-0 w-full cursor-crosshair hover:bg-emerald-50/30"
          aria-label={`在 ${day} 时间格中新建日程`}
          onClick={(click) => {
            const rect = click.currentTarget.getBoundingClientRect();
            const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor((click.clientY - rect.top) / (HOUR_HEIGHT / 60) / 30) * 30));
            onCreate(day, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
          }}
        />
      ) : null}
      {layout.map((range) => {
        const event = eventMap.get(range.id);
        if (!event) return null;
        const color = getPalette(event);
        const top = range.startMinute / 60 * HOUR_HEIGHT;
        const height = Math.max(24, (range.endMinute - range.startMinute) / 60 * HOUR_HEIGHT - 2);
        const laneWidth = 100 / range.columns;
        return (
          <button
            type="button"
            key={event.id}
            onClick={() => onOpen(event)}
            title={`${event.summary} · ${localTime(event.when.start, timezone).time}–${localTime(event.when.endExclusive, timezone).time}`}
            className={`absolute z-10 overflow-hidden rounded-r-lg border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-4 shadow-sm transition focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 ${color.bg} ${color.edge} ${color.text} ${color.hover}`}
            style={{
              top,
              height,
              left: `calc(${range.column * laneWidth}% + 2px)`,
              width: `calc(${laneWidth}% - 4px)`,
            }}
          >
            <span className="block truncate font-semibold">{localTime(event.when.start, timezone).date === day ? localTime(event.when.start, timezone).time : '续'} {event.summary}</span>
            {height >= 42 ? <span className="block truncate opacity-70">{localTime(event.when.start, timezone).time}–{localTime(event.when.endExclusive, timezone).time}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function WeekTimeGrid({ days, selectedDay, eventsByDay, timezone, members, onSelectDay, onOpen, onCreate, canWrite }: {
  days: string[];
  selectedDay: string;
  eventsByDay: Map<string, WeekEvent[]>;
  timezone: string;
  members: WeekMember[];
  onSelectDay: (date: string) => void;
  onOpen: (event: WeekEvent) => void;
  onCreate: (date: string, time: string) => void;
  canWrite: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT; }, [days[0]]);
  const people = [...members].filter((member) => member.personId).sort((a, b) => a.personId!.localeCompare(b.personId!));
  const colors = new Map(people.map((member, index) => [member.personId!, PALETTES[index % PALETTES.length]]));
  const getPalette = (event: WeekEvent): typeof NEUTRAL => {
    const selected = [...(event.attendeePersonIds ?? [])].sort().find((id) => colors.has(id));
    return selected ? colors.get(selected)! : NEUTRAL;
  };
  const renderAllDay = (day: string) => (eventsByDay.get(day) ?? []).filter((event) => event.when.kind === 'date').map((event) => {
    const color = getPalette(event);
    return (
      <button key={event.id} type="button" onClick={() => onOpen(event)}
        title={event.summary}
        className={`block w-full truncate rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11px] font-semibold ${color.bg} ${color.edge} ${color.text} ${color.hover}`}
      >{event.summary}</button>
    );
  });
  return (
    <section aria-label="按小时排布的周日程" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-stone-500" aria-label="参与成员颜色图例">
        {people.map((member) => <span key={member.personId} className="inline-flex items-center gap-1"><span className={`size-2 rounded-full ${colors.get(member.personId!)!.dot}`} />{member.displayName || member.userId}</span>)}
        <span className="inline-flex items-center gap-1"><span className={`size-2 rounded-full ${NEUTRAL.dot}`} />未指定</span>
      </div>
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-stone-200/80">
        <div className="grid grid-cols-7 border-b border-stone-200 pl-12">
          {days.map((day, index) => (
            <button type="button" key={day} onClick={() => onSelectDay(day)} aria-pressed={selectedDay === day}
              className={`min-w-0 border-l border-stone-100 px-0.5 py-2 text-center text-xs hover:bg-emerald-50 ${selectedDay === day ? 'bg-emerald-50 font-semibold text-emerald-800' : 'text-stone-600'}`}
            >
              <span className="block">周{['一', '二', '三', '四', '五', '六', '日'][index]}</span>
              <span className="mt-0.5 block">{Number(day.slice(5, 7))}/{Number(day.slice(8))}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-stone-100 py-1">
          <span className="self-center text-center text-[10px] text-stone-400">全天</span>
          {days.map((day) => <div key={day} className="min-w-0 space-y-0.5 border-l border-stone-100 px-1">{renderAllDay(day)}</div>)}
        </div>
        <div ref={scrollRef} className="max-h-[68dvh] overflow-y-auto overscroll-contain scrollbar-overlay">
          <div className="hidden grid-cols-[48px_repeat(7,minmax(0,1fr))] sm:grid">
            <div className="relative" style={{ height: HOUR_HEIGHT * 24 }}>
              {HOURS.map((hour) => <span key={hour} className="absolute -translate-y-1/2 pr-1 text-right text-[10px] text-stone-400" style={{ top: hour * HOUR_HEIGHT + 1, right: 3 }}>{String(hour).padStart(2, '0')}:00</span>)}
            </div>
            {days.map((day) => <EventLane key={day} day={day} timezone={timezone} events={eventsByDay.get(day) ?? []} getPalette={getPalette} onOpen={onOpen} canWrite={canWrite} onCreate={onCreate} />)}
          </div>
          <div className="grid grid-cols-[48px_minmax(0,1fr)] sm:hidden">
            <div className="relative" style={{ height: HOUR_HEIGHT * 24 }}>
              {HOURS.map((hour) => <span key={hour} className="absolute -translate-y-1/2 pr-1 text-right text-[10px] text-stone-400" style={{ top: hour * HOUR_HEIGHT + 1, right: 3 }}>{String(hour).padStart(2, '0')}:00</span>)}
            </div>
            <EventLane day={selectedDay} timezone={timezone} events={eventsByDay.get(selectedDay) ?? []} getPalette={getPalette} onOpen={onOpen} canWrite={canWrite} onCreate={onCreate} />
          </div>
        </div>
      </div>
    </section>
  );
}
