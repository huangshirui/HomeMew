import type { Context, Hono } from "hono";
import { avatarUrl } from "./avatar";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireActiveUser, requireFamilyMember } from "./family-access";
import { success } from "./http";
import { createId } from "./ids";
import { decodeCursor, encodeCursor, parseLimit } from "./pagination";
import { mapActor } from "./principal-access";
import { nowUtc } from "./time";
import { exactDate, optionalText, requireObject, requireString } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;
type WishStatus = "open" | "claimed" | "fulfilled" | "archived";

type WishRow = {
  id: string; family_id: string; owner_user_id: string; title: string; description: string | null;
  desired_date: string | null; status: WishStatus; claimant_user_id: string | null; claimed_at: string | null;
  fulfilled_by_user_id: string | null; fulfilled_at: string | null; archived_from_status: Exclude<WishStatus, "archived"> | null;
  created_by_type: string; created_by_id: string; updated_by_type: string; updated_by_id: string;
  version: number; created_at: string; updated_at: string;
};

async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try { return requireObject(await c.req.json()); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400); }
}

function validateFields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some((field) => !allowed.includes(field))) throw new ApiError("INVALID_REQUEST", "Request contains unsupported wish fields", 400);
}

function version(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new ApiError("INVALID_REQUEST", "version must be a positive integer", 400);
  return value as number;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return exactDate(value, field);
}

async function requireWishMember(env: Bindings, principal: Variables["currentPrincipal"], familyId: string): Promise<string> {
  if (principal.type !== "user") throw new ApiError("FORBIDDEN", "Only family members can access wishes", 403);
  await requireActiveUser(env, principal.id);
  await requireFamilyMember(env, familyId, principal.id);
  return principal.id;
}

async function findWish(env: Bindings, familyId: string, id: string): Promise<WishRow> {
  const row = await env.DB.prepare("SELECT * FROM wishes WHERE id=? AND family_id=? AND deleted_at IS NULL").bind(id, familyId).first<WishRow>();
  if (!row) throw new ApiError("WISH_NOT_FOUND", "Wish not found", 404);
  return row;
}

async function mapUser(env: Bindings, userId: string | null) {
  if (!userId) return null;
  const row = await env.DB.prepare("SELECT id,display_name,avatar_key FROM users WHERE id=?").bind(userId).first<any>();
  return row ? { userId: row.id, displayName: row.display_name, avatarUrl: avatarUrl(env, row.avatar_key) } : null;
}

async function mapWish(env: Bindings, row: WishRow) {
  return {
    id: row.id, familyId: row.family_id, title: row.title, description: row.description, desiredDate: row.desired_date,
    status: row.status, owner: await mapUser(env, row.owner_user_id), claimant: await mapUser(env, row.claimant_user_id),
    claimedAt: row.claimed_at, fulfilledBy: await mapUser(env, row.fulfilled_by_user_id), fulfilledAt: row.fulfilled_at,
    createdBy: await mapActor(env, row.created_by_type, row.created_by_id),
    updatedBy: await mapActor(env, row.updated_by_type, row.updated_by_id),
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function requireOwner(row: WishRow, userId: string): void {
  if (row.owner_user_id !== userId) throw new ApiError("WISH_OWNER_REQUIRED", "Only the wish owner can perform this action", 403);
}

function assertVersion(row: WishRow, expected: number): void {
  if (row.version !== expected) throw new ApiError("VERSION_CONFLICT", "Wish version conflict", 409);
}

function statuses(value: string | undefined): WishStatus[] {
  const result = value?.split(",") ?? ["open", "claimed", "fulfilled"];
  if (!result.length || new Set(result).size !== result.length || result.some((item) => !["open", "claimed", "fulfilled", "archived"].includes(item))) {
    throw new ApiError("INVALID_REQUEST", "status is invalid", 400);
  }
  return result as WishStatus[];
}

function userFilter(value: string | undefined, currentUserId: string, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (value === "me") return currentUserId;
  if (!/^usr_/.test(value)) throw new ApiError("INVALID_REQUEST", `${field} must be a user ID or me`, 400);
  return value;
}

function sortKey(row: WishRow, sort: string): string {
  if (sort === "default") {
    const rank: Record<WishStatus, string> = { open: "0", claimed: "1", fulfilled: "2", archived: "3" };
    return `${rank[row.status]}|${row.desired_date ?? "9999-12-31"}|${row.created_at}`;
  }
  if (sort === "desired_asc") return `${row.desired_date ?? "9999-12-31"}|${row.created_at}`;
  return sort === "created_desc" ? row.created_at : row.updated_at;
}

function compareTuple(aKey: string, aId: string, bKey: string, bId: string, descending: boolean): number {
  const key = aKey.localeCompare(bKey), id = aId.localeCompare(bId);
  return descending ? -(key || id) : key || id;
}

export function registerWishRoutes(app: App): void {
  app.post("/api/v1/families/:familyId/wishes", async (c) => {
    const familyId = c.req.param("familyId"), userId = await requireWishMember(c.env, c.get("currentPrincipal"), familyId);
    const input = await jsonBody(c); validateFields(input, ["title", "description", "desiredDate"]);
    const title = requireString(input.title, "title", 100), description = optionalText(input.description, "description", 5000) ?? null;
    const desiredDate = optionalDate(input.desiredDate, "desiredDate"), id = createId("wsh");
    await c.env.DB.prepare(`INSERT INTO wishes(id,family_id,owner_user_id,title,description,desired_date,created_by_type,created_by_id,updated_by_type,updated_by_id)
      VALUES(?,?,?,?,?,?,'user',?,'user',?)`).bind(id, familyId, userId, title, description, desiredDate, userId, userId).run();
    return c.json(success(await mapWish(c.env, await findWish(c.env, familyId, id))), 201);
  });

  app.get("/api/v1/families/:familyId/wishes/:wishId", async (c) => {
    const familyId = c.req.param("familyId"); await requireWishMember(c.env, c.get("currentPrincipal"), familyId);
    return c.json(success(await mapWish(c.env, await findWish(c.env, familyId, c.req.param("wishId")))));
  });

  app.patch("/api/v1/families/:familyId/wishes/:wishId", async (c) => {
    const familyId = c.req.param("familyId")!, id = c.req.param("wishId")!, userId = await requireWishMember(c.env, c.get("currentPrincipal"), familyId);
    const previous = await findWish(c.env, familyId, id); requireOwner(previous, userId);
    if (previous.status === "archived") throw new ApiError("WISH_ARCHIVED", "Archived wishes are read-only", 409);
    const input = await jsonBody(c); validateFields(input, ["title", "description", "desiredDate", "version"]);
    const expected = version(input.version); assertVersion(previous, expected);
    if (Object.keys(input).length < 2) throw new ApiError("INVALID_REQUEST", "At least one wish change is required", 400);
    const title = input.title === undefined ? previous.title : requireString(input.title, "title", 100);
    const description = input.description === undefined ? previous.description : optionalText(input.description, "description", 5000) ?? null;
    const desiredDate = input.desiredDate === undefined ? previous.desired_date : optionalDate(input.desiredDate, "desiredDate");
    const result = await c.env.DB.prepare(`UPDATE wishes SET title=?,description=?,desired_date=?,updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1
      WHERE id=? AND family_id=? AND deleted_at IS NULL AND status!='archived' AND version=?`).bind(title, description, desiredDate, userId, nowUtc(), id, familyId, expected).run();
    if (!result.meta.changes) throw new ApiError("VERSION_CONFLICT", "Wish version conflict", 409);
    return c.json(success(await mapWish(c.env, await findWish(c.env, familyId, id))));
  });

  app.delete("/api/v1/families/:familyId/wishes/:wishId", async (c) => {
    const familyId = c.req.param("familyId"), id = c.req.param("wishId"), userId = await requireWishMember(c.env, c.get("currentPrincipal"), familyId);
    const previous = await findWish(c.env, familyId, id); requireOwner(previous, userId);
    const expected = version(Number(c.req.query("version"))); assertVersion(previous, expected); const now = nowUtc();
    const result = await c.env.DB.prepare(`UPDATE wishes SET deleted_at=?,deleted_by_type='user',deleted_by_id=?,updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1
      WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?`).bind(now, userId, userId, now, id, familyId, expected).run();
    if (!result.meta.changes) throw new ApiError("VERSION_CONFLICT", "Wish version conflict", 409);
    return c.body(null, 204);
  });

  async function action(c: Context<AppEnv>, kind: "claim" | "unclaim" | "fulfill" | "reopen" | "archive" | "restore") {
    const familyId = c.req.param("familyId")!, id = c.req.param("wishId")!, userId = await requireWishMember(c.env, c.get("currentPrincipal"), familyId);
    const input = await jsonBody(c); validateFields(input, ["version"]); const expected = version(input.version);
    const row = await findWish(c.env, familyId, id); assertVersion(row, expected); const now = nowUtc();
    let sql = "", args: unknown[] = [];
    if (kind === "claim") {
      if (row.status !== "open") throw new ApiError("WISH_NOT_OPEN", "Only open wishes can be claimed", 409);
      if (row.owner_user_id === userId) throw new ApiError("WISH_CANNOT_CLAIM_OWN", "A member cannot claim their own wish", 409);
      sql = "UPDATE wishes SET status='claimed',claimant_user_id=?,claimed_at=?,updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1 WHERE id=? AND family_id=? AND status='open' AND version=?";
      args = [userId, now, userId, now, id, familyId, expected];
    } else if (kind === "unclaim") {
      if (row.status !== "claimed" || row.claimant_user_id !== userId) throw new ApiError("WISH_CLAIMANT_REQUIRED", "Only the current claimant can release this wish", 403);
      sql = "UPDATE wishes SET status='open',claimant_user_id=NULL,claimed_at=NULL,updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1 WHERE id=? AND family_id=? AND status='claimed' AND claimant_user_id=? AND version=?";
      args = [userId, now, id, familyId, userId, expected];
    } else if (kind === "fulfill") {
      if (row.status === "archived" || row.status === "fulfilled") throw new ApiError("WISH_INVALID_STATE", "Wish cannot be fulfilled from its current state", 409);
      if (row.owner_user_id !== userId && row.claimant_user_id !== userId) throw new ApiError("WISH_FULFILLER_REQUIRED", "Only the owner or current claimant can fulfill this wish", 403);
      sql = "UPDATE wishes SET status='fulfilled',fulfilled_by_user_id=?,fulfilled_at=?,updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1 WHERE id=? AND family_id=? AND status IN ('open','claimed') AND version=?";
      args = [userId, now, userId, now, id, familyId, expected];
    } else if (kind === "reopen") {
      requireOwner(row, userId); if (row.status !== "fulfilled") throw new ApiError("WISH_INVALID_STATE", "Only fulfilled wishes can be reopened", 409);
      sql = "UPDATE wishes SET status='open',claimant_user_id=NULL,claimed_at=NULL,fulfilled_by_user_id=NULL,fulfilled_at=NULL,updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1 WHERE id=? AND family_id=? AND status='fulfilled' AND version=?";
      args = [userId, now, id, familyId, expected];
    } else if (kind === "archive") {
      requireOwner(row, userId); if (row.status === "archived") throw new ApiError("WISH_ARCHIVED", "Wish is already archived", 409);
      sql = "UPDATE wishes SET archived_from_status=status,status='archived',updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1 WHERE id=? AND family_id=? AND status!='archived' AND version=?";
      args = [userId, now, id, familyId, expected];
    } else {
      requireOwner(row, userId); if (row.status !== "archived") throw new ApiError("WISH_NOT_ARCHIVED", "Wish is not archived", 409);
      let target = row.archived_from_status ?? "open", claimant = row.claimant_user_id, claimedAt = row.claimed_at;
      if (target === "claimed") {
        const active = claimant ? await c.env.DB.prepare("SELECT 1 ok FROM family_members WHERE family_id=? AND user_id=? AND status='active'").bind(familyId, claimant).first() : null;
        if (!active) { target = "open"; claimant = null; claimedAt = null; }
      }
      sql = "UPDATE wishes SET status=?,archived_from_status=NULL,claimant_user_id=?,claimed_at=?,updated_by_type='user',updated_by_id=?,updated_at=?,version=version+1 WHERE id=? AND family_id=? AND status='archived' AND version=?";
      args = [target, claimant, claimedAt, userId, now, id, familyId, expected];
    }
    const result = await c.env.DB.prepare(sql).bind(...args).run();
    if (!result.meta.changes) throw new ApiError("VERSION_CONFLICT", "Wish version conflict", 409);
    return c.json(success(await mapWish(c.env, await findWish(c.env, familyId, id))));
  }

  for (const kind of ["claim", "unclaim", "fulfill", "reopen", "archive", "restore"] as const) {
    app.post(`/api/v1/families/:familyId/wishes/:wishId/${kind}`, (c) => action(c, kind));
  }

  app.get("/api/v1/families/:familyId/wishes", async (c) => {
    const familyId = c.req.param("familyId"), userId = await requireWishMember(c.env, c.get("currentPrincipal"), familyId);
    const selectedStatuses = statuses(c.req.query("status"));
    const owner = userFilter(c.req.query("ownerUserId"), userId, "ownerUserId"), claimant = userFilter(c.req.query("claimantUserId"), userId, "claimantUserId");
    const desiredFrom = c.req.query("desiredFrom") === undefined ? undefined : exactDate(c.req.query("desiredFrom"), "desiredFrom");
    const desiredTo = c.req.query("desiredTo") === undefined ? undefined : exactDate(c.req.query("desiredTo"), "desiredTo");
    if (desiredFrom && desiredTo && desiredFrom > desiredTo) throw new ApiError("INVALID_REQUEST", "desiredFrom must not be after desiredTo", 400);
    const sort = c.req.query("sort") ?? "default";
    if (!["default", "desired_asc", "created_desc", "updated_desc"].includes(sort)) throw new ApiError("INVALID_REQUEST", "sort is invalid", 400);
    const filter = JSON.stringify({ statuses: selectedStatuses, owner: owner ?? null, claimant: claimant ?? null, desiredFrom: desiredFrom ?? null, desiredTo: desiredTo ?? null });
    const cursor = c.req.query("cursor") ? decodeCursor(c.req.query("cursor")!, "wishes", sort) : undefined;
    if (cursor && cursor.filter !== filter) throw new ApiError("INVALID_REQUEST", "cursor is invalid for this query", 400);
    const marks = selectedStatuses.map(() => "?").join(","), args: unknown[] = [familyId, ...selectedStatuses];
    let sql = `SELECT * FROM wishes WHERE family_id=? AND deleted_at IS NULL AND status IN (${marks})`;
    if (owner) { sql += " AND owner_user_id=?"; args.push(owner); }
    if (claimant) { sql += " AND claimant_user_id=?"; args.push(claimant); }
    if (desiredFrom) { sql += " AND desired_date>=?"; args.push(desiredFrom); }
    if (desiredTo) { sql += " AND desired_date<=?"; args.push(desiredTo); }
    let rows = (await c.env.DB.prepare(sql).bind(...args).all<WishRow>()).results;
    const descending = sort === "created_desc" || sort === "updated_desc";
    rows.sort((a, b) => compareTuple(sortKey(a, sort), a.id, sortKey(b, sort), b.id, descending));
    if (cursor) rows = rows.filter((row) => compareTuple(sortKey(row, sort), row.id, cursor.key!, cursor.id, descending) > 0);
    const limit = parseLimit(c.req.query("limit")), page = rows.slice(0, limit), hasMore = rows.length > limit, last = page.at(-1);
    return c.json(success({ items: await Promise.all(page.map((row) => mapWish(c.env, row))), nextCursor: hasMore && last ? encodeCursor({ v: 2, resource: "wishes", sort, key: sortKey(last, sort), id: last.id, filter }) : null }));
  });
}
