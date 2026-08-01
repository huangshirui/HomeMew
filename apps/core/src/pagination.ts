import { ApiError } from "./errors";

export type CursorResource = "events" | "tasks" | "day-records" | "day-record-occurrences";
export type CursorPayload = { v: 2; resource: CursorResource; sort: string; key: string | null; id: string; filter?: string };

export function parseLimit(value: string | undefined): number {
  if (value === undefined) return 100;
  if (!/^\d+$/.test(value)) throw new ApiError("INVALID_REQUEST", "limit must be an integer between 1 and 100", 400);
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw new ApiError("INVALID_REQUEST", "limit must be an integer between 1 and 100", 400);
  return limit;
}

export function encodeCursor(value: CursorPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor(value: string, resource: CursorResource, sort: string): CursorPayload {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))) as Partial<CursorPayload>;
    if (decoded.v !== 2 || decoded.resource !== resource || decoded.sort !== sort || typeof decoded.id !== "string" || !(typeof decoded.key === "string" || decoded.key === null)) throw new Error();
    return decoded as CursorPayload;
  } catch {
    throw new ApiError("INVALID_REQUEST", "cursor is invalid for this query", 400);
  }
}
