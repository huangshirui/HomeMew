import { ApiError } from "./errors";

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("INVALID_REQUEST", "Request body must be a JSON object", 400);
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, field: string, max = 80): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    throw new ApiError("INVALID_REQUEST", `${field} must be a non-empty string`, 400);
  }
  return value.trim();
}

export function optionalUrl(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") {
    throw new ApiError("INVALID_REQUEST", `${field} must be an HTTP URL or null`, 400);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return value;
  } catch {
    throw new ApiError("INVALID_REQUEST", `${field} must be an HTTP URL or null`, 400);
  }
}

export function positiveInteger(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new ApiError("INVALID_REQUEST", `${field} must be an integer between 1 and ${max}`, 400);
  }
  return value as number;
}

export function optionalText(value: unknown, field: string, max: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > max) throw new ApiError("INVALID_REQUEST", `${field} must be a string up to ${max} characters or null`, 400);
  return value.trim() || null;
}

export function exactDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError("INVALID_REQUEST", `${field} must be YYYY-MM-DD`, 400);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new ApiError("INVALID_REQUEST", `${field} must be a valid date`, 400);
  return value;
}

export function offsetDateTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) throw new ApiError("INVALID_REQUEST", `${field} must be a date-time with timezone offset`, 400);
  return new Date(value).toISOString();
}

export function timezone(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new ApiError("INVALID_TIMEZONE", "timezone must be a valid IANA timezone", 400);
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); } catch { throw new ApiError("INVALID_TIMEZONE", "timezone must be a valid IANA timezone", 400); }
  return value;
}

export function stringIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) throw new ApiError("INVALID_REQUEST", `${field} must be an array of user IDs`, 400);
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw new ApiError(field === "attendeeIds" ? "DUPLICATE_ATTENDEE" : "DUPLICATE_ASSIGNEE", `${field} must not contain duplicates`, 400);
  return ids;
}
