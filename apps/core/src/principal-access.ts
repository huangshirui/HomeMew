import type { Bindings, Variables } from "./env";
import { requireActiveUser, requireFamilyMember } from "./family-access";
import { requireSystemAccess, type SystemPermission } from "./system-security";

export async function requireFamilyCapability(env: Bindings, principal: Variables["currentPrincipal"], familyId: string, permission: SystemPermission) {
  if (principal.type === "user") {
    await requireActiveUser(env, principal.id);
    return requireFamilyMember(env, familyId, principal.id);
  }
  if (principal.type === "system") {
    await requireSystemAccess(env, principal, familyId, permission);
    return null;
  }
  throw new (await import("./errors")).ApiError("FORBIDDEN", "Service identities cannot access family APIs", 403);
}

export function actor(principal: Variables["currentPrincipal"]) {
  return { type: principal.type, id: principal.id };
}

export async function mapActor(env: Bindings, type: string | null, id: string | null) {
  if (!type || !id) return null;
  if (type === "user") {
    const row = await env.DB.prepare("SELECT display_name,avatar_key FROM users WHERE id=?").bind(id).first<any>();
    const { avatarUrl } = await import("./avatar");
    return { type, id, name: row?.display_name ?? "", avatarUrl: avatarUrl(env, row?.avatar_key) };
  }
  const row = await env.DB.prepare("SELECT name FROM system_identities WHERE id=?").bind(id).first<any>();
  return { type, id, name: row?.name ?? "", avatarUrl: null };
}
