import type { Context, Hono } from "hono";
import { avatarUrl } from "./avatar";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireActiveUser, requireFamilyMember, requireRelatedMembers } from "./family-access";
import { success } from "./http";
import { createId } from "./ids";
import { decodeCursor, encodeCursor, parseLimit } from "./pagination";
import { exactDate, optionalText, requireObject, requireString, stringIds } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;
type TaskRow = Record<string, any>;

async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try { return requireObject(await c.req.json()); } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

function version(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new ApiError("INVALID_REQUEST", "version must be a positive integer", 400);
  return value as number;
}

function due(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try { return exactDate(value, "due"); } catch { throw new ApiError("INVALID_DUE_DATE", "due must be YYYY-MM-DD or null", 400); }
}

async function findTask(env: Bindings, familyId: string, taskId: string): Promise<TaskRow> {
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id=? AND family_id=? AND deleted_at IS NULL").bind(taskId, familyId).first<TaskRow>();
  if (!row) throw new ApiError("TASK_NOT_FOUND", "Task not found", 404);
  return row;
}

async function mapTask(env: Bindings, row: TaskRow): Promise<Record<string, unknown>> {
  const assignees = await env.DB.prepare(`SELECT u.id user_id, u.display_name, u.avatar_key FROM task_assignees ta JOIN family_members fm ON fm.family_id=? AND fm.user_id=ta.user_id AND fm.status='active' JOIN users u ON u.id=ta.user_id WHERE ta.task_id=? ORDER BY ta.created_at,u.id`).bind(row.family_id, row.id).all<any>();
  const ids = [row.created_by, row.updated_by, row.completed_by].filter(Boolean);
  const placeholders = ids.map(() => "?").join(",") || "NULL";
  const users = ids.length ? await env.DB.prepare(`SELECT id,display_name,avatar_key FROM users WHERE id IN (${placeholders})`).bind(...ids).all<any>() : { results: [] as any[] };
  const person = (id: string | null) => {
    if (!id) return null;
    const found = users.results.find((item) => item.id === id);
    return { userId: id, displayName: found?.display_name ?? "", avatarUrl: avatarUrl(env, found?.avatar_key) };
  };
  return {
    id: row.id, familyId: row.family_id, name: row.name, description: row.description, due: row.due_date,
    status: row.status, assignees: assignees.results.map((item) => ({ userId: item.user_id, displayName: item.display_name, avatarUrl: avatarUrl(env, item.avatar_key) })),
    completedAt: row.completed_at, completedBy: person(row.completed_by), createdBy: person(row.created_by), updatedBy: person(row.updated_by),
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function registerTaskRoutes(app: App): void {
  app.post("/api/v1/families/:familyId/tasks", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    const input = await jsonBody(c), name = requireString(input.name, "name", 100);
    const description = optionalText(input.description, "description", 5000) ?? null;
    const dueDate = input.due === undefined ? null : due(input.due);
    const assigneeIds = input.assigneeIds === undefined ? [] : stringIds(input.assigneeIds, "assigneeIds");
    await requireRelatedMembers(c.env, familyId, assigneeIds, "assignee");
    const id = createId("tsk");
    await c.env.DB.batch([c.env.DB.prepare("INSERT INTO tasks (id,family_id,name,description,due_date,created_by,updated_by) VALUES (?,?,?,?,?,?,?)").bind(id, familyId, name, description, dueDate, userId, userId), ...assigneeIds.map((assigneeId) => c.env.DB.prepare("INSERT INTO task_assignees (task_id,user_id) VALUES (?,?)").bind(id, assigneeId))]);
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, id))), 201);
  });

  app.get("/api/v1/families/:familyId/tasks/:taskId", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, c.req.param("taskId")))));
  });

  app.patch("/api/v1/families/:familyId/tasks/:taskId", async (c) => {
    const familyId = c.req.param("familyId")!, taskId = c.req.param("taskId")!, userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    const previous = await findTask(c.env, familyId, taskId), input = await jsonBody(c), expected = version(input.version);
    if (input.status !== undefined) throw new ApiError("INVALID_REQUEST", "status must be changed with an action endpoint", 400);
    const name = input.name === undefined ? previous.name : requireString(input.name, "name", 100);
    const description = input.description === undefined ? previous.description : optionalText(input.description, "description", 5000) ?? null;
    const dueDate = input.due === undefined ? previous.due_date : due(input.due);
    const assigneeIds = input.assigneeIds === undefined ? undefined : stringIds(input.assigneeIds, "assigneeIds");
    if (assigneeIds) await requireRelatedMembers(c.env, familyId, assigneeIds, "assignee");
    const result = await c.env.DB.prepare("UPDATE tasks SET name=?,description=?,due_date=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?").bind(name, description, dueDate, userId, taskId, familyId, expected).run();
    if (!result.meta.changes) throw new ApiError("TASK_VERSION_CONFLICT", "Task version conflict", 409);
    if (assigneeIds) await c.env.DB.batch([c.env.DB.prepare("DELETE FROM task_assignees WHERE task_id=?").bind(taskId), ...assigneeIds.map((id) => c.env.DB.prepare("INSERT INTO task_assignees (task_id,user_id) VALUES (?,?)").bind(taskId, id))]);
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, taskId))));
  });

  app.delete("/api/v1/families/:familyId/tasks/:taskId", async (c) => {
    const familyId = c.req.param("familyId"), taskId = c.req.param("taskId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId); await findTask(c.env, familyId, taskId);
    const expected = version(Number(c.req.query("version")));
    const result = await c.env.DB.prepare("UPDATE tasks SET deleted_at=CURRENT_TIMESTAMP,deleted_by=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?").bind(userId, userId, taskId, familyId, expected).run();
    if (!result.meta.changes) throw new ApiError("TASK_VERSION_CONFLICT", "Task version conflict", 409);
    return c.body(null, 204);
  });

  async function action(c: Context<AppEnv>, kind: "complete" | "reopen") {
    const familyId = c.req.param("familyId")!, taskId = c.req.param("taskId")!, userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    const row = await findTask(c.env, familyId, taskId), input = await jsonBody(c), expected = version(input.version);
    if (kind === "complete" && row.status === "completed") throw new ApiError("TASK_ALREADY_COMPLETED", "Task is already completed", 409);
    if (kind === "reopen" && row.status === "pending") throw new ApiError("TASK_ALREADY_PENDING", "Task is already pending", 409);
    const sql = kind === "complete" ? "UPDATE tasks SET status='completed',completed_at=CURRENT_TIMESTAMP,completed_by=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?" : "UPDATE tasks SET status='pending',completed_at=NULL,completed_by=NULL,updated_by=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?";
    const statement = kind === "complete" ? c.env.DB.prepare(sql).bind(userId, userId, taskId, familyId, expected) : c.env.DB.prepare(sql).bind(userId, taskId, familyId, expected);
    const result = await statement.run();
    if (!result.meta.changes) throw new ApiError("TASK_VERSION_CONFLICT", "Task version conflict", 409);
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, taskId))));
  }
  app.post("/api/v1/families/:familyId/tasks/:taskId/complete", (c) => action(c, "complete"));
  app.post("/api/v1/families/:familyId/tasks/:taskId/reopen", (c) => action(c, "reopen"));

  app.get("/api/v1/families/:familyId/tasks", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId");
    await requireActiveUser(c.env, userId); await requireFamilyMember(c.env, familyId, userId);
    const statuses = (c.req.query("status") ?? "pending").split(",");
    if (statuses.length === 0 || new Set(statuses).size !== statuses.length || statuses.some((item) => !["pending", "completed", "cancelled"].includes(item))) throw new ApiError("INVALID_REQUEST", "status is invalid", 400);
    const sort = c.req.query("sort") ?? "due_asc";
    if (!["due_asc", "due_desc", "created_desc", "updated_desc"].includes(sort)) throw new ApiError("INVALID_REQUEST", "sort is invalid", 400);
    const dueFrom = c.req.query("dueFrom") ? exactDate(c.req.query("dueFrom"), "dueFrom") : undefined;
    const dueTo = c.req.query("dueTo") ? exactDate(c.req.query("dueTo"), "dueTo") : undefined;
    if (dueFrom && dueTo && dueTo < dueFrom) throw new ApiError("INVALID_REQUEST", "dueTo must not precede dueFrom", 400);
    const includeNoDue = c.req.query("includeNoDue") === "true";
    if (c.req.query("includeNoDue") && !["true", "false"].includes(c.req.query("includeNoDue")!)) throw new ApiError("INVALID_REQUEST", "includeNoDue must be true or false", 400);
    let assignee = c.req.query("assigneeId"); if (assignee === "me") assignee = userId;
    if (assignee) await requireRelatedMembers(c.env, familyId, [assignee], "assignee");
    const placeholders = statuses.map(() => "?").join(",");
    const args: unknown[] = [familyId, ...statuses];
    let sql = `SELECT t.* FROM tasks t WHERE t.family_id=? AND t.deleted_at IS NULL AND t.status IN (${placeholders})`;
    if (assignee) { sql += " AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id AND ta.user_id=?)"; args.push(assignee); }
    const rows = await c.env.DB.prepare(sql).bind(...args).all<TaskRow>();
    let filtered = rows.results.filter((row) => {
      if (row.due_date === null) return (!dueFrom && !dueTo) || includeNoDue;
      return (!dueFrom || row.due_date >= dueFrom) && (!dueTo || row.due_date <= dueTo);
    });
    const value = (row: TaskRow) => sort === "created_desc" ? row.created_at : sort === "updated_desc" ? row.updated_at : row.due_date;
    filtered.sort((a, b) => {
      if ((sort === "due_asc" || sort === "due_desc") && (a.due_date === null || b.due_date === null)) return a.due_date === b.due_date ? a.id.localeCompare(b.id) : a.due_date === null ? 1 : -1;
      const comparison = String(value(a)).localeCompare(String(value(b)));
      const direction = sort.endsWith("desc") ? -1 : 1;
      return comparison === 0 ? a.id.localeCompare(b.id) : comparison * direction;
    });
    const cursor = c.req.query("cursor") ? decodeCursor(c.req.query("cursor")!, "tasks", sort) : undefined;
    if (cursor) { const index = filtered.findIndex((row) => row.id === cursor.id && value(row) === cursor.key); if (index < 0) throw new ApiError("INVALID_REQUEST", "cursor is invalid for this query", 400); filtered = filtered.slice(index + 1); }
    const limit = parseLimit(c.req.query("limit")), hasMore = filtered.length > limit, page = filtered.slice(0, limit), last = page.at(-1);
    const items = await Promise.all(page.map((row) => mapTask(c.env, row)));
    const nextCursor = hasMore && last ? encodeCursor({ v: 1, resource: "tasks", sort, key: value(last), id: last.id }) : null;
    return c.json(success({ items, nextCursor }));
  });
}
