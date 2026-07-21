import type { Bindings } from "./env";
import { ApiError } from "./errors";

export type UserRow = { id: string; display_name: string; avatar_url: string | null; status: string };
export type MemberRow = { id: string; family_id: string; user_id: string; role: "admin" | "member"; status: string };

export async function requireActiveUser(env: Bindings, userId: string): Promise<UserRow> {
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
  if (!user) throw new ApiError("USER_NOT_FOUND", "User not found", 404);
  if (user.status !== "active") throw new ApiError("FORBIDDEN", "User is disabled", 403);
  return user;
}

export async function requireFamilyMember(env: Bindings, familyId: string, userId: string): Promise<MemberRow> {
  const row = await env.DB.prepare("SELECT * FROM family_members WHERE family_id = ? AND user_id = ? AND status = 'active'").bind(familyId, userId).first<MemberRow>();
  if (!row) throw new ApiError("FORBIDDEN", "Active family membership is required", 403);
  return row;
}

export async function requireFamilyAdmin(env: Bindings, familyId: string, userId: string): Promise<MemberRow> {
  const row = await requireFamilyMember(env, familyId, userId);
  if (row.role !== "admin") throw new ApiError("FORBIDDEN", "Family administrator access is required", 403);
  return row;
}

export async function requireRelatedMembers(env: Bindings, familyId: string, userIds: string[], kind: "attendee" | "assignee"): Promise<void> {
  if (userIds.length === 0) return;
  const placeholders = userIds.map(() => "?").join(",");
  const result = await env.DB.prepare(`SELECT user_id FROM family_members WHERE family_id = ? AND status = 'active' AND user_id IN (${placeholders})`).bind(familyId, ...userIds).all<{ user_id: string }>();
  if (result.results.length !== userIds.length) {
    throw new ApiError(kind === "attendee" ? "ATTENDEE_NOT_FAMILY_MEMBER" : "ASSIGNEE_NOT_FAMILY_MEMBER", `${kind} must be an active family member`, 400);
  }
}
