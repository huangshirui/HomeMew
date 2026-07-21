import type { Context, Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireActiveUser, requireFamilyMember, requireRelatedMembers } from "./family-access";
import { success } from "./http";
import { createId } from "./ids";
import { decodeCursor, encodeCursor, parseLimit } from "./pagination";
import { exactDate, offsetDateTime, optionalText, requireObject, requireString, stringIds, timezone } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;
type EventRow = Record<string, any>;

async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try { return requireObject(await c.req.json()); } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new ApiError("INVALID_REQUEST", `${field} must be a positive integer`, 400);
  return value as number;
}

function eventTime(input: Record<string, unknown>, previous?: EventRow) {
  const isAllDay = input.isAllDay === undefined ? Boolean(previous?.is_all_day) : input.isAllDay;
  if (typeof isAllDay !== "boolean") throw new ApiError("INVALID_REQUEST", "isAllDay must be boolean", 400);
  if (input.isAllDay !== undefined && previous && input.isAllDay !== Boolean(previous.is_all_day) && (input.start === undefined || input.end === undefined)) {
    throw new ApiError("INVALID_REQUEST", "start and end are required when changing isAllDay", 400);
  }
  const start = input.start ?? (isAllDay ? previous?.start_date : previous?.start_at);
  const end = input.end ?? (isAllDay ? previous?.end_date : previous?.end_at);
  if (isAllDay) {
    const startDate = exactDate(start, "start"), endDate = exactDate(end, "end");
    if (endDate <= startDate) throw new ApiError("INVALID_EVENT_DATE", "event end must be later than start", 400);
    return { isAllDay: 1, startAt: null, endAt: null, startDate, endDate };
  }
  const startAt = offsetDateTime(start, "start"), endAt = offsetDateTime(end, "end");
  if (endAt <= startAt) throw new ApiError("INVALID_EVENT_TIME", "event end must be later than start", 400);
  return { isAllDay: 0, startAt, endAt, startDate: null, endDate: null };
}

function formatInZone(value: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const raw = get("timeZoneName").replace("GMT", "");
  const offset = raw === "" ? "+00:00" : raw;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function mapEvent(env: Bindings, row: EventRow): Promise<Record<string, unknown>> {
  const attendees = await env.DB.prepare(`SELECT u.id user_id, u.display_name, u.avatar_url FROM event_attendees ea JOIN family_members fm ON fm.family_id = ? AND fm.user_id = ea.user_id AND fm.status = 'active' JOIN users u ON u.id = ea.user_id WHERE ea.event_id = ? ORDER BY ea.created_at, u.id`).bind(row.family_id, row.id).all<any>();
  const people = await env.DB.prepare("SELECT id, display_name FROM users WHERE id IN (?, ?)").bind(row.created_by, row.updated_by).all<any>();
  const person = (id: string) => { const found = people.results.find((item) => item.id === id); return { userId: id, displayName: found?.display_name ?? "" }; };
  return {
    id: row.id, familyId: row.family_id, summary: row.summary, description: row.description,
    start: row.is_all_day ? row.start_date : formatInZone(row.start_at, row.timezone),
    end: row.is_all_day ? row.end_date : formatInZone(row.end_at, row.timezone),
    isAllDay: Boolean(row.is_all_day), timezone: row.timezone, location: row.location, status: row.status,
    attendees: attendees.results.map((item) => ({ userId: item.user_id, displayName: item.display_name, avatarUrl: item.avatar_url })),
    createdBy: person(row.created_by), updatedBy: person(row.updated_by), version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function findEvent(env: Bindings, familyId: string, eventId: string): Promise<EventRow> {
  const row = await env.DB.prepare("SELECT * FROM events WHERE id = ? AND family_id = ? AND deleted_at IS NULL").bind(eventId, familyId).first<EventRow>();
  if (!row) throw new ApiError("EVENT_NOT_FOUND", "Event not found", 404);
  return row;
}

export function registerEventRoutes(app: App): void {
  app.post("/api/v1/families/:familyId/events", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    const input = await jsonBody(c), summary = requireString(input.summary, "summary", 100);
    const description = optionalText(input.description, "description", 5000) ?? null;
    const location = optionalText(input.location, "location", 500) ?? null;
    const zone = timezone(input.timezone), time = eventTime(input);
    const attendeeIds = input.attendeeIds === undefined ? [] : stringIds(input.attendeeIds, "attendeeIds");
    await requireRelatedMembers(c.env, familyId, attendeeIds, "attendee");
    const id = createId("evt");
    const statements = [c.env.DB.prepare(`INSERT INTO events (id, family_id, summary, description, start_at, end_at, start_date, end_date, is_all_day, timezone, location, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, familyId, summary, description, time.startAt, time.endAt, time.startDate, time.endDate, time.isAllDay, zone, location, userId, userId), ...attendeeIds.map((attendeeId) => c.env.DB.prepare("INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)").bind(id, attendeeId))];
    await c.env.DB.batch(statements);
    return c.json(success(await mapEvent(c.env, await findEvent(c.env, familyId, id))), 201);
  });

  app.get("/api/v1/families/:familyId/events/:eventId", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    return c.json(success(await mapEvent(c.env, await findEvent(c.env, familyId, c.req.param("eventId")))));
  });

  app.patch("/api/v1/families/:familyId/events/:eventId", async (c) => {
    const familyId = c.req.param("familyId"), eventId = c.req.param("eventId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    const previous = await findEvent(c.env, familyId, eventId), input = await jsonBody(c), expected = integer(input.version, "version");
    const summary = input.summary === undefined ? previous.summary : requireString(input.summary, "summary", 100);
    const description = input.description === undefined ? previous.description : optionalText(input.description, "description", 5000) ?? null;
    const location = input.location === undefined ? previous.location : optionalText(input.location, "location", 500) ?? null;
    const zone = input.timezone === undefined ? previous.timezone : timezone(input.timezone);
    const time = eventTime(input, previous);
    const attendeeIds = input.attendeeIds === undefined ? undefined : stringIds(input.attendeeIds, "attendeeIds");
    if (attendeeIds) await requireRelatedMembers(c.env, familyId, attendeeIds, "attendee");
    const result = await c.env.DB.prepare(`UPDATE events SET summary=?, description=?, start_at=?, end_at=?, start_date=?, end_date=?, is_all_day=?, timezone=?, location=?, updated_by=?, updated_at=CURRENT_TIMESTAMP, version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?`).bind(summary, description, time.startAt, time.endAt, time.startDate, time.endDate, time.isAllDay, zone, location, userId, eventId, familyId, expected).run();
    if (!result.meta.changes) throw new ApiError("EVENT_VERSION_CONFLICT", "Event version conflict", 409);
    if (attendeeIds) await c.env.DB.batch([c.env.DB.prepare("DELETE FROM event_attendees WHERE event_id = ?").bind(eventId), ...attendeeIds.map((id) => c.env.DB.prepare("INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)").bind(eventId, id))]);
    return c.json(success(await mapEvent(c.env, await findEvent(c.env, familyId, eventId))));
  });

  app.delete("/api/v1/families/:familyId/events/:eventId", async (c) => {
    const familyId = c.req.param("familyId"), eventId = c.req.param("eventId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId); await findEvent(c.env, familyId, eventId);
    const version = integer(Number(c.req.query("version")), "version");
    const result = await c.env.DB.prepare("UPDATE events SET deleted_at=CURRENT_TIMESTAMP, deleted_by=?, updated_by=?, updated_at=CURRENT_TIMESTAMP, version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?").bind(userId, userId, eventId, familyId, version).run();
    if (!result.meta.changes) throw new ApiError("EVENT_VERSION_CONFLICT", "Event version conflict", 409);
    return c.body(null, 204);
  });

  app.get("/api/v1/families/:familyId/events", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    const startQuery = c.req.query("start"), endQuery = c.req.query("end");
    if ((startQuery === undefined) !== (endQuery === undefined)) throw new ApiError("INVALID_REQUEST", "start and end must be supplied together", 400);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const start = startQuery ? exactDate(startQuery, "start") : shiftDate(today, -7);
    const end = endQuery ? exactDate(endQuery, "end") : shiftDate(today, 30);
    if (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > 366 * 86400000 || end <= start) throw new ApiError("INVALID_REQUEST", "event range must be positive and at most 366 days", 400);
    const limit = parseLimit(c.req.query("limit")), sort = "start_asc";
    const status = c.req.query("status") ?? "active";
    if (status !== "active" && status !== "cancelled") throw new ApiError("INVALID_REQUEST", "status must be active or cancelled", 400);
    const cursor = c.req.query("cursor") ? decodeCursor(c.req.query("cursor")!, "events", sort) : undefined;
    let attendee = c.req.query("attendeeId");
    if (attendee === "me") attendee = userId;
    if (attendee) await requireRelatedMembers(c.env, familyId, [attendee], "attendee");
    const args: unknown[] = [familyId, status, new Date(`${end}T00:00:00+08:00`).toISOString(), new Date(`${start}T00:00:00+08:00`).toISOString(), end, start];
    let sql = `SELECT e.*, COALESCE(e.start_at, e.start_date) sort_key FROM events e WHERE e.family_id=? AND e.deleted_at IS NULL AND e.status=? AND ((e.is_all_day=0 AND e.start_at < ? AND e.end_at > ?) OR (e.is_all_day=1 AND e.start_date < ? AND e.end_date > ?))`;
    if (attendee) { sql += " AND EXISTS (SELECT 1 FROM event_attendees ea WHERE ea.event_id=e.id AND ea.user_id=?)"; args.push(attendee); }
    if (cursor) { sql += " AND (COALESCE(e.start_at,e.start_date) > ? OR (COALESCE(e.start_at,e.start_date)=? AND e.id>?))"; args.push(cursor.key, cursor.key, cursor.id); }
    sql += " ORDER BY sort_key ASC, e.id ASC LIMIT ?"; args.push(limit + 1);
    const rows = await c.env.DB.prepare(sql).bind(...args).all<EventRow>();
    const page = rows.results.slice(0, limit), items = await Promise.all(page.map((row) => mapEvent(c.env, row)));
    const last = page.at(-1);
    const nextCursor = rows.results.length > limit && last ? encodeCursor({ v: 1, resource: "events", sort, key: last.sort_key, id: last.id }) : null;
    return c.json(success({ items, nextCursor }));
  });
}
