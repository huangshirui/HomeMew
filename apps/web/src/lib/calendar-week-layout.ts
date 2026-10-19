export type TimedRange = { id: string; startMinute: number; endMinute: number };
export type PositionedRange = TimedRange & { column: number; columns: number };

/**
 * Layout a single local calendar day. Touching endpoints do not collide.
 * Groups of connected overlaps share the maximum concurrent lane count;
 * this avoids a narrow item obscuring another item at the same time.
 */
export function layoutTimedRanges(input: TimedRange[]): PositionedRange[] {
  const sorted = [...input]
    .filter((item) => item.endMinute > item.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.id.localeCompare(b.id));
  const result: PositionedRange[] = [];
  let group: Array<TimedRange & { column: number }> = [];
  let groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    const columns = Math.max(...group.map((item) => item.column)) + 1;
    for (const item of group) result.push({ ...item, columns });
    group = [];
  };
  for (const item of sorted) {
    if (item.startMinute >= groupEnd) { flush(); groupEnd = -1; }
    const used = new Set(group.filter((other) => other.endMinute > item.startMinute).map((other) => other.column));
    let column = 0;
    while (used.has(column)) column++;
    group.push({ ...item, column });
    groupEnd = Math.max(groupEnd, item.endMinute);
  }
  flush();
  return result;
}

/** Current viewing timezone determines the wall-clock position, not UTC hours. */
export function minutesOnDay(start: { date: string; time: string }, end: { date: string; time: string }, day: string) {
  const parse = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return {
    startMinute: day === start.date ? parse(start.time) : 0,
    endMinute: day === end.date ? parse(end.time) : 1440,
  };
}
