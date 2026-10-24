// HomeMew's stable event-facing Location boundary. LifeSpace owns the authoritative
// Location schema. This module only adapts the legacy string DTO during a
// coordinated, explicit upstream model cutover (never guesses which schema is live).
const SAFE_KEYS = new Set(['name', 'address', 'coordinates']);

export function eventLocationWireFormat(env) {
  const format = env?.LIFESPACE_EVENT_LOCATION_FORMAT ?? 'string';
  if (format !== 'string' && format !== 'location') {
    throw new Error('LIFESPACE_EVENT_LOCATION_FORMAT must be string or location');
  }
  return format;
}

export function eventLocationName(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.name !== 'string') {
    throw new Error('LifeSpace Event Location has an invalid shape');
  }
  const name = value.name.trim();
  if (!name) throw new Error('LifeSpace Event Location requires a name');
  return name;
}

export function eventLocationToLifeSpace(value, env) {
  const format = eventLocationWireFormat(env);
  if (value === null) return null;
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? (format === 'location' ? { name } : name) : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !SAFE_KEYS.has(key))
    || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 500) {
    throw new Error('Location must be a name or a canonical Location object');
  }
  const normalized = { name: value.name.trim() };
  if (value.address !== undefined) {
    if (typeof value.address !== 'string' || !value.address.trim() || value.address.trim().length > 1000) {
      throw new Error('Location address must be a non-empty string');
    }
    normalized.address = value.address.trim();
  }
  if (value.coordinates !== undefined) {
    const coords = value.coordinates;
    if (!coords || typeof coords !== 'object' || Array.isArray(coords)
      || Object.keys(coords).length !== 2
      || !Object.hasOwn(coords, 'latitude') || !Object.hasOwn(coords, 'longitude')
      || typeof coords.latitude !== 'number' || !Number.isFinite(coords.latitude)
      || typeof coords.longitude !== 'number' || !Number.isFinite(coords.longitude)
      || coords.latitude < -90 || coords.latitude > 90
      || coords.longitude < -180 || coords.longitude > 180) {
      throw new Error('Location coordinates must be a complete WGS84 point');
    }
    normalized.coordinates = { latitude: coords.latitude, longitude: coords.longitude };
  }
  if (format === 'location') return normalized;
  // No lossy conversion of rich coordinates on a legacy string-only model.
  if (normalized.address !== undefined || normalized.coordinates !== undefined) {
    throw new Error('Rich Location requires a structured LifeSpace Event model');
  }
  return normalized.name;
}

// Used only for explicit Event CRUD writes; other generic Core operations are
// deliberately untouched to preserve LifeSpace's platform contract.
export function adaptEventWritePayload(payload, env) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Event payload must be an object');
  }
  if (!Object.hasOwn(payload, 'location')) return payload;
  return { ...payload, location: eventLocationToLifeSpace(payload.location, env) };
}
