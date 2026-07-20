import type { Context, Hono } from "hono";
import { authenticate, requireInternal } from "./auth";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { createId, createInviteCode } from "./ids";
import { success } from "./http";
import { optionalUrl, positiveInteger, requireObject, requireString } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;

async function body(context: Context<AppEnv>): Promise<Record<string, unknown>> {
  try { return requireObject(await context.req.json()); } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

async function activeUser(env: Bindings, id: string): Promise<any> {
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<any>();
  if (!user) throw new ApiError("USER_NOT_FOUND", "User not found", 404);
  if (user.status !== "active") throw new ApiError("FORBIDDEN", "User is disabled", 403);
  return user;
}

async function membership(env: Bindings, familyId: string, userId: string): Promise<any> {
  const row = await env.DB.prepare("SELECT * FROM family_members WHERE family_id = ? AND user_id = ? AND status = 'active'").bind(familyId, userId).first<any>();
  if (!row) throw new ApiError("FORBIDDEN", "Active family membership is required", 403);
  return row;
}

async function admin(env: Bindings, familyId: string, userId: string): Promise<any> {
  const row = await membership(env, familyId, userId);
  if (row.role !== "admin") throw new ApiError("FORBIDDEN", "Family administrator access is required", 403);
  return row;
}

async function hashCode(code: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inviteStatus(invite: any): "active" | "expired" | "exhausted" | "revoked" {
  if (invite.status === "revoked") return "revoked";
  if (Date.now() >= Date.parse(invite.expires_at)) return "expired";
  if (invite.used_count >= invite.max_uses) return "exhausted";
  return "active";
}

export function registerBusinessRoutes(app: App): void {
  app.use("/api/v1/*", authenticate());

  app.post("/api/v1/internal/users", requireInternal(), async (c) => {
    const input = await body(c);
    const displayName = requireString(input.displayName, "displayName");
    const avatarUrl = optionalUrl(input.avatarUrl, "avatarUrl") ?? null;
    const createdFrom = input.createdFrom;
    if (!['wechat_miniprogram', 'wecom', 'admin', 'other'].includes(createdFrom as string)) throw new ApiError("INVALID_REQUEST", "createdFrom is invalid", 400);
    const id = createId("usr");
    await c.env.DB.prepare("INSERT INTO users (id, display_name, avatar_url, created_from) VALUES (?, ?, ?, ?)").bind(id, displayName, avatarUrl, createdFrom).run();
    const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<any>();
    return c.json(success({ id, displayName: row.display_name, avatarUrl: row.avatar_url, status: row.status, createdFrom: row.created_from, createdAt: row.created_at }), 201);
  });

  app.get("/api/v1/me", async (c) => {
    const row = await activeUser(c.env, c.get("currentUserId"));
    return c.json(success({ id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url, status: row.status }));
  });

  app.patch("/api/v1/me", async (c) => {
    const id = c.get("currentUserId"); await activeUser(c.env, id); const input = await body(c);
    const displayName = input.displayName === undefined ? undefined : requireString(input.displayName, "displayName");
    const avatarUrl = optionalUrl(input.avatarUrl, "avatarUrl");
    if (displayName === undefined && avatarUrl === undefined) throw new ApiError("INVALID_REQUEST", "No supported fields supplied", 400);
    await c.env.DB.prepare("UPDATE users SET display_name = COALESCE(?, display_name), avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(displayName ?? null, avatarUrl !== undefined ? 1 : 0, avatarUrl ?? null, id).run();
    const row = await activeUser(c.env, id);
    return c.json(success({ id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url, status: row.status }));
  });

  app.get("/api/v1/me/families", async (c) => {
    const id = c.get("currentUserId"); await activeUser(c.env, id);
    const rows = await c.env.DB.prepare(`SELECT f.id, f.name, f.avatar_url, fm.role, COUNT(active.id) member_count FROM family_members fm JOIN families f ON f.id = fm.family_id LEFT JOIN family_members active ON active.family_id = f.id AND active.status = 'active' WHERE fm.user_id = ? AND fm.status = 'active' AND f.status = 'active' GROUP BY f.id, fm.role ORDER BY fm.joined_at`).bind(id).all<any>();
    return c.json(success({ items: rows.results.map((row) => ({ id: row.id, name: row.name, avatarUrl: row.avatar_url, role: row.role, memberCount: row.member_count })) }));
  });

  app.post("/api/v1/families", async (c) => {
    const userId = c.get("currentUserId"); await activeUser(c.env, userId); const input = await body(c);
    const name = requireString(input.name, "name"); const avatarUrl = optionalUrl(input.avatarUrl, "avatarUrl") ?? null;
    const count = await c.env.DB.prepare("SELECT COUNT(*) count FROM families WHERE created_by = ? AND status = 'active'").bind(userId).first<{ count: number }>();
    if ((count?.count ?? 0) >= 3) throw new ApiError("FAMILY_CREATE_LIMIT_REACHED", "Active family creation limit reached", 409);
    const id = createId("fam"), memberId = createId("fmem");
    await c.env.DB.batch([c.env.DB.prepare("INSERT INTO families (id, name, avatar_url, created_by) VALUES (?, ?, ?, ?)").bind(id, name, avatarUrl, userId), c.env.DB.prepare("INSERT INTO family_members (id, family_id, user_id, role) VALUES (?, ?, ?, 'admin')").bind(memberId, id, userId)]);
    const row = await c.env.DB.prepare("SELECT created_at FROM families WHERE id = ?").bind(id).first<any>();
    return c.json(success({ id, name, avatarUrl, role: "admin", memberCount: 1, createdAt: row.created_at }), 201);
  });

  app.get("/api/v1/families/:familyId", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId"); await activeUser(c.env, userId); const member = await membership(c.env, familyId, userId);
    const row = await c.env.DB.prepare("SELECT f.*, (SELECT COUNT(*) FROM family_members WHERE family_id = f.id AND status = 'active') member_count FROM families f WHERE f.id = ?").bind(familyId).first<any>();
    if (!row) throw new ApiError("FAMILY_NOT_FOUND", "Family not found", 404);
    return c.json(success({ id: row.id, name: row.name, avatarUrl: row.avatar_url, status: row.status, createdBy: row.created_by, currentUserRole: member.role, memberCount: row.member_count, createdAt: row.created_at }));
  });

  app.patch("/api/v1/families/:familyId", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId"); await activeUser(c.env, userId); await admin(c.env, familyId, userId); const input = await body(c);
    const name = input.name === undefined ? undefined : requireString(input.name, "name"); const avatarUrl = optionalUrl(input.avatarUrl, "avatarUrl");
    await c.env.DB.prepare("UPDATE families SET name = COALESCE(?, name), avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(name ?? null, avatarUrl !== undefined ? 1 : 0, avatarUrl ?? null, familyId).run();
    const row = await c.env.DB.prepare("SELECT * FROM families WHERE id = ?").bind(familyId).first<any>(); return c.json(success({ id: row.id, name: row.name, avatarUrl: row.avatar_url, status: row.status }));
  });

  app.get("/api/v1/families/:familyId/members", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId"); await activeUser(c.env, userId); await membership(c.env, familyId, userId);
    const rows = await c.env.DB.prepare("SELECT u.id user_id, u.display_name, u.avatar_url, fm.role, fm.joined_at FROM family_members fm JOIN users u ON u.id = fm.user_id WHERE fm.family_id = ? AND fm.status = 'active' ORDER BY fm.joined_at").bind(familyId).all<any>();
    return c.json(success({ items: rows.results.map((r) => ({ userId: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url, role: r.role, joinedAt: r.joined_at })) }));
  });

  app.patch("/api/v1/families/:familyId/members/:userId", async (c) => {
    const familyId = c.req.param("familyId"), actor = c.get("currentUserId"), target = c.req.param("userId"); await activeUser(c.env, actor); await admin(c.env, familyId, actor); const targetMember = await membership(c.env, familyId, target); const input = await body(c);
    if (!['admin', 'member'].includes(input.role as string)) throw new ApiError("INVALID_REQUEST", "role is invalid", 400);
    if (targetMember.role === 'admin' && input.role === 'member') { const count = await c.env.DB.prepare("SELECT COUNT(*) count FROM family_members WHERE family_id = ? AND status = 'active' AND role = 'admin'").bind(familyId).first<{ count: number }>(); if ((count?.count ?? 0) <= 1) throw new ApiError("LAST_ADMIN_CANNOT_BE_REMOVED", "The last administrator cannot be demoted", 409); }
    await c.env.DB.prepare("UPDATE family_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE family_id = ? AND user_id = ?").bind(input.role, familyId, target).run(); return c.json(success({ userId: target, role: input.role }));
  });

  async function removeMember(c: any, familyId: string, actor: string, target: string, selfLeave: boolean): Promise<Response> {
    await activeUser(c.env, actor); if (!selfLeave) { await admin(c.env, familyId, actor); if (actor === target) throw new ApiError("CANNOT_REMOVE_SELF", "Use the leave endpoint to leave a family", 409); } const targetMember = await membership(c.env, familyId, target);
    if (targetMember.role === 'admin') { const count = await c.env.DB.prepare("SELECT COUNT(*) count FROM family_members WHERE family_id = ? AND status = 'active' AND role = 'admin'").bind(familyId).first() as { count: number } | null; if ((count?.count ?? 0) <= 1) throw new ApiError("LAST_ADMIN_CANNOT_BE_REMOVED", "The last administrator cannot leave or be removed", 409); }
    await c.env.DB.prepare("UPDATE family_members SET status = 'removed', removed_at = CURRENT_TIMESTAMP, removed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE family_id = ? AND user_id = ?").bind(selfLeave ? target : actor, familyId, target).run(); return c.body(null, 204);
  }
  app.delete("/api/v1/families/:familyId/members/:userId", (c) => removeMember(c, c.req.param("familyId"), c.get("currentUserId"), c.req.param("userId"), false));
  app.post("/api/v1/families/:familyId/leave", (c) => removeMember(c, c.req.param("familyId"), c.get("currentUserId"), c.get("currentUserId"), true));

  app.post("/api/v1/families/:familyId/invites", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId"); await activeUser(c.env, userId); await admin(c.env, familyId, userId); const input = await body(c); const expiresInMinutes = positiveInteger(input.expiresInMinutes, "expiresInMinutes", 1440, 43_200); const maxUses = positiveInteger(input.maxUses, "maxUses", 8, 8); const code = createInviteCode(), id = createId("inv"), expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
    await c.env.DB.prepare("INSERT INTO family_invites (id, family_id, code_hash, code_prefix, expires_at, max_uses, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, familyId, await hashCode(code), code.slice(0, 7), expiresAt, maxUses, userId).run();
    return c.json(success({ id, code, joinPath: `pages/family/join?code=${code}`, expiresAt, maxUses, usedCount: 0 }), 201);
  });

  app.get("/api/v1/families/:familyId/invites", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId"); await activeUser(c.env, userId); await admin(c.env, familyId, userId); const rows = await c.env.DB.prepare("SELECT * FROM family_invites WHERE family_id = ? ORDER BY created_at DESC").bind(familyId).all<any>();
    return c.json(success({ items: rows.results.map((i) => ({ id: i.id, status: inviteStatus(i), expiresAt: i.expires_at, maxUses: i.max_uses, usedCount: i.used_count, createdBy: i.created_by, createdAt: i.created_at })) }));
  });

  app.post("/api/v1/families/:familyId/invites/:inviteId/revoke", async (c) => {
    const familyId = c.req.param("familyId"), userId = c.get("currentUserId"); await activeUser(c.env, userId); await admin(c.env, familyId, userId); const result = await c.env.DB.prepare("UPDATE family_invites SET status = 'revoked', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND family_id = ?").bind(userId, c.req.param("inviteId"), familyId).run(); if (!result.meta.changes) throw new ApiError("INVITE_NOT_FOUND", "Invite not found", 404); return c.body(null, 204);
  });

  async function findInvite(env: Bindings, code: string): Promise<any> { const invite = await env.DB.prepare("SELECT i.*, f.name family_name, f.avatar_url family_avatar, f.status family_status, (SELECT COUNT(*) FROM family_members WHERE family_id = f.id AND status = 'active') member_count FROM family_invites i JOIN families f ON f.id = i.family_id WHERE i.code_hash = ?").bind(await hashCode(code)).first<any>(); if (!invite) throw new ApiError("INVITE_NOT_FOUND", "Invite not found", 404); return invite; }
  function assertInvite(invite: any): void { const status = inviteStatus(invite); if (status === 'revoked') throw new ApiError("INVITE_REVOKED", "Invite has been revoked", 409); if (status === 'expired') throw new ApiError("INVITE_EXPIRED", "Invite has expired", 409); if (status === 'exhausted') throw new ApiError("INVITE_EXHAUSTED", "Invite is exhausted", 409); }

  app.get("/api/v1/family-invites/:code", async (c) => { const userId = c.get("currentUserId"); await activeUser(c.env, userId); const i = await findInvite(c.env, c.req.param("code")); const valid = inviteStatus(i) === 'active'; return c.json(success({ family: { id: i.family_id, name: i.family_name, avatarUrl: i.family_avatar, memberCount: i.member_count }, expiresAt: i.expires_at, canJoin: valid && i.member_count < 8 })); });

  app.post("/api/v1/family-invites/:code/join", async (c) => {
    const userId = c.get("currentUserId"); await activeUser(c.env, userId); const invite = await findInvite(c.env, c.req.param("code")); assertInvite(invite); const existing = await c.env.DB.prepare("SELECT * FROM family_members WHERE family_id = ? AND user_id = ?").bind(invite.family_id, userId).first<any>(); if (existing?.status === 'active') throw new ApiError("ALREADY_FAMILY_MEMBER", "User is already a family member", 409); if (invite.member_count >= 8) throw new ApiError("FAMILY_MEMBER_LIMIT_REACHED", "Family member limit reached", 409); const joinedAt = new Date().toISOString();
    const memberStatement = existing ? c.env.DB.prepare("UPDATE family_members SET role = 'member', status = 'active', joined_at = ?, removed_at = NULL, removed_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(joinedAt, existing.id) : c.env.DB.prepare("INSERT INTO family_members (id, family_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)").bind(createId("fmem"), invite.family_id, userId, joinedAt);
    const increment = c.env.DB.prepare("UPDATE family_invites SET used_count = used_count + 1, status = CASE WHEN used_count + 1 >= max_uses THEN 'exhausted' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active' AND used_count < max_uses").bind(invite.id);
    await c.env.DB.batch([memberStatement, increment]); return c.json(success({ familyId: invite.family_id, familyName: invite.family_name, role: "member", joinedAt }));
  });
}
