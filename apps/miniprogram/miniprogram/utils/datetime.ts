/**
 * Time-point values are UTC instants. Date-only values never pass through UTC.
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function resolveDeviceTimeZone(
  deviceTimeZone?: string,
  familyTimeZone?: string,
): string {
  if (isValidTimeZone(deviceTimeZone)) return deviceTimeZone;
  if (isValidTimeZone(familyTimeZone)) return familyTimeZone;
  return 'Asia/Shanghai';
}

export function getSystemTimeZone(familyTimeZone?: string): string {
  let deviceTimeZone: string | undefined;
  try {
    deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    deviceTimeZone = undefined;
  }
  return resolveDeviceTimeZone(deviceTimeZone, familyTimeZone);
}

export function parseDateOnly(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return new Date(Number.NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDaysToDateOnly(dateStr: string, days: number): string {
  const date = parseDateOnly(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateOnly(date);
}

export type ZonedDateTimeParts = {
  date: string;
  time: string;
};

export function formatInstantInTimeZone(
  instant: string,
  timeZone: string,
): ZonedDateTimeParts {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }
  const value = new Date(instant);
  if (Number.isNaN(value.getTime())) {
    throw new Error(`Invalid UTC instant: ${instant}`);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value || '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const hour = values.hour === 24 ? 0 : values.hour;
  const representedAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    hour,
    values.minute,
    values.second,
  );
  return Math.round((representedAsUtc - instant.getTime()) / 60_000);
}

export function getWallTimeCandidates(
  date: string,
  time: string,
  timeZone: string,
): string[] {
  if (
    !isValidTimeZone(timeZone)
    || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !/^\d{2}:\d{2}$/.test(time)
  ) {
    return [];
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (
    month < 1 || month > 12 || day < 1 || day > 31
    || hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) {
    return [];
  }
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = new Set<number>();
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 6) {
    offsets.add(
      timeZoneOffsetMinutes(
        new Date(wallClockAsUtc + deltaHours * 3_600_000),
        timeZone,
      ),
    );
  }
  return [...offsets]
    .map(offset => new Date(wallClockAsUtc - offset * 60_000))
    .filter(candidate => {
      const roundTrip = formatInstantInTimeZone(candidate.toISOString(), timeZone);
      return roundTrip.date === date && roundTrip.time === time;
    })
    .map(candidate => candidate.toISOString())
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
}

export function zonedDateTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string {
  const candidates = getWallTimeCandidates(date, time, timeZone);
  if (candidates.length === 0) {
    throw new Error('The selected local time does not exist in this timezone');
  }
  return candidates[0];
}
