/**
 * HomeMew Event editor UX: changing the start moves the end by the same
 * elapsed duration. The caller supplies platform-specific timezone
 * conversions; this pure helper never guesses an offset or alters Event truth.
 */
export type EditableEventRange = {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
};
export type EventTimeConversion = {
  toStartInstant: (date: string, time: string) => string | undefined;
  toEndInstant: (date: string, time: string) => string | undefined;
  fromEndInstant: (instant: string) => { date: string; time: string };
};

function dayTimestamp(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;
  const value=Date.parse(date+'T00:00:00.000Z');
  return Number.isFinite(value) && new Date(value).toISOString().slice(0,10)===date ? value : Number.NaN;
}

/** Move an optional date-only endpoint by the existing calendar-day span. */
export function shiftDateEndWithStart(oldStart: string, oldEnd: string, newStart: string): string {
  const start=dayTimestamp(oldStart),end=dayTimestamp(oldEnd),next=dayTimestamp(newStart);
  if(![start,end,next].every(Number.isFinite)||end<start)return oldEnd;
  return new Date(next+(end-start)).toISOString().slice(0,10);
}

export function shiftEndWithStart(
  draft: EditableEventRange,
  start: { date?: string; time?: string },
  conversion: EventTimeConversion,
): Pick<EditableEventRange, 'startDate' | 'startTime' | 'endDate' | 'endTime'> {
  const startDate=start.date??draft.startDate;
  const startTime=start.time??draft.startTime;
  const unchanged={startDate,startTime,endDate:draft.endDate,endTime:draft.endTime};
  if(startDate===draft.startDate && startTime===draft.startTime)return unchanged;

  if(draft.isAllDay){
    return {...unchanged,endDate:shiftDateEndWithStart(draft.startDate,draft.endDate,startDate)};
  }

  // Preserve the previous absolute duration across midnight and DST.
  try {
    const oldStart=Date.parse(conversion.toStartInstant(draft.startDate,draft.startTime)??'');
    const oldEnd=Date.parse(conversion.toEndInstant(draft.endDate,draft.endTime)??'');
    const newStart=Date.parse(conversion.toStartInstant(startDate,startTime)??'');
    if(![oldStart,oldEnd,newStart].every(Number.isFinite)||oldEnd<=oldStart)return unchanged;
    const end=conversion.fromEndInstant(new Date(newStart+(oldEnd-oldStart)).toISOString());
    return {...unchanged,endDate:end.date,endTime:end.time};
  }catch{
    // Incomplete input or nonexistent DST local time: retain end and let
    // the existing form validation reject invalid instants at save time.
    return unchanged;
  }
}
