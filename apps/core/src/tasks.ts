import type { Context, Hono } from "hono";
import { avatarUrl } from "./avatar";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireRelatedMembers } from "./family-access";
import { mapActor, requireFamilyCapability } from "./principal-access";
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
  return {
    id: row.id, familyId: row.family_id, name: row.name, description: row.description, due: row.due_date,
    status: row.status, assignees: assignees.results.map((item) => ({ userId: item.user_id, displayName: item.display_name, avatarUrl: avatarUrl(env, item.avatar_key) })),
    completedAt: row.completed_at, completedBy: await mapActor(env,row.completed_by_type,row.completed_by_id), createdBy: await mapActor(env,row.created_by_type,row.created_by_id), updatedBy: await mapActor(env,row.updated_by_type,row.updated_by_id),
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function registerTaskRoutes(app: App): void {
  app.post("/api/v1/families/:familyId/tasks", async (c) => {
    const familyId=c.req.param("familyId"),principal=c.get("currentPrincipal");await requireFamilyCapability(c.env,principal,familyId,"tasks:write");
    const input = await jsonBody(c), name = requireString(input.name, "name", 100);
    const description = optionalText(input.description, "description", 5000) ?? null;
    const dueDate = input.due === undefined ? null : due(input.due);
    const assigneeIds = input.assigneeIds === undefined ? [] : stringIds(input.assigneeIds, "assigneeIds");
    await requireRelatedMembers(c.env, familyId, assigneeIds, "assignee");
    const id = createId("tsk");
    await c.env.DB.batch([c.env.DB.prepare("INSERT INTO tasks (id,family_id,name,description,due_date,created_by_type,created_by_id,updated_by_type,updated_by_id) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,familyId,name,description,dueDate,principal.type,principal.id,principal.type,principal.id), ...assigneeIds.map((assigneeId) => c.env.DB.prepare("INSERT INTO task_assignees (task_id,user_id) VALUES (?,?)").bind(id, assigneeId))]);
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, id))), 201);
  });

  app.get("/api/v1/families/:familyId/tasks/:taskId", async (c) => {
    const familyId=c.req.param("familyId"),principal=c.get("currentPrincipal");await requireFamilyCapability(c.env,principal,familyId,"tasks:read");
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, c.req.param("taskId")))));
  });

  app.patch("/api/v1/families/:familyId/tasks/:taskId", async (c) => {
    const familyId=c.req.param("familyId")!,taskId=c.req.param("taskId")!,principal=c.get("currentPrincipal");await requireFamilyCapability(c.env,principal,familyId,"tasks:write");
    const previous = await findTask(c.env, familyId, taskId), input = await jsonBody(c), expected = version(input.version);
    if (input.status !== undefined) throw new ApiError("INVALID_REQUEST", "status must be changed with an action endpoint", 400);
    const name = input.name === undefined ? previous.name : requireString(input.name, "name", 100);
    const description = input.description === undefined ? previous.description : optionalText(input.description, "description", 5000) ?? null;
    const dueDate = input.due === undefined ? previous.due_date : due(input.due);
    const assigneeIds = input.assigneeIds === undefined ? undefined : stringIds(input.assigneeIds, "assigneeIds");
    if (assigneeIds) await requireRelatedMembers(c.env, familyId, assigneeIds, "assignee");
    const mutationToken = crypto.randomUUID();
    const update=c.env.DB.prepare("UPDATE tasks SET name=?,description=?,due_date=?,updated_by_type=?,updated_by_id=?,updated_at=CURRENT_TIMESTAMP,version=version+1,mutation_token=? WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?").bind(name,description,dueDate,principal.type,principal.id,mutationToken,taskId,familyId,expected);
    const statements = [update];
    if (assigneeIds) {
      statements.push(c.env.DB.prepare("DELETE FROM task_assignees WHERE task_id=? AND EXISTS (SELECT 1 FROM tasks WHERE id=? AND mutation_token=?)").bind(taskId, taskId, mutationToken));
      statements.push(...assigneeIds.map((id) => c.env.DB.prepare("INSERT INTO task_assignees (task_id,user_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM tasks WHERE id=? AND mutation_token=?)").bind(taskId, id, taskId, mutationToken)));
    }
    statements.push(c.env.DB.prepare("UPDATE tasks SET mutation_token=NULL WHERE id=? AND mutation_token=?").bind(taskId, mutationToken));
    const results = await c.env.DB.batch(statements);
    if (!results[0].meta.changes) throw new ApiError("TASK_VERSION_CONFLICT", "Task version conflict", 409);
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, taskId))));
  });

  app.delete("/api/v1/families/:familyId/tasks/:taskId", async (c) => {
    const familyId=c.req.param("familyId"),taskId=c.req.param("taskId"),principal=c.get("currentPrincipal");await requireFamilyCapability(c.env,principal,familyId,"tasks:write");await findTask(c.env,familyId,taskId);
    const expected = version(Number(c.req.query("version")));
    const result=await c.env.DB.prepare("UPDATE tasks SET deleted_at=CURRENT_TIMESTAMP,deleted_by_type=?,deleted_by_id=?,updated_by_type=?,updated_by_id=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?").bind(principal.type,principal.id,principal.type,principal.id,taskId,familyId,expected).run();
    if (!result.meta.changes) throw new ApiError("TASK_VERSION_CONFLICT", "Task version conflict", 409);
    return c.body(null, 204);
  });

  async function action(c: Context<AppEnv>, kind: "complete" | "reopen") {
    const familyId=c.req.param("familyId")!,taskId=c.req.param("taskId")!,principal=c.get("currentPrincipal");await requireFamilyCapability(c.env,principal,familyId,"tasks:write");
    const row = await findTask(c.env, familyId, taskId), input = await jsonBody(c), expected = version(input.version);
    if (kind === "complete" && row.status === "completed") throw new ApiError("TASK_ALREADY_COMPLETED", "Task is already completed", 409);
    if (kind === "reopen" && row.status === "pending") throw new ApiError("TASK_ALREADY_PENDING", "Task is already pending", 409);
    const sql=kind==="complete"?"UPDATE tasks SET status='completed',completed_at=CURRENT_TIMESTAMP,completed_by_type=?,completed_by_id=?,updated_by_type=?,updated_by_id=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?":"UPDATE tasks SET status='pending',completed_at=NULL,completed_by_type=NULL,completed_by_id=NULL,updated_by_type=?,updated_by_id=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND family_id=? AND deleted_at IS NULL AND version=?";
    const statement=kind==="complete"?c.env.DB.prepare(sql).bind(principal.type,principal.id,principal.type,principal.id,taskId,familyId,expected):c.env.DB.prepare(sql).bind(principal.type,principal.id,taskId,familyId,expected);
    const result = await statement.run();
    if (!result.meta.changes) throw new ApiError("TASK_VERSION_CONFLICT", "Task version conflict", 409);
    return c.json(success(await mapTask(c.env, await findTask(c.env, familyId, taskId))));
  }
  app.post("/api/v1/families/:familyId/tasks/:taskId/complete", (c) => action(c, "complete"));
  app.post("/api/v1/families/:familyId/tasks/:taskId/reopen", (c) => action(c, "reopen"));

  app.get("/api/v1/families/:familyId/tasks", async (c) => {
    const familyId=c.req.param("familyId"),principal=c.get("currentPrincipal");await requireFamilyCapability(c.env,principal,familyId,"tasks:read");const userId=principal.id;
    const statuses = (c.req.query("status") ?? "pending").split(",");
    if (statuses.length === 0 || new Set(statuses).size !== statuses.length || statuses.some((item) => !["pending", "completed", "cancelled"].includes(item))) throw new ApiError("INVALID_REQUEST", "status is invalid", 400);
    const sort = c.req.query("sort") ?? "due_asc";
    if (!["due_asc", "due_desc", "created_desc", "updated_desc"].includes(sort)) throw new ApiError("INVALID_REQUEST", "sort is invalid", 400);
    const dueFrom = c.req.query("dueFrom") ? exactDate(c.req.query("dueFrom"), "dueFrom") : undefined;
    const dueTo = c.req.query("dueTo") ? exactDate(c.req.query("dueTo"), "dueTo") : undefined;
    if (dueFrom && dueTo && dueTo < dueFrom) throw new ApiError("INVALID_REQUEST", "dueTo must not precede dueFrom", 400);
    const includeNoDue = c.req.query("includeNoDue") === "true";
    if (c.req.query("includeNoDue") && !["true", "false"].includes(c.req.query("includeNoDue")!)) throw new ApiError("INVALID_REQUEST", "includeNoDue must be true or false", 400);
    let assignee=c.req.query("assigneeId");if(assignee==="me"&&principal.type==="system")throw new ApiError("INVALID_FILTER","me is unavailable for system identities",400);if(assignee==="me")assignee=userId;
    if (assignee) await requireRelatedMembers(c.env, familyId, [assignee], "assignee");
    const placeholders = statuses.map(() => "?").join(",");
    const filter = JSON.stringify({ statuses, dueFrom: dueFrom ?? null, dueTo: dueTo ?? null, includeNoDue, assignee: assignee ?? null });
    const cursor = c.req.query("cursor") ? decodeCursor(c.req.query("cursor")!, "tasks", sort) : undefined;
    if (cursor && cursor.filter !== filter) throw new ApiError("INVALID_REQUEST", "cursor is invalid for this query", 400);
    const args: unknown[] = [familyId, ...statuses];
    let sql = `SELECT t.* FROM tasks t WHERE t.family_id=? AND t.deleted_at IS NULL AND t.status IN (${placeholders})`;
    if (assignee) { sql += " AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id AND ta.user_id=?)"; args.push(assignee); }
    if (dueFrom || dueTo) {
      const dated: string[] = [];
      if (dueFrom) { dated.push("t.due_date>=?"); args.push(dueFrom); }
      if (dueTo) { dated.push("t.due_date<=?"); args.push(dueTo); }
      sql += ` AND ((${dated.join(" AND ")})${includeNoDue ? " OR t.due_date IS NULL" : ""})`;
    }
    const keyColumn = sort === "created_desc" ? "t.created_at" : sort === "updated_desc" ? "t.updated_at" : "t.due_date";
    const descending = sort.endsWith("desc");
    if (cursor) {
      if (sort.startsWith("due_")) {
        if (cursor.key === null) { sql += " AND t.due_date IS NULL AND t.id>?"; args.push(cursor.id); }
        else { sql += ` AND ((t.due_date IS NOT NULL AND (${keyColumn}${descending ? "<" : ">"}? OR (${keyColumn}=? AND t.id>?))) OR t.due_date IS NULL)`; args.push(cursor.key, cursor.key, cursor.id); }
      } else {
        sql += ` AND (${keyColumn}${descending ? "<" : ">"}? OR (${keyColumn}=? AND t.id>?))`; args.push(cursor.key, cursor.key, cursor.id);
      }
    }
    sql += sort.startsWith("due_")
      ? ` ORDER BY t.due_date IS NULL ASC, t.due_date ${descending ? "DESC" : "ASC"}, t.id ASC`
      : ` ORDER BY ${keyColumn} DESC, t.id ASC`;
    const limit = parseLimit(c.req.query("limit")); args.push(limit + 1); sql += " LIMIT ?";
    const rows = await c.env.DB.prepare(sql).bind(...args).all<TaskRow>();
    const value = (row: TaskRow) => sort === "created_desc" ? row.created_at : sort === "updated_desc" ? row.updated_at : row.due_date;
    const hasMore = rows.results.length > limit, page = rows.results.slice(0, limit), last = page.at(-1);
    const items = await Promise.all(page.map((row) => mapTask(c.env, row)));
    const nextCursor = hasMore && last ? encodeCursor({ v: 2, resource: "tasks", sort, key: value(last), id: last.id, filter }) : null;
    return c.json(success({ items, nextCursor }));
  });
}
