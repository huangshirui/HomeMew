import type { Context, Hono } from "hono";
import { avatarUrl } from "./avatar";
import { addDateDays, computeDayRecord, daysBetween, familyToday, type DayAttentionLevel, type DayRecordKind } from "./day-calculation";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { mapActor, requireFamilyCapability } from "./principal-access";
import { success } from "./http";
import { createId } from "./ids";
import { decodeCursor, encodeCursor, parseLimit } from "./pagination";
import { nowUtc } from "./time";
import { exactDate, optionalText, requireObject, requireString } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;

type DayRecordRow = {
  id: string; family_id: string; name: string; description: string | null; kind: DayRecordKind;
  anchor_date: string; cycle_days: number | null; next_due_date: string | null;
  attention_before_days: number | null; attention_after_days: number | null;
  subject_user_id: string | null; icon: string | null; status: "active" | "archived";
  created_by_type: string; created_by_id: string; updated_by_type: string; updated_by_id: string;
  version: number; created_at: string; updated_at: string; deleted_at: string | null;
};

type OccurrenceRow = {
  id: string; day_record_id: string; occurred_on: string; note: string | null; source: "initial" | "manual";
  recorded_by_type: string; recorded_by_id: string; created_at: string; interval_days: number | null;
};

async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try { return requireObject(await c.req.json()); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400); }
}

function version(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new ApiError("INVALID_REQUEST", "version must be a positive integer", 400);
  return value as number;
}

function dayDate(value: unknown, field: string): string {
  try { return exactDate(value, field); }
  catch { throw new ApiError("INVALID_DAY_RECORD_DATE", `${field} must be a valid YYYY-MM-DD date`, 400); }
}

function nullableInteger(value: unknown, field: string, minimum: number, maximum = 3650): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ApiError("INVALID_DAY_RECORD_RULE", `${field} must be null or an integer between ${minimum} and ${maximum}`, 400);
  }
  return value as number;
}

async function familyTimezone(env: Bindings, familyId: string): Promise<string> {
  const family = await env.DB.prepare("SELECT timezone FROM families WHERE id=?").bind(familyId).first<{ timezone: string }>();
  if (!family) throw new ApiError("FAMILY_NOT_FOUND", "Family not found", 404);
  return family.timezone;
}

async function requireSubject(env: Bindings, familyId: string, value: unknown): Promise<string | null> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value) throw new ApiError("INVALID_DAY_RECORD_RULE", "subjectUserId must be a user ID or null", 400);
  const member = await env.DB.prepare("SELECT 1 ok FROM family_members WHERE family_id=? AND user_id=? AND status='active'").bind(familyId, value).first();
  if (!member) throw new ApiError("SUBJECT_NOT_FAMILY_MEMBER", "subjectUserId must be an active family member", 400);
  return value;
}

async function findDayRecord(env: Bindings, familyId: string, id: string): Promise<DayRecordRow> {
  const row = await env.DB.prepare("SELECT * FROM day_records WHERE id=? AND family_id=? AND deleted_at IS NULL").bind(id, familyId).first<DayRecordRow>();
  if (!row) throw new ApiError("DAY_RECORD_NOT_FOUND", "Day record not found", 404);
  return row;
}

async function mapSubject(env: Bindings, userId: string | null) {
  if (!userId) return null;
  const user = await env.DB.prepare("SELECT id,display_name,avatar_key FROM users WHERE id=?").bind(userId).first<{ id: string; display_name: string; avatar_key: string | null }>();
  return user ? { userId: user.id, displayName: user.display_name, avatarUrl: avatarUrl(env, user.avatar_key) } : null;
}

async function mapDayRecord(env: Bindings, row: DayRecordRow, today: string): Promise<Record<string, unknown>> {
  const common = {
    id: row.id, familyId: row.family_id, name: row.name, description: row.description, kind: row.kind,
    subject: await mapSubject(env, row.subject_user_id), icon: row.icon, status: row.status,
    version: row.version, createdBy: await mapActor(env, row.created_by_type, row.created_by_id),
    updatedBy: await mapActor(env, row.updated_by_type, row.updated_by_id), createdAt: row.created_at, updatedAt: row.updated_at,
  };
  if (row.kind === "elapsed") return { ...common, anchorDate: row.anchor_date, attentionAfterDays: row.attention_after_days, computed: computeDayRecord({ kind: "elapsed", anchorDate: row.anchor_date, attentionAfterDays: row.attention_after_days }, today) };
  if (row.kind === "countdown") return { ...common, anchorDate: row.anchor_date, attentionBeforeDays: row.attention_before_days, computed: computeDayRecord({ kind: "countdown", anchorDate: row.anchor_date, attentionBeforeDays: row.attention_before_days }, today) };
  return { ...common, anchorDate: row.anchor_date, cycleDays: row.cycle_days, nextDueDate: row.next_due_date, attentionBeforeDays: row.attention_before_days, computed: computeDayRecord({ kind: "cycle", anchorDate: row.anchor_date, cycleDays: row.cycle_days!, nextDueDate: row.next_due_date!, attentionBeforeDays: row.attention_before_days }, today) };
}

async function mapOccurrence(env: Bindings, row: OccurrenceRow) {
  return {
    id: row.id, dayRecordId: row.day_record_id, occurredOn: row.occurred_on, note: row.note,
    source: row.source, intervalDays: row.interval_days,
    recordedBy: await mapActor(env, row.recorded_by_type, row.recorded_by_id), createdAt: row.created_at,
  };
}

function validateFields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some((field) => !allowed.includes(field))) throw new ApiError("INVALID_DAY_RECORD_RULE", "Request contains fields that are not valid for this day record kind", 400);
}

function parseKinds(value: string | undefined): DayRecordKind[] {
  const kinds = value?.split(",") ?? ["elapsed", "countdown", "cycle"];
  if (!kinds.length || new Set(kinds).size !== kinds.length || kinds.some((kind) => !["elapsed", "countdown", "cycle"].includes(kind))) throw new ApiError("INVALID_DAY_RECORD_KIND", "kind is invalid", 400);
  return kinds as DayRecordKind[];
}

function parseStatuses(value: string | undefined): Array<"active" | "archived"> {
  const statuses = value?.split(",") ?? ["active"];
  if (!statuses.length || new Set(statuses).size !== statuses.length || statuses.some((status) => !["active", "archived"].includes(status))) throw new ApiError("INVALID_DAY_RECORD_RULE", "status is invalid", 400);
  return statuses as Array<"active" | "archived">;
}

function effectiveDate(record: any): string { return record.kind === "cycle" ? record.nextDueDate : record.anchorDate; }
function sortKey(record: any, sort: string): string {
  if (sort === "attention") {
    const rank: Record<DayAttentionLevel, string> = { critical: "0", warning: "1", info: "2", none: "3" };
    const attentionDate = record.kind === "elapsed" && record.attentionAfterDays !== null ? addDateDays(record.anchorDate, record.attentionAfterDays) : effectiveDate(record);
    return `${rank[record.computed.attentionLevel as DayAttentionLevel]}|${attentionDate}`;
  }
  if (sort === "date_asc" || sort === "date_desc") return effectiveDate(record);
  if (sort === "created_desc") return record.createdAt;
  return record.updatedAt;
}

function compareTuple(aKey: string, aId: string, bKey: string, bId: string, descending: boolean): number {
  const key = aKey.localeCompare(bKey);
  const id = aId.localeCompare(bId);
  return descending ? -(key || id) : key || id;
}

export function registerDayRecordRoutes(app: App): void {
  app.post("/api/v1/families/:familyId/day-records", async (c) => {
    const familyId = c.req.param("familyId"), principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:write");
    const input = await jsonBody(c);
    if (typeof input.kind !== "string" || !["elapsed", "countdown", "cycle"].includes(input.kind)) throw new ApiError("INVALID_DAY_RECORD_KIND", "kind must be elapsed, countdown, or cycle", 400);
    const kind = input.kind as DayRecordKind;
    const commonFields = ["name", "description", "kind", "anchorDate", "subjectUserId", "icon"];
    validateFields(input, kind === "elapsed" ? [...commonFields, "attentionAfterDays"] : kind === "countdown" ? [...commonFields, "attentionBeforeDays"] : [...commonFields, "cycleDays", "attentionBeforeDays"]);
    const name = requireString(input.name, "name", 100), description = optionalText(input.description, "description", 5000) ?? null;
    const icon = optionalText(input.icon, "icon", 50) ?? null, anchorDate = dayDate(input.anchorDate, "anchorDate");
    const subjectUserId = await requireSubject(c.env, familyId, input.subjectUserId);
    const today = familyToday(await familyTimezone(c.env, familyId));
    if (kind !== "countdown" && anchorDate > today) throw new ApiError("INVALID_DAY_RECORD_DATE", "anchorDate cannot be later than the family current date", 400);
    let cycleDays: number | null = null, nextDueDate: string | null = null, attentionBeforeDays: number | null = null, attentionAfterDays: number | null = null;
    if (kind === "elapsed") attentionAfterDays = input.attentionAfterDays === undefined ? null : nullableInteger(input.attentionAfterDays, "attentionAfterDays", 1);
    if (kind === "countdown") attentionBeforeDays = input.attentionBeforeDays === undefined ? 30 : nullableInteger(input.attentionBeforeDays, "attentionBeforeDays", 0);
    if (kind === "cycle") {
      cycleDays = nullableInteger(input.cycleDays, "cycleDays", 1)!;
      if (cycleDays === null) throw new ApiError("INVALID_DAY_RECORD_RULE", "cycleDays is required", 400);
      nextDueDate = addDateDays(anchorDate, cycleDays);
      attentionBeforeDays = input.attentionBeforeDays === undefined ? 7 : nullableInteger(input.attentionBeforeDays, "attentionBeforeDays", 0);
    }
    const id = createId("day");
    const statements = [c.env.DB.prepare(`INSERT INTO day_records
      (id,family_id,name,description,kind,anchor_date,cycle_days,next_due_date,attention_before_days,attention_after_days,subject_user_id,icon,created_by_type,created_by_id,updated_by_type,updated_by_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, familyId, name, description, kind, anchorDate, cycleDays, nextDueDate, attentionBeforeDays, attentionAfterDays, subjectUserId, icon, principal.type, principal.id, principal.type, principal.id)];
    if (kind !== "countdown") statements.push(c.env.DB.prepare("INSERT INTO day_record_occurrences(id,day_record_id,occurred_on,source,recorded_by_type,recorded_by_id) VALUES(?,?,?,'initial',?,?)").bind(createId("dyo"), id, anchorDate, principal.type, principal.id));
    await c.env.DB.batch(statements);
    return c.json(success(await mapDayRecord(c.env, await findDayRecord(c.env, familyId, id), today)), 201);
  });

  app.get("/api/v1/families/:familyId/day-records/:dayRecordId", async (c) => {
    const familyId = c.req.param("familyId"), principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:read");
    return c.json(success(await mapDayRecord(c.env, await findDayRecord(c.env, familyId, c.req.param("dayRecordId")), familyToday(await familyTimezone(c.env, familyId)))));
  });

  app.patch("/api/v1/families/:familyId/day-records/:dayRecordId", async (c) => {
    const familyId = c.req.param("familyId")!, id = c.req.param("dayRecordId")!, principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:write");
    const previous = await findDayRecord(c.env, familyId, id);
    if (previous.status === "archived") throw new ApiError("DAY_RECORD_ARCHIVED", "Archived day records are read-only", 409);
    const input = await jsonBody(c), expected = version(input.version);
    const common = ["name", "description", "icon", "subjectUserId", "version"];
    validateFields(input, previous.kind === "elapsed" ? [...common, "attentionAfterDays"] : previous.kind === "countdown" ? [...common, "anchorDate", "attentionBeforeDays"] : [...common, "cycleDays", "attentionBeforeDays"]);
    if (Object.keys(input).length < 2) throw new ApiError("INVALID_REQUEST", "At least one day record change is required", 400);
    const name = input.name === undefined ? previous.name : requireString(input.name, "name", 100);
    const description = input.description === undefined ? previous.description : optionalText(input.description, "description", 5000) ?? null;
    const icon = input.icon === undefined ? previous.icon : optionalText(input.icon, "icon", 50) ?? null;
    const subjectUserId = input.subjectUserId === undefined ? previous.subject_user_id : await requireSubject(c.env, familyId, input.subjectUserId);
    const anchorDate = input.anchorDate === undefined ? previous.anchor_date : dayDate(input.anchorDate, "anchorDate");
    const cycleDays = input.cycleDays === undefined ? previous.cycle_days : nullableInteger(input.cycleDays, "cycleDays", 1);
    if (previous.kind === "cycle" && cycleDays === null) throw new ApiError("INVALID_DAY_RECORD_RULE", "cycleDays cannot be null", 400);
    const attentionBeforeDays = input.attentionBeforeDays === undefined ? previous.attention_before_days : nullableInteger(input.attentionBeforeDays, "attentionBeforeDays", 0);
    const attentionAfterDays = input.attentionAfterDays === undefined ? previous.attention_after_days : nullableInteger(input.attentionAfterDays, "attentionAfterDays", 1);
    const nextDueDate = previous.kind === "cycle" ? addDateDays(anchorDate, cycleDays!) : null;
    const now = nowUtc();
    const result = await c.env.DB.prepare(`UPDATE day_records SET name=?,description=?,icon=?,subject_user_id=?,anchor_date=?,cycle_days=?,next_due_date=?,attention_before_days=?,attention_after_days=?,updated_by_type=?,updated_by_id=?,updated_at=?,version=version+1
      WHERE id=? AND family_id=? AND deleted_at IS NULL AND status='active' AND version=?`).bind(name, description, icon, subjectUserId, anchorDate, cycleDays, nextDueDate, attentionBeforeDays, attentionAfterDays, principal.type, principal.id, now, id, familyId, expected).run();
    if (!result.meta.changes) throw new ApiError("DAY_RECORD_VERSION_CONFLICT", "Day record version conflict", 409);
    return c.json(success(await mapDayRecord(c.env, await findDayRecord(c.env, familyId, id), familyToday(await familyTimezone(c.env, familyId)))));
  });

  app.delete("/api/v1/families/:familyId/day-records/:dayRecordId", async (c) => {
    const familyId = c.req.param("familyId"), id = c.req.param("dayRecordId"), principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:write"); await findDayRecord(c.env, familyId, id);
    const expected = version(Number(c.req.query("version"))), now = nowUtc();
    const result = await c.env.DB.prepare(`UPDATE day_records SET deleted_at=?,deleted_by_type=?,deleted_by_id=?,updated_by_type=?,updated_by_id=?,updated_at=?,version=version+1
      WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?`).bind(now, principal.type, principal.id, principal.type, principal.id, now, id, familyId, expected).run();
    if (!result.meta.changes) throw new ApiError("DAY_RECORD_VERSION_CONFLICT", "Day record version conflict", 409);
    return c.body(null, 204);
  });

  async function statusAction(c: Context<AppEnv>, target: "active" | "archived") {
    const familyId = c.req.param("familyId")!, id = c.req.param("dayRecordId")!, principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:write");
    const input = await jsonBody(c); validateFields(input, ["version"]);
    const previous = await findDayRecord(c.env, familyId, id), expected = version(input.version);
    if (previous.status === target) throw new ApiError(target === "archived" ? "DAY_RECORD_ARCHIVED" : "DAY_RECORD_ALREADY_ACTIVE", target === "archived" ? "Day record is already archived" : "Day record is already active", 409);
    const result = await c.env.DB.prepare("UPDATE day_records SET status=?,updated_by_type=?,updated_by_id=?,updated_at=?,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=? AND status=?")
      .bind(target, principal.type, principal.id, nowUtc(), id, familyId, expected, previous.status).run();
    if (!result.meta.changes) throw new ApiError("DAY_RECORD_VERSION_CONFLICT", "Day record version conflict", 409);
    return c.json(success(await mapDayRecord(c.env, await findDayRecord(c.env, familyId, id), familyToday(await familyTimezone(c.env, familyId)))));
  }
  app.post("/api/v1/families/:familyId/day-records/:dayRecordId/archive", (c) => statusAction(c, "archived"));
  app.post("/api/v1/families/:familyId/day-records/:dayRecordId/restore", (c) => statusAction(c, "active"));

  app.post("/api/v1/families/:familyId/day-records/:dayRecordId/occurrences", async (c) => {
    const familyId = c.req.param("familyId"), id = c.req.param("dayRecordId"), principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:write");
    const previous = await findDayRecord(c.env, familyId, id);
    if (previous.kind === "countdown") throw new ApiError("OCCURRENCE_NOT_ALLOWED", "Countdown day records do not accept occurrences", 409);
    if (previous.status === "archived") throw new ApiError("DAY_RECORD_ARCHIVED", "Archived day records do not accept occurrences", 409);
    const input = await jsonBody(c); validateFields(input, ["occurredOn", "note", "version"]);
    const occurredOn = dayDate(input.occurredOn, "occurredOn"), expected = version(input.version), note = optionalText(input.note, "note", 1000) ?? null;
    const today = familyToday(await familyTimezone(c.env, familyId));
    if (occurredOn === previous.anchor_date) throw new ApiError("DUPLICATE_DAY_OCCURRENCE", "An occurrence already exists on this date", 409);
    if (occurredOn < previous.anchor_date || occurredOn > today) throw new ApiError("INVALID_DAY_RECORD_DATE", "occurredOn must be after the current anchorDate and no later than today", 400);
    const mutationToken = crypto.randomUUID(), occurrenceId = createId("dyo"), nextDueDate = previous.kind === "cycle" ? addDateDays(occurredOn, previous.cycle_days!) : null, now = nowUtc();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE day_records SET anchor_date=?,next_due_date=?,updated_by_type=?,updated_by_id=?,updated_at=?,version=version+1,mutation_token=?
        WHERE id=? AND family_id=? AND deleted_at IS NULL AND status='active' AND version=? AND anchor_date<?`).bind(occurredOn, nextDueDate, principal.type, principal.id, now, mutationToken, id, familyId, expected, occurredOn),
      c.env.DB.prepare(`INSERT INTO day_record_occurrences(id,day_record_id,occurred_on,note,source,recorded_by_type,recorded_by_id)
        SELECT ?,id,?,?,'manual',?,? FROM day_records WHERE id=? AND mutation_token=?`).bind(occurrenceId, occurredOn, note, principal.type, principal.id, id, mutationToken),
      c.env.DB.prepare("UPDATE day_records SET mutation_token=NULL WHERE id=? AND mutation_token=?").bind(id, mutationToken),
    ]);
    if (!results[0].meta.changes) {
      const current = await findDayRecord(c.env, familyId, id);
      if (current.anchor_date === occurredOn) throw new ApiError("DUPLICATE_DAY_OCCURRENCE", "An occurrence already exists on this date", 409);
      if (current.anchor_date > occurredOn) throw new ApiError("INVALID_DAY_RECORD_DATE", "occurredOn must be after the current anchorDate", 400);
      throw new ApiError("DAY_RECORD_VERSION_CONFLICT", "Day record version conflict", 409);
    }
    return c.json(success({ previousAnchorDate: previous.anchor_date, intervalDays: daysBetween(previous.anchor_date, occurredOn), record: await mapDayRecord(c.env, await findDayRecord(c.env, familyId, id), today) }), 201);
  });

  app.get("/api/v1/families/:familyId/day-records/:dayRecordId/occurrences", async (c) => {
    const familyId = c.req.param("familyId"), id = c.req.param("dayRecordId"), principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:read"); await findDayRecord(c.env, familyId, id);
    const limit = parseLimit(c.req.query("limit")), filter = JSON.stringify({ dayRecordId: id });
    const cursor = c.req.query("cursor") ? decodeCursor(c.req.query("cursor")!, "day-record-occurrences", "occurred_desc") : undefined;
    if (cursor && cursor.filter !== filter) throw new ApiError("INVALID_REQUEST", "cursor is invalid for this query", 400);
    const rows = await c.env.DB.prepare(`SELECT *,CAST(julianday(occurred_on)-julianday(previous_on) AS INTEGER) interval_days FROM (
      SELECT o.*,LAG(occurred_on) OVER (ORDER BY occurred_on,id) previous_on FROM day_record_occurrences o WHERE day_record_id=?
    ) ORDER BY occurred_on DESC,id DESC`).bind(id).all<OccurrenceRow>();
    const remaining = cursor ? rows.results.filter((row) => compareTuple(row.occurred_on, row.id, cursor.key!, cursor.id, true) > 0) : rows.results;
    const page = remaining.slice(0, limit), hasMore = remaining.length > limit, last = page.at(-1);
    return c.json(success({ items: await Promise.all(page.map((row) => mapOccurrence(c.env, row))), nextCursor: hasMore && last ? encodeCursor({ v: 2, resource: "day-record-occurrences", sort: "occurred_desc", key: last.occurred_on, id: last.id, filter }) : null }));
  });

  app.get("/api/v1/families/:familyId/day-records", async (c) => {
    const familyId = c.req.param("familyId"), principal = c.get("currentPrincipal");
    await requireFamilyCapability(c.env, principal, familyId, "day-records:read");
    const kinds = parseKinds(c.req.query("kind")), statuses = parseStatuses(c.req.query("status"));
    const attentionOnlyText = c.req.query("attentionOnly");
    if (attentionOnlyText !== undefined && !["true", "false"].includes(attentionOnlyText)) throw new ApiError("INVALID_DAY_RECORD_RULE", "attentionOnly must be true or false", 400);
    const attentionOnly = attentionOnlyText === "true", sort = c.req.query("sort") ?? "attention";
    if (!["attention", "date_asc", "date_desc", "created_desc", "updated_desc"].includes(sort)) throw new ApiError("INVALID_DAY_RECORD_RULE", "sort is invalid", 400);
    let subject = c.req.query("subjectUserId");
    if (subject === "me" && principal.type === "system") throw new ApiError("INVALID_FILTER", "me is unavailable for system identities", 400);
    if (subject === "me") subject = principal.id;
    if (subject) await requireSubject(c.env, familyId, subject);
    const today = familyToday(await familyTimezone(c.env, familyId));
    const filter = JSON.stringify({ kinds, statuses, subject: subject ?? null, attentionOnly, today });
    const cursor = c.req.query("cursor") ? decodeCursor(c.req.query("cursor")!, "day-records", sort) : undefined;
    if (cursor && cursor.filter !== filter) throw new ApiError("INVALID_REQUEST", "cursor is invalid for this query", 400);
    const kindMarks = kinds.map(() => "?").join(","), statusMarks = statuses.map(() => "?").join(",");
    const args: unknown[] = [familyId, ...kinds, ...statuses];
    let sql = `SELECT * FROM day_records WHERE family_id=? AND deleted_at IS NULL AND kind IN (${kindMarks}) AND status IN (${statusMarks})`;
    if (subject) { sql += " AND subject_user_id=?"; args.push(subject); }
    const rows = await c.env.DB.prepare(sql).bind(...args).all<DayRecordRow>();
    let records = await Promise.all(rows.results.map((row) => mapDayRecord(c.env, row, today)));
    if (attentionOnly) records = records.filter((record: any) => record.computed.isAttentionRequired);
    const descending = ["date_desc", "created_desc", "updated_desc"].includes(sort);
    records.sort((a: any, b: any) => compareTuple(sortKey(a, sort), a.id, sortKey(b, sort), b.id, descending));
    if (cursor) records = records.filter((record: any) => compareTuple(sortKey(record, sort), record.id, cursor.key!, cursor.id, descending) > 0);
    const limit = parseLimit(c.req.query("limit")), page = records.slice(0, limit), hasMore = records.length > limit, last: any = page.at(-1);
    return c.json(success({ items: page, nextCursor: hasMore && last ? encodeCursor({ v: 2, resource: "day-records", sort, key: sortKey(last, sort), id: last.id, filter }) : null }));
  });
}
