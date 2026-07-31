/**
 * Time-point values are UTC instants. Date-only values never pass through UTC.
 *
 * ----------------------------------------------------------------------------
 * WHY WE DO NOT RELY ON `Intl.DateTimeFormat` WITH A `timeZone` OPTION
 * ----------------------------------------------------------------------------
 * The IANA timezone *name* (e.g. "Asia/Shanghai") is just a plain string: it
 * can be returned by Core, stored locally, and passed into these functions
 * without any problem. The trouble is NOT obtaining the string.
 *
 * The trouble is performing the conversion with
 *   new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai' })
 * On WeChat real devices the JS runtime (JSCore on iOS, a custom engine on
 * Android) frequently ships WITHOUT a full ICU timezone database, so the
 * `timeZone` option of `Intl` is either:
 *   - silently ignored and the device's local timezone used instead, or
 *   - rejected outright (throws), which is what previously produced
 *     "Invalid IANA timezone: Asia/Shanghai" on real devices.
 *
 * Symptoms: the WeChat devtools (desktop Chrome, complete Intl) work fine, but
 * the same code fails on a real phone. This cannot be fixed by reading the
 * timezone string more carefully -- the conversion engine is the problem.
 *
 * Our strategy here therefore never TRUSTS `Intl` blindly:
 *   1. Attempt `Intl` first, but VERIFY it honoured the request by comparing
 *      `resolvedOptions().timeZone` with the requested zone. A runtime that
 *      silently ignored the option resolves to the device zone instead, so
 *      the mismatch is detected and the attempt is discarded; a runtime that
 *      throws is caught. Where Intl genuinely works this path is exact,
 *      including DST shifts.
 *   2. Fall back to a STATIC offset table (KNOWN_TZ_OFFSETS). These are plain
 *      constants with no dependency on Intl, so they work on every device,
 *      100% reliably. Fixed-offset zones (e.g. Asia/Shanghai = UTC+8, no DST)
 *      are resolved exactly this way.
 *   3. If even that fails, fall back to the device's own local offset.
 *
 * DST zones are intentionally recorded with their standard (winter) offset in
 * the table; the verified-Intl path above is what corrects DST shifts where
 * Intl works. For the common China/HK/SG/JP/KR/etc. cases there is no DST, so
 * the static value is always exact.
 * ----------------------------------------------------------------------------
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Static IANA timezone -> UTC offset (minutes). Plain constants, no Intl
 * dependency, so they are reliable on every device.
 *
 * - Fixed-offset (no-DST) zones are EXACT: Asia/Shanghai = 480, etc.
 * - DST zones store their standard (winter) offset; the verified-Intl path in
 *   resolveOffsetMinutes corrects summer shifts where Intl is available.
 *
 * Real-device WeChat runtimes often lack a full ICU timezone database, so the
 * `timeZone` option of `Intl.DateTimeFormat` is unreliable. This table is the
 * fallback when the Intl attempt fails verification (see the file header).
 */
const KNOWN_TZ_OFFSETS: Record<string, number> = {
  'UTC': 0,
  'GMT': 0,
  'Asia/Shanghai': 480,
  'Asia/Hong_Kong': 480,
  'Asia/Macau': 480,
  'Asia/Taipei': 480,
  'Asia/Singapore': 480,
  'Asia/Kuala_Lumpur': 480,
  'Asia/Kolkata': 330,
  'Asia/Dubai': 240,
  'Asia/Bangkok': 420,
  'Asia/Jakarta': 420,
  'Asia/Tokyo': 540,
  'Asia/Seoul': 540,
  'Australia/Perth': 480,
  'Australia/Sydney': 600,
  'Pacific/Auckland': 720,
  'Europe/London': 0,
  'Europe/Paris': 60,
  'Europe/Berlin': 60,
  'Europe/Moscow': 180,
  'America/New_York': -300,
  'America/Chicago': -360,
  'America/Denver': -420,
  'America/Los_Angeles': -480,
};

/**
 * Best-effort offset resolution via Intl, VERIFIED before being trusted (see
 * the file header). Returns null when Intl is unavailable, the timezone is
 * unsupported, or the runtime silently ignored the `timeZone` option (detected
 * via `resolvedOptions().timeZone`), so callers can fall back to the static
 * table / device offset instead of throwing or using wrong data. Wrapped in
 * try/catch because real-device runtimes may throw on an unknown `timeZone`.
 */
function tryIntlOffset(instant: Date, timeZone: string): number | null {
  if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    // A runtime lacking ICU may silently ignore `timeZone` and format in the
    // device zone; resolvedOptions exposes the zone it actually applied.
    const resolved = formatter.resolvedOptions().timeZone;
    if (!resolved || resolved.toLowerCase() !== timeZone.toLowerCase()) {
      return null;
    }
    const parts = formatter.formatToParts(instant);
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
  } catch {
    return null;
  }
}

/**
 * Resolve the UTC offset (minutes) for a timezone at a given instant.
 *
 * Order of preference (see the file header for the full rationale):
 *   1. Verified Intl       -> exact (incl. DST) wherever Intl truly honours
 *                             the requested zone; discarded otherwise.
 *   2. Static table        -> exact for no-DST zones, winter offset for DST
 *                             zones; no Intl dependency, reliable everywhere.
 *   3. Device local offset -> never throws; guarantees a usable result so we
 *                             never fail a page just because a timezone name
 *                             was not recognized on a real device.
 */
function resolveOffsetMinutes(timeZone: string, instant: Date): number {
  const viaIntl = tryIntlOffset(instant, timeZone);
  if (viaIntl !== null) return viaIntl;
  if (timeZone in KNOWN_TZ_OFFSETS) return KNOWN_TZ_OFFSETS[timeZone];
  // Last resort: use the device's own local offset. Never throws.
  return -new Date().getTimezoneOffset();
}

function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  if (timeZone in KNOWN_TZ_OFFSETS) return true;
  return tryIntlOffset(new Date(0), timeZone) !== null;
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

/**
 * Convert a UTC instant into wall-clock date/time for a timezone.
 *
 * The timezone is a plain IANA string (e.g. "Asia/Shanghai") from Core. The
 * offset is obtained via resolveOffsetMinutes, which uses the static table
 * first and only touches Intl as a fallback -- so this works on real devices
 * without relying on a complete ICU timezone database.
 */
export function formatInstantInTimeZone(
  instant: string,
  timeZone: string,
): ZonedDateTimeParts {
  const value = new Date(instant);
  if (Number.isNaN(value.getTime())) {
    throw new Error(`Invalid UTC instant: ${instant}`);
  }
  const offset = resolveOffsetMinutes(timeZone, value);
  const wall = new Date(value.getTime() + offset * 60_000);
  return {
    date: `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    time: `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`,
  };
}

function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  return resolveOffsetMinutes(timeZone, instant);
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
