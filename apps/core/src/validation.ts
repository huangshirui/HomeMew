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
