import type { EventFormDraft } from '../types/index';
import { addDaysToDateOnly, formatInstantInTimeZone } from '../utils/datetime';

type LifeSpaceEventDraft = {
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  isAllDay?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  startTimezone?: unknown;
  endTimezone?: unknown;
  startDate?: unknown;
  endDateExclusive?: unknown;
  attendeeIds?: unknown;
};

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

function object(value: unknown): LifeSpaceEventDraft {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LifeSpaceEventDraft
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function localInstant(value: unknown, timezone: string): { date: string; time: string } | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return formatInstantInTimeZone(value, timezone);
  } catch {
    return null;
  }
}

function defaultEndFromStart(
  startAt: unknown,
  timezone: string,
): { date: string; time: string } | null {
  if (typeof startAt !== 'string' || !startAt) return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  return localInstant(
    new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS).toISOString(),
    timezone,
  );
}

/**
 * Convert the LifeSpace event model draft into HomeMew's form-friendly draft.
 *
 * LifeSpace exposes timed events as UTC `startAt` / nullable `endAt`. HomeMew's
 * form edits wall-clock date/time fields, so the service boundary performs the
 * conversion in the same viewing timezone used for interpretation.
 *
 * If LifeSpace does not supply `endAt`, HomeMew applies its product default of
 * a 60-minute duration. An explicit LifeSpace `endAt` always wins. The default
 * is calculated from the start instant, so date rollover (for example 23:30 ->
 * 00:30 the next day) is preserved correctly before converting to wall time.
 */
export function adaptLifeSpaceEventDraft(
  input: unknown,
  viewingTimezone: string,
): EventFormDraft {
  const draft = object(input);
  const isAllDay = typeof draft.isAllDay === 'boolean' ? draft.isAllDay : null;
  const summary = nullableString(draft.summary);
  const description = nullableString(draft.description);
  const location = nullableString(draft.location);
  const startTimezone = nullableString(draft.startTimezone);
  const endTimezone = nullableString(draft.endTimezone);
  const attendeeIds = stringArray(draft.attendeeIds);

  if (isAllDay === true) {
    const startDate = nullableString(draft.startDate);
    const endDateExclusive = nullableString(draft.endDateExclusive);
    return {
      summary,
      description,
      isAllDay: true,
      startDate,
      endDate: endDateExclusive ? addDaysToDateOnly(endDateExclusive, -1) : startDate,
      endDateExclusive,
      startTime: null,
      endTime: null,
      startTimezone: null,
      endTimezone: null,
      location,
      attendeeIds,
    };
  }

  if (isAllDay === false) {
    const startZone = startTimezone ?? viewingTimezone;
    const endZone = endTimezone ?? startZone;
    const start = localInstant(draft.startAt, startZone);
    const explicitEndAt = nullableString(draft.endAt);
    const end = explicitEndAt
      ? localInstant(explicitEndAt, endZone)
      : defaultEndFromStart(draft.startAt, endZone);
    return {
      summary,
      description,
      isAllDay: false,
      startDate: start?.date ?? '',
      endDate: end?.date ?? start?.date ?? '',
      endDateExclusive: null,
      startTime: start?.time ?? '',
      endTime: end?.time ?? '',
      startTimezone,
      endTimezone,
      location,
      attendeeIds,
    };
  }

  return {
    summary,
    description,
    isAllDay: null,
    startDate: nullableString(draft.startDate),
    endDate: null,
    endDateExclusive: nullableString(draft.endDateExclusive),
    startTime: null,
    endTime: null,
    startTimezone,
    endTimezone,
    location,
    attendeeIds,
  };
}
