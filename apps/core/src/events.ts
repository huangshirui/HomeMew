import type { Context, Hono } from "hono";
import { avatarUrl } from "./avatar";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireRelatedMembers } from "./family-access";
import { success } from "./http";
import { createId } from "./ids";
import { decodeCursor, encodeCursor, parseLimit } from "./pagination";
import { mapActor, requireFamilyCapability } from "./principal-access";
import { nowUtc, zonedMidnightUtc } from "./time";
import {
  exactDate,
  optionalText,
  requireObject,
  requireString,
  stringIds,
  timezone,
  utcDateTime,
} from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;
type EventRow = Record<string, any>;

const COMMON_FIELDS = [
  "summary",
  "description",
  "isAllDay",
  "attendeeIds",
  "location",
] as const;
const TIMED_FIELDS = ["startAt", "endAt", "startTimezone", "endTimezone"] as const;
const ALL_DAY_FIELDS = ["startDate", "endDateExclusive"] as const;

async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    return requireObject(await c.req.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ApiError("INVALID_REQUEST", `${field} must be a positive integer`, 400);
  }
  return value as number;
}

function allowedFields(input: Record<string, unknown>, update: boolean): void {
  const allowed = new Set<string>([
    ...COMMON_FIELDS,
    ...TIMED_FIELDS,
    ...ALL_DAY_FIELDS,
    ...(update ? ["version"] : []),
  ]);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw new ApiError("INVALID_REQUEST", "Request contains unsupported event fields", 400);
  }
}

function optionalTimezone(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  try {
    return timezone(value);
  } catch {
    throw new ApiError("INVALID_REQUEST", `${field} must be a valid IANA timezone or null`, 400);
  }
}

function eventTime(input: Record<string, unknown>, previous?: EventRow) {
  if (!previous && typeof input.isAllDay !== "boolean") {
    throw new ApiError("INVALID_REQUEST", "isAllDay must be boolean", 400);
  }
  const isAllDay =
    input.isAllDay === undefined ? Boolean(previous?.is_all_day) : input.isAllDay;
  if (typeof isAllDay !== "boolean") {
    throw new ApiError("INVALID_REQUEST", "isAllDay must be boolean", 400);
  }
  const switching = Boolean(previous) && isAllDay !== Boolean(previous?.is_all_day);

  if (isAllDay) {
    if (TIMED_FIELDS.some((field) => input[field] !== undefined)) {
      throw new ApiError("INVALID_REQUEST", "All-day events cannot contain timed event fields", 400);
    }
    if (switching && (input.startDate === undefined || input.endDateExclusive === undefined)) {
      throw new ApiError("INVALID_REQUEST", "startDate and endDateExclusive are required when changing event type", 400);
    }
    const startDate = exactDate(
      input.startDate ?? previous?.start_date,
      "startDate",
    );
    const endDate = exactDate(
      input.endDateExclusive ?? previous?.end_date,
      "endDateExclusive",
    );
    if (endDate <= startDate) {
      throw new ApiError("INVALID_REQUEST", "endDateExclusive must be later than startDate", 400);
    }
    return {
      isAllDay: 1,
      startAt: null,
      endAt: null,
      startDate,
      endDate,
    };
  }

  if (ALL_DAY_FIELDS.some((field) => input[field] !== undefined)) {
    throw new ApiError("INVALID_REQUEST", "Timed events cannot contain all-day event fields", 400);
  }
  if (switching && (input.startAt === undefined || input.endAt === undefined)) {
    throw new ApiError("INVALID_REQUEST", "startAt and endAt are required when changing event type", 400);
  }
  const startAt = utcDateTime(input.startAt ?? previous?.start_at, "startAt");
  const endAt = utcDateTime(input.endAt ?? previous?.end_at, "endAt");
  if (endAt <= startAt) {
    throw new ApiError("INVALID_REQUEST", "endAt must be later than startAt", 400);
  }
  return {
    isAllDay: 0,
    startAt,
    endAt,
    startDate: null,
    endDate: null,
  };
}

async function familyTimezone(env: Bindings, familyId: string): Promise<string> {
  const family = await env.DB.prepare(
    "SELECT timezone FROM families WHERE id=?",
  ).bind(familyId).first<{ timezone: string }>();
  return family?.timezone ?? "Asia/Shanghai";
}

async function mapEvent(env: Bindings, row: EventRow): Promise<Record<string, unknown>> {
  const attendees = await env.DB.prepare(
    `SELECT u.id user_id, u.display_name, u.avatar_key
     FROM event_attendees ea
     JOIN family_members fm ON fm.family_id=? AND fm.user_id=ea.user_id AND fm.status='active'
     JOIN users u ON u.id=ea.user_id
     WHERE ea.event_id=?
     ORDER BY ea.created_at,u.id`,
  ).bind(row.family_id, row.id).all<any>();
  const common = {
    id: row.id,
    familyId: row.family_id,
    summary: row.summary,
    description: row.description,
    isAllDay: Boolean(row.is_all_day),
    location: row.location,
    status: row.status,
    attendees: attendees.results.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
      avatarUrl: avatarUrl(env, item.avatar_key),
    })),
    createdBy: await mapActor(env, row.created_by_type, row.created_by_id),
    updatedBy: await mapActor(env, row.updated_by_type, row.updated_by_id),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return row.is_all_day
    ? {
        ...common,
        startDate: row.start_date,
        endDateExclusive: row.end_date,
      }
    : {
        ...common,
        startAt: row.start_at,
        endAt: row.end_at,
        startTimezone: row.start_timezone,
        endTimezone: row.end_timezone,
      };
}

async function findEvent(env: Bindings, familyId: string, eventId: string): Promise<EventRow> {
  const row = await env.DB.prepare(
    "SELECT * FROM events WHERE id=? AND family_id=? AND deleted_at IS NULL",
  ).bind(eventId, familyId).first<EventRow>();
  if (!row) throw new ApiError("EVENT_NOT_FOUND", "Event not found", 404);
  return row;
}

export function registerEventRoutes(app: App): void {
  app.post("/api/v1/families/:familyId/events", async (c) => {
    const familyId = c.req.param("familyId");
    const principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "events:write");
    const input = await jsonBody(c);
    allowedFields(input, false);
    const summary = requireString(input.summary, "summary", 100);
    const description = optionalText(input.description, "description", 5000) ?? null;
    const location = optionalText(input.location, "location", 500) ?? null;
    const time = eventTime(input);
    const defaultTimezone = await familyTimezone(c.env, familyId);
    const startTimezone = time.isAllDay
      ? null
      : input.startTimezone === undefined
        ? defaultTimezone
        : optionalTimezone(input.startTimezone, "startTimezone");
    const endTimezone = time.isAllDay
      ? null
      : input.endTimezone === undefined
        ? defaultTimezone
        : optionalTimezone(input.endTimezone, "endTimezone");
    const attendeeIds =
      input.attendeeIds === undefined ? [] : stringIds(input.attendeeIds, "attendeeIds");
    await requireRelatedMembers(c.env, familyId, attendeeIds, "attendee");
    const id = createId("evt");
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO events
         (id,family_id,summary,description,start_at,end_at,start_date,end_date,
          is_all_day,start_timezone,end_timezone,location,created_by_type,created_by_id,
          updated_by_type,updated_by_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        id,
        familyId,
        summary,
        description,
        time.startAt,
        time.endAt,
        time.startDate,
        time.endDate,
        time.isAllDay,
        startTimezone,
        endTimezone,
        location,
        principal.type,
        principal.id,
        principal.type,
        principal.id,
      ),
      ...attendeeIds.map((attendeeId) =>
        c.env.DB.prepare(
          "INSERT INTO event_attendees (event_id,user_id) VALUES (?,?)",
        ).bind(id, attendeeId),
      ),
    ];
    await c.env.DB.batch(statements);
    return c.json(success(await mapEvent(c.env, await findEvent(c.env, familyId, id))), 201);
  });

  app.get("/api/v1/families/:familyId/events/:eventId", async (c) => {
    const familyId = c.req.param("familyId");
    await requireFamilyCapability(c.env, c.get("currentPrincipal"), familyId, "events:read");
    return c.json(
      success(await mapEvent(c.env, await findEvent(c.env, familyId, c.req.param("eventId")))),
    );
  });

  app.patch("/api/v1/families/:familyId/events/:eventId", async (c) => {
    const familyId = c.req.param("familyId");
    const eventId = c.req.param("eventId");
    const principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "events:write");
    const previous = await findEvent(c.env, familyId, eventId);
    const input = await jsonBody(c);
    allowedFields(input, true);
    if (Object.keys(input).length < 2) {
      throw new ApiError("INVALID_REQUEST", "At least one event change is required", 400);
    }
    const expected = integer(input.version, "version");
    const summary =
      input.summary === undefined
        ? previous.summary
        : requireString(input.summary, "summary", 100);
    const description =
      input.description === undefined
        ? previous.description
        : optionalText(input.description, "description", 5000) ?? null;
    const location =
      input.location === undefined
        ? previous.location
        : optionalText(input.location, "location", 500) ?? null;
    const time = eventTime(input, previous);
    const defaultTimezone = await familyTimezone(c.env, familyId);
    const switchedToTimed = !time.isAllDay && Boolean(previous.is_all_day);
    const startTimezone = time.isAllDay
      ? null
      : input.startTimezone === undefined
        ? switchedToTimed
          ? defaultTimezone
          : previous.start_timezone
        : optionalTimezone(input.startTimezone, "startTimezone");
    const endTimezone = time.isAllDay
      ? null
      : input.endTimezone === undefined
        ? switchedToTimed
          ? defaultTimezone
          : previous.end_timezone
        : optionalTimezone(input.endTimezone, "endTimezone");
    const attendeeIds =
      input.attendeeIds === undefined
        ? undefined
        : stringIds(input.attendeeIds, "attendeeIds");
    if (attendeeIds) {
      await requireRelatedMembers(c.env, familyId, attendeeIds, "attendee");
    }
    const mutationToken = crypto.randomUUID();
    const updatedAt = nowUtc();
    const update = c.env.DB.prepare(
      `UPDATE events SET
       summary=?,description=?,start_at=?,end_at=?,start_date=?,end_date=?,is_all_day=?,
       start_timezone=?,end_timezone=?,location=?,updated_by_type=?,updated_by_id=?,
       updated_at=?,version=version+1,mutation_token=?
       WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?`,
    ).bind(
      summary,
      description,
      time.startAt,
      time.endAt,
      time.startDate,
      time.endDate,
      time.isAllDay,
      startTimezone,
      endTimezone,
      location,
      principal.type,
      principal.id,
      updatedAt,
      mutationToken,
      eventId,
      familyId,
      expected,
    );
    const statements = [update];
    if (attendeeIds) {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM event_attendees WHERE event_id=? AND EXISTS (SELECT 1 FROM events WHERE id=? AND mutation_token=?)",
        ).bind(eventId, eventId, mutationToken),
      );
      statements.push(
        ...attendeeIds.map((id) =>
          c.env.DB.prepare(
            "INSERT INTO event_attendees (event_id,user_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM events WHERE id=? AND mutation_token=?)",
          ).bind(eventId, id, eventId, mutationToken),
        ),
      );
    }
    statements.push(
      c.env.DB.prepare(
        "UPDATE events SET mutation_token=NULL WHERE id=? AND mutation_token=?",
      ).bind(eventId, mutationToken),
    );
    const results = await c.env.DB.batch(statements);
    if (!results[0].meta.changes) {
      throw new ApiError("EVENT_VERSION_CONFLICT", "Event version conflict", 409);
    }
    return c.json(success(await mapEvent(c.env, await findEvent(c.env, familyId, eventId))));
  });

  app.delete("/api/v1/families/:familyId/events/:eventId", async (c) => {
    const familyId = c.req.param("familyId");
    const eventId = c.req.param("eventId");
    const principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "events:write");
    await findEvent(c.env, familyId, eventId);
    const version = integer(Number(c.req.query("version")), "version");
    const now = nowUtc();
    const result = await c.env.DB.prepare(
      `UPDATE events SET deleted_at=?,deleted_by_type=?,deleted_by_id=?,
       updated_by_type=?,updated_by_id=?,updated_at=?,version=version+1
       WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?`,
    ).bind(
      now,
      principal.type,
      principal.id,
      principal.type,
      principal.id,
      now,
      eventId,
      familyId,
      version,
    ).run();
    if (!result.meta.changes) {
      throw new ApiError("EVENT_VERSION_CONFLICT", "Event version conflict", 409);
    }
    return c.body(null, 204);
  });

  app.get("/api/v1/families/:familyId/events", async (c) => {
    const familyId = c.req.param("familyId");
    const principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "events:read");
    if (c.req.query("start") !== undefined || c.req.query("end") !== undefined) {
      throw new ApiError("INVALID_REQUEST", "Use startDate and endDateExclusive", 400);
    }
    const startQuery = c.req.query("startDate");
    const endQuery = c.req.query("endDateExclusive");
    if (!startQuery || !endQuery) {
      throw new ApiError("INVALID_REQUEST", "startDate and endDateExclusive are required", 400);
    }
    const startDate = exactDate(startQuery, "startDate");
    const endDate = exactDate(endQuery, "endDateExclusive");
    if (
      endDate <= startDate ||
      Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`) >
        366 * 86_400_000
    ) {
      throw new ApiError("INVALID_REQUEST", "event range must be positive and at most 366 days", 400);
    }
    const viewingTimezone =
      c.req.query("timezone") === undefined
        ? await familyTimezone(c.env, familyId)
        : timezone(c.req.query("timezone"));
    const rangeStartAt = zonedMidnightUtc(startDate, viewingTimezone);
    const rangeEndAt = zonedMidnightUtc(endDate, viewingTimezone);
    const limit = parseLimit(c.req.query("limit"));
    const sort = "start_asc";
    const status = c.req.query("status") ?? "active";
    if (status !== "active" && status !== "cancelled") {
      throw new ApiError("INVALID_REQUEST", "status must be active or cancelled", 400);
    }
    const q =
      c.req.query("q") === undefined
        ? undefined
        : requireString(c.req.query("q"), "q", 100);
    const filter = JSON.stringify({
      startDate,
      endDate,
      viewingTimezone,
      status,
      attendeeId: c.req.query("attendeeId") ?? null,
      q: q ?? null,
    });
    const cursor = c.req.query("cursor")
      ? decodeCursor(c.req.query("cursor")!, "events", sort)
      : undefined;
    if (cursor && cursor.filter !== filter) {
      throw new ApiError("INVALID_REQUEST", "cursor is invalid for this query", 400);
    }
    let attendee = c.req.query("attendeeId");
    if (attendee === "me" && principal.type === "system") {
      throw new ApiError("INVALID_FILTER", "me is unavailable for system identities", 400);
    }
    if (attendee === "me") attendee = principal.id;
    if (attendee) {
      await requireRelatedMembers(c.env, familyId, [attendee], "attendee");
    }
    const args: unknown[] = [
      familyId,
      status,
      rangeEndAt,
      rangeStartAt,
      endDate,
      startDate,
    ];
    let sql =
      `SELECT e.*,COALESCE(e.start_at,e.start_date) sort_key
       FROM events e
       WHERE e.family_id=? AND e.deleted_at IS NULL AND e.status=?
       AND ((e.is_all_day=0 AND e.start_at<? AND e.end_at>?)
         OR (e.is_all_day=1 AND e.start_date<? AND e.end_date>?))`;
    if (attendee) {
      sql +=
        " AND EXISTS (SELECT 1 FROM event_attendees ea WHERE ea.event_id=e.id AND ea.user_id=?)";
      args.push(attendee);
    }
    if (q) {
      sql +=
        " AND (instr(lower(e.summary),lower(?))>0 OR instr(lower(COALESCE(e.description,'')),lower(?))>0 OR instr(lower(COALESCE(e.location,'')),lower(?))>0)";
      args.push(q, q, q);
    }
    if (cursor) {
      sql +=
        " AND (COALESCE(e.start_at,e.start_date)>? OR (COALESCE(e.start_at,e.start_date)=? AND e.id>?))";
      args.push(cursor.key, cursor.key, cursor.id);
    }
    sql += " ORDER BY sort_key ASC,e.id ASC LIMIT ?";
    args.push(limit + 1);
    const rows = await c.env.DB.prepare(sql).bind(...args).all<EventRow>();
    const page = rows.results.slice(0, limit);
    const items = await Promise.all(page.map((row) => mapEvent(c.env, row)));
    const last = page.at(-1);
    const nextCursor =
      rows.results.length > limit && last
        ? encodeCursor({
            v: 2,
            resource: "events",
            sort,
            key: last.sort_key,
            id: last.id,
            filter,
          })
        : null;
    return c.json(success({ items, nextCursor }));
  });
}
