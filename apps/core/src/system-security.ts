import type { Bindings } from "./env";
import { ApiError } from "./errors";

export const SYSTEM_PERMISSIONS = ["family:read", "events:read", "events:write", "tasks:read", "tasks:write"] as const;
export type SystemPermission = typeof SYSTEM_PERMISSIONS[number];

export function parsePermissions(value: unknown): SystemPermission[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) {
    throw new ApiError("INVALID_PERMISSIONS", "permissions must be a unique array", 400);
  }
  const permissions = SYSTEM_PERMISSIONS.filter((permission) => value.includes(permission));
  if (permissions.length !== value.length || (permissions.includes("events:write") && !permissions.includes("events:read")) || (permissions.includes("tasks:write") && !permissions.includes("tasks:read"))) {
    throw new ApiError("INVALID_PERMISSIONS", "permissions are invalid", 400);
  }
  return permissions;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomCredential(prefix: "hmw_pat" | "hmw_cs"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${prefix}_${value}`;
}

export async function requireSystemAccess(env: Bindings, principal: { id: string; scopes: string[]; credentialId?: string; tokenId?: string }, familyId: string, permission: SystemPermission): Promise<void> {
  const row = await env.DB.prepare(`SELECT s.status system_status,s.deleted_at,a.status access_status,a.permissions,
      c.status credential_status,c.revoked_at,c.expires_at
    FROM system_identities s
    JOIN family_system_access a ON a.system_id=s.id AND a.family_id=?
    LEFT JOIN system_credentials c ON c.id=? AND c.system_id=s.id
    WHERE s.id=?`).bind(familyId, principal.credentialId ?? "", principal.id).first<any>();
  if (!row || row.system_status !== "active" || row.deleted_at || row.access_status !== "active") throw new ApiError("SYSTEM_ACCESS_DENIED", "System access is disabled", 403);
  if (principal.credentialId && (row.credential_status !== "active" || row.revoked_at || (row.expires_at && row.expires_at <= new Date().toISOString()))) throw new ApiError("CREDENTIAL_REVOKED", "Credential is revoked", 401);
  if (principal.tokenId) {
    const issued=await env.DB.prepare("SELECT jti FROM oauth_access_tokens WHERE jti=? AND system_id=? AND credential_id=? AND expires_at>?").bind(principal.tokenId,principal.id,principal.credentialId,Math.floor(Date.now()/1000)).first();
    if(!issued)throw new ApiError("UNAUTHORIZED","System access token was not issued by Core",401);
  }
  const current = JSON.parse(row.permissions) as string[];
  if (!principal.scopes.includes(permission) || !current.includes(permission)) throw new ApiError("SYSTEM_PERMISSION_DENIED", "System permission is required", 403);
  await env.DB.prepare("UPDATE system_identities SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(principal.id).run();
  if (principal.credentialId) await env.DB.prepare("UPDATE system_credentials SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(principal.credentialId).run();
}
