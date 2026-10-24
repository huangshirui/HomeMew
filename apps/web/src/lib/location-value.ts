/** Canonical LifeSpace Location in browser-facing Event resources. */
export type LocationValue = {
  name: string;
  address?: string;
  coordinates?: { latitude: number; longitude: number };
};
export type EventLocation = string | LocationValue | null;

export function eventLocationLabel(location: EventLocation): string {
  if (typeof location === 'string') return location;
  return location?.name ?? '';
}

/**
 * Preserve explicit WGS84 coordinates while the user edits unrelated Event
 * fields; never silently carry a previous point onto a renamed place.
 */
export function eventLocationDraftValue(name: string, previous?: EventLocation): EventLocation {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (previous && typeof previous === 'object' && previous.name === trimmed) return previous;
  return trimmed;
}
