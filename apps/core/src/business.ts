import type { Context, Hono } from "hono";
import { authenticate, requireInternal } from "./auth";
import { avatarUrl, parseAvatarFile, storeAvatar, storeFamilyAvatar } from "./avatar";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireActiveUser as activeUser, requireFamilyAdmin as admin, requireFamilyMember as membership } from "./family-access";
import { success } from "./http";
import { createId, createInviteCode } from "./ids";
import { positiveInteger, requireObject, requireString, timezone } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;

async function body(context: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    return requireObject(await context.req.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
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

function userProfile(env: Bindings, row: any) {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: avatarUrl(env, row.avatar_key),
    status: row.status,
  };
}

export function registerBusinessRoutes(app: App): void {
  app.use("/api/v1/*", authenticate());

  app.post("/api/v1/internal/users", requireInternal(), async (c) => {
    const input = await body(c);
    const displayName = requireString(input.displayName, "displayName");
    const createdFrom = input.createdFrom;
    if (!["wechat_miniprogram", "wecom", "admin", "other"].includes(createdFrom as string)) {
      throw new ApiError("INVALID_REQUEST", "createdFrom is invalid", 400);
    }

    const id = createId("usr");
    await c.env.DB.prepare("INSERT INTO users (id, display_name, created_from) VALUES (?, ?, ?)")
      .bind(id, displayName, createdFrom)
      .run();
    const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<any>();
    return c.json(success({ ...userProfile(c.env, row), createdFrom: row.created_from, createdAt: row.created_at }), 201);
  });

  app.get("/api/v1/me", async (c) => {
    const row = await activeUser(c.env, c.get("currentUserId"));
    return c.json(success(userProfile(c.env, row)));
  });

  app.patch("/api/v1/me", async (c) => {
    const id = c.get("currentUserId");
    await activeUser(c.env, id);
    const input = await body(c);
    const displayName = input.displayName === undefined ? undefined : requireString(input.displayName, "displayName");
    if (displayName === undefined) throw new ApiError("INVALID_REQUEST", "No supported fields supplied", 400);

    await c.env.DB.prepare("UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(displayName, id)
      .run();
    const row = await activeUser(c.env, id);
    return c.json(success(userProfile(c.env, row)));
  });

  app.put("/api/v1/me/avatar", async (c) => {
    const id = c.get("currentUserId");
    const previous = await activeUser(c.env, id);
    const file = await parseAvatarFile(c.req.raw);
    const stored = await storeAvatar(c.env, id, file);

    try {
      await c.env.DB.prepare("UPDATE users SET avatar_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(stored.key, id)
        .run();
    } catch (error) {
      await c.env.AVATARS.delete(stored.key).catch(() => undefined);
      throw error;
    }

    const oldKey = previous.avatar_key as string | null;
    if (oldKey && oldKey !== stored.key && oldKey.startsWith(`avatars/${id}/`)) {
      await c.env.AVATARS.delete(oldKey).catch(() => undefined);
    }

    return c.json(success({ avatarUrl: stored.url }));
  });

  app.get("/api/v1/me/families", async (c) => {
    const id = c.get("currentUserId");
    await activeUser(c.env, id);
    const rows = await c.env.DB.prepare(`SELECT f.id, f.name, f.avatar_key, f.timezone, fm.role, COUNT(active.id) member_count FROM family_members fm JOIN families f ON f.id = fm.family_id LEFT JOIN family_members active ON active.family_id = f.id AND active.status = 'active' WHERE fm.user_id = ? AND fm.status = 'active' AND f.status = 'active' GROUP BY f.id, fm.role ORDER BY fm.joined_at`).bind(id).all<any>();
    return c.json(success({ items: rows.results.map((row) => ({ id: row.id, name: row.name, avatarUrl: avatarUrl(c.env, row.avatar_key), timezone: row.timezone, role: row.role, memberCount: row.member_count })) }));
  });

  app.post("/api/v1/families", async (c) => {
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    const input = await body(c);
    if (Object.keys(input).some((field) => !["name", "timezone"].includes(field))) {
      throw new ApiError("INVALID_REQUEST", "Only name and timezone may be supplied", 400);
    }
    const name = requireString(input.name, "name");
    const familyTimezone = input.timezone === undefined ? "Asia/Shanghai" : timezone(input.timezone);
    const count = await c.env.DB.prepare("SELECT COUNT(*) count FROM families WHERE created_by = ? AND status = 'active'").bind(userId).first<{ count: number }>();
    if ((count?.count ?? 0) >= 3) throw new ApiError("FAMILY_CREATE_LIMIT_REACHED", "Active family creation limit reached", 409);

    const id = createId("fam");
    const memberId = createId("fmem");
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO families (id, name, timezone, created_by) VALUES (?, ?, ?, ?)").bind(id, name, familyTimezone, userId),
      c.env.DB.prepare("INSERT INTO family_members (id, family_id, user_id, role) VALUES (?, ?, ?, 'admin')").bind(memberId, id, userId),
    ]);
    const row = await c.env.DB.prepare("SELECT created_at FROM families WHERE id = ?").bind(id).first<any>();
    return c.json(success({ id, name, avatarUrl: null, timezone: familyTimezone, role: "admin", memberCount: 1, createdAt: row.created_at }), 201);
  });

  app.get("/api/v1/families/:familyId", async (c) => {
    const familyId = c.req.param("familyId");
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    const member = await membership(c.env, familyId, userId);
    const row = await c.env.DB.prepare("SELECT f.*, (SELECT COUNT(*) FROM family_members WHERE family_id = f.id AND status = 'active') member_count FROM families f WHERE f.id = ?").bind(familyId).first<any>();
    if (!row) throw new ApiError("FAMILY_NOT_FOUND", "Family not found", 404);
    return c.json(success({ id: row.id, name: row.name, avatarUrl: avatarUrl(c.env, row.avatar_key), timezone: row.timezone, status: row.status, createdBy: row.created_by, currentUserRole: member.role, memberCount: row.member_count, createdAt: row.created_at }));
  });

  app.patch("/api/v1/families/:familyId", async (c) => {
    const familyId = c.req.param("familyId");
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    await admin(c.env, familyId, userId);
    const input = await body(c);
    const name = input.name === undefined ? undefined : requireString(input.name, "name");
    const familyTimezone = input.timezone === undefined ? undefined : timezone(input.timezone);
    if (Object.keys(input).some((field) => !["name", "timezone"].includes(field)) || (name === undefined && familyTimezone === undefined)) {
      throw new ApiError("INVALID_REQUEST", "Only name and timezone may be supplied", 400);
    }
    await c.env.DB.prepare("UPDATE families SET name = COALESCE(?, name), timezone = COALESCE(?, timezone), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(name ?? null, familyTimezone ?? null, familyId)
      .run();
    const row = await c.env.DB.prepare("SELECT * FROM families WHERE id = ?").bind(familyId).first<any>();
    return c.json(success({ id: row.id, name: row.name, avatarUrl: avatarUrl(c.env, row.avatar_key), timezone: row.timezone, status: row.status }));
  });

  app.put("/api/v1/families/:familyId/avatar", async (c) => {
    const familyId = c.req.param("familyId");
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    await admin(c.env, familyId, userId);
    const previous = await c.env.DB.prepare("SELECT avatar_key FROM families WHERE id = ?")
      .bind(familyId)
      .first<{ avatar_key: string | null }>();
    const file = await parseAvatarFile(c.req.raw);
    const stored = await storeFamilyAvatar(c.env, familyId, file);

    try {
      await c.env.DB.prepare("UPDATE families SET avatar_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(stored.key, familyId)
        .run();
    } catch (error) {
      await c.env.AVATARS.delete(stored.key).catch(() => undefined);
      throw error;
    }

    const oldKey = previous?.avatar_key;
    if (oldKey && oldKey !== stored.key && oldKey.startsWith(`avatars/families/${familyId}/`)) {
      await c.env.AVATARS.delete(oldKey).catch(() => undefined);
    }

    return c.json(success({ avatarUrl: stored.url }));
  });

  app.get("/api/v1/families/:familyId/members", async (c) => {
    const familyId = c.req.param("familyId");
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    await membership(c.env, familyId, userId);
    const rows = await c.env.DB.prepare("SELECT u.id user_id, u.display_name, u.avatar_key, fm.role, fm.joined_at FROM family_members fm JOIN users u ON u.id = fm.user_id WHERE fm.family_id = ? AND fm.status = 'active' ORDER BY fm.joined_at").bind(familyId).all<any>();
    return c.json(success({ items: rows.results.map((row) => ({ userId: row.user_id, displayName: row.display_name, avatarUrl: avatarUrl(c.env, row.avatar_key), role: row.role, joinedAt: row.joined_at })) }));
  });

  app.patch("/api/v1/families/:familyId/members/:userId", async (c) => {
    const familyId = c.req.param("familyId");
    const actor = c.get("currentUserId");
    const target = c.req.param("userId");
    await activeUser(c.env, actor);
    await admin(c.env, familyId, actor);
    const targetMember = await membership(c.env, familyId, target);
    const input = await body(c);
    if (!["admin", "member"].includes(input.role as string)) throw new ApiError("INVALID_REQUEST", "role is invalid", 400);
    const result = await c.env.DB.prepare(`UPDATE family_members SET role=?, updated_at=CURRENT_TIMESTAMP
      WHERE family_id=? AND user_id=? AND status='active'
      AND (?!='member' OR role!='admin' OR EXISTS (
        SELECT 1 FROM family_members other WHERE other.family_id=? AND other.status='active' AND other.role='admin' AND other.user_id!=?
      ))`).bind(input.role, familyId, target, input.role, familyId, target).run();
    if (!result.meta.changes && targetMember.role === "admin" && input.role === "member") throw new ApiError("LAST_ADMIN_CANNOT_BE_REMOVED", "The last administrator cannot be demoted", 409);
    return c.json(success({ userId: target, role: input.role }));
  });

  async function removeMember(c: Context<AppEnv>, familyId: string, actor: string, target: string, selfLeave: boolean): Promise<Response> {
    await activeUser(c.env, actor);
    if (!selfLeave) {
      await admin(c.env, familyId, actor);
      if (actor === target) throw new ApiError("CANNOT_REMOVE_SELF", "Use the leave endpoint to leave a family", 409);
    }
    const targetMember = await membership(c.env, familyId, target);
    const result = await c.env.DB.prepare(`UPDATE family_members SET status='removed', removed_at=CURRENT_TIMESTAMP, removed_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE family_id=? AND user_id=? AND status='active'
      AND (role!='admin' OR EXISTS (
        SELECT 1 FROM family_members other WHERE other.family_id=? AND other.status='active' AND other.role='admin' AND other.user_id!=?
      ))`).bind(selfLeave ? target : actor, familyId, target, familyId, target).run();
    if (!result.meta.changes && targetMember.role === "admin") throw new ApiError("LAST_ADMIN_CANNOT_BE_REMOVED", "The last administrator cannot leave or be removed", 409);
    return c.body(null, 204);
  }

  app.delete("/api/v1/families/:familyId/members/:userId", (c) => removeMember(c, c.req.param("familyId"), c.get("currentUserId"), c.req.param("userId"), false));
  app.post("/api/v1/families/:familyId/leave", (c) => removeMember(c, c.req.param("familyId"), c.get("currentUserId"), c.get("currentUserId"), true));

  app.post("/api/v1/families/:familyId/invites", async (c) => {
    const familyId = c.req.param("familyId");
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    await admin(c.env, familyId, userId);
    const input = await body(c);
    const expiresInMinutes = positiveInteger(input.expiresInMinutes, "expiresInMinutes", 1440, 43_200);
    const maxUses = positiveInteger(input.maxUses, "maxUses", 8, 8);
    const code = createInviteCode();
    const id = createId("inv");
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
    await c.env.DB.prepare("INSERT INTO family_invites (id, family_id, code_hash, code_prefix, expires_at, max_uses, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, familyId, await hashCode(code), code.slice(0, 7), expiresAt, maxUses, userId).run();
    return c.json(success({ id, code, joinPath: `pages/family/join?code=${code}`, expiresAt, maxUses, usedCount: 0 }), 201);
  });

  app.get("/api/v1/families/:familyId/invites", async (c) => {
    const familyId = c.req.param("familyId");
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    await admin(c.env, familyId, userId);
    const rows = await c.env.DB.prepare("SELECT * FROM family_invites WHERE family_id = ? ORDER BY created_at DESC").bind(familyId).all<any>();
    return c.json(success({ items: rows.results.map((invite) => ({ id: invite.id, status: inviteStatus(invite), expiresAt: invite.expires_at, maxUses: invite.max_uses, usedCount: invite.used_count, createdBy: invite.created_by, createdAt: invite.created_at })) }));
  });

  app.post("/api/v1/families/:familyId/invites/:inviteId/revoke", async (c) => {
    const familyId = c.req.param("familyId");
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    await admin(c.env, familyId, userId);
    const result = await c.env.DB.prepare("UPDATE family_invites SET status = 'revoked', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND family_id = ?").bind(userId, c.req.param("inviteId"), familyId).run();
    if (!result.meta.changes) throw new ApiError("INVITE_NOT_FOUND", "Invite not found", 404);
    return c.body(null, 204);
  });

  async function findInvite(env: Bindings, code: string): Promise<any> {
    const invite = await env.DB.prepare("SELECT i.*, f.name family_name, f.avatar_key family_avatar_key, f.status family_status, (SELECT COUNT(*) FROM family_members WHERE family_id = f.id AND status = 'active') member_count FROM family_invites i JOIN families f ON f.id = i.family_id WHERE i.code_hash = ?").bind(await hashCode(code)).first<any>();
    if (!invite) throw new ApiError("INVITE_NOT_FOUND", "Invite not found", 404);
    return invite;
  }

  function assertInvite(invite: any): void {
    const status = inviteStatus(invite);
    if (status === "revoked") throw new ApiError("INVITE_REVOKED", "Invite has been revoked", 409);
    if (status === "expired") throw new ApiError("INVITE_EXPIRED", "Invite has expired", 409);
    if (status === "exhausted") throw new ApiError("INVITE_EXHAUSTED", "Invite is exhausted", 409);
  }

  app.get("/api/v1/family-invites/:code", async (c) => {
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    const invite = await findInvite(c.env, c.req.param("code"));
    const valid = inviteStatus(invite) === "active";
    return c.json(success({ family: { id: invite.family_id, name: invite.family_name, avatarUrl: avatarUrl(c.env, invite.family_avatar_key), memberCount: invite.member_count }, expiresAt: invite.expires_at, canJoin: valid && invite.member_count < 8 }));
  });

  app.post("/api/v1/family-invites/:code/join", async (c) => {
    const userId = c.get("currentUserId");
    await activeUser(c.env, userId);
    const invite = await findInvite(c.env, c.req.param("code"));
    assertInvite(invite);
    const existing = await c.env.DB.prepare("SELECT * FROM family_members WHERE family_id = ? AND user_id = ?").bind(invite.family_id, userId).first<any>();
    if (existing?.status === "active") throw new ApiError("ALREADY_FAMILY_MEMBER", "User is already a family member", 409);
    if (invite.member_count >= 8) throw new ApiError("FAMILY_MEMBER_LIMIT_REACHED", "Family member limit reached", 409);
    const joinedAt = new Date().toISOString();
    const redemptionId = createId("ired");
    const memberStatement = existing
      ? c.env.DB.prepare("UPDATE family_members SET role='member',status='active',joined_at=?,removed_at=NULL,removed_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS (SELECT 1 FROM family_invite_redemptions WHERE id=?)").bind(joinedAt, existing.id, redemptionId)
      : c.env.DB.prepare("INSERT INTO family_members (id,family_id,user_id,role,joined_at) SELECT ?,?,?, 'member',? WHERE EXISTS (SELECT 1 FROM family_invite_redemptions WHERE id=?)").bind(createId("fmem"), invite.family_id, userId, joinedAt, redemptionId);
    const redemption = c.env.DB.prepare(`INSERT INTO family_invite_redemptions (id,invite_id,family_id,user_id)
      SELECT ?,i.id,i.family_id,? FROM family_invites i JOIN families f ON f.id=i.family_id
      WHERE i.id=? AND i.status='active' AND i.used_count<i.max_uses AND datetime(i.expires_at)>CURRENT_TIMESTAMP AND f.status='active'
      AND (SELECT COUNT(*) FROM family_members WHERE family_id=i.family_id AND status='active')<8
      AND NOT EXISTS (SELECT 1 FROM family_members WHERE family_id=i.family_id AND user_id=? AND status='active')`)
      .bind(redemptionId, userId, invite.id, userId);
    const results = await c.env.DB.batch([redemption, memberStatement]);
    if (!results[0].meta.changes) {
      const current = await findInvite(c.env, c.req.param("code"));
      assertInvite(current);
      if (current.member_count >= 8) throw new ApiError("FAMILY_MEMBER_LIMIT_REACHED", "Family member limit reached", 409);
      throw new ApiError("ALREADY_FAMILY_MEMBER", "User is already a family member", 409);
    }
    return c.json(success({ familyId: invite.family_id, familyName: invite.family_name, role: "member", joinedAt }));
  });
}
