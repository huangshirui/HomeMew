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

/**
 * Convert the LifeSpace event model draft into HomeMew's form-friendly draft.
 *
 * LifeSpace exposes timed events as UTC `startAt` / nullable `endAt`. HomeMew's
 * form edits wall-clock date/time fields, so the service boundary performs the
 * conversion in the same viewing timezone used for interpretation.
 *
 * An absent `endAt` stays unknown: the adapter carries the start date forward
 * for form validation but leaves `endTime` null. The page must ask the user for
 * an end time before creating the event instead of inventing a duration.
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
    const end = localInstant(draft.endAt, endZone);
    return {
      summary,
      description,
      isAllDay: false,
      startDate: start?.date ?? null,
      endDate: end?.date ?? start?.date ?? null,
      endDateExclusive: null,
      startTime: start?.time ?? null,
      endTime: end?.time ?? null,
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
