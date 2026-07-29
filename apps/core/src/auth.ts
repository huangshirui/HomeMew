import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";

type AppEnv = { Bindings: Bindings; Variables: Variables };

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function unauthorized(): ApiError {
  return new ApiError("UNAUTHORIZED", "Authentication is required", 401);
}

type TokenType = "user" | "system" | "service";

export async function verifyJwt(rawToken: string, secret: string): Promise<{ userId: string; scopes: string[]; type: TokenType; credentialId?: string; tokenId?: string }> {
  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = rawToken.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) throw unauthorized();
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as { alg?: unknown };
    if (header.alg !== "HS256") throw unauthorized();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
    if (!valid) throw unauthorized();
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as Record<string, unknown>;
    if (typeof payload.sub !== "string" || payload.sub.trim() === "") throw unauthorized();
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.iat !== "number" || !Number.isInteger(payload.iat) || payload.iat > now) throw unauthorized();
    if (typeof payload.exp !== "number" || !Number.isInteger(payload.exp) || payload.exp <= now || payload.exp <= payload.iat || payload.exp - payload.iat > 3600) throw unauthorized();
    if (payload.iss !== "homemew-identity") throw unauthorized();
    if (payload.type !== "user" && payload.type !== "system" && payload.type !== "service") throw unauthorized();
    const expectedAudience = payload.type === "service" ? "homemew-core-internal" : "homemew-core";
    if (payload.aud !== expectedAudience) throw unauthorized();
    if (payload.type === "system" && (typeof payload.cid !== "string" || !payload.cid.startsWith("crd_") || typeof payload.jti !== "string" || !payload.jti.startsWith("tok_"))) throw unauthorized();
    const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
    if (payload.type === "system") {
      const allowed = ["family:read","events:read","events:write","tasks:read","tasks:write"];
      if (scopes.some((scope) => !allowed.includes(scope)) || (scopes.includes("events:write") && !scopes.includes("events:read")) || (scopes.includes("tasks:write") && !scopes.includes("tasks:read"))) throw unauthorized();
    }
    return { userId: payload.sub, scopes, type: payload.type, ...(payload.type === "system" ? { credentialId: payload.cid as string, tokenId: payload.jti as string } : {}) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unauthorized();
  }
}

export function authenticate(): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) throw unauthorized();
    if (!context.env.JWT_SECRET) throw unauthorized();
    const raw = authorization.slice(7);
    let auth: Awaited<ReturnType<typeof verifyJwt>>;
    if (raw.startsWith("hmw_pat_")) {
      const hash = await (await import("./system-security")).sha256(raw);
      const row = await context.env.DB.prepare(`SELECT c.id credential_id,c.system_id,s.status,s.deleted_at,a.permissions
        FROM system_credentials c JOIN system_identities s ON s.id=c.system_id
        JOIN family_system_access a ON a.system_id=s.id
        WHERE c.secret_hash=? AND c.credential_type='api_token' AND c.status='active' AND c.revoked_at IS NULL
          AND (c.expires_at IS NULL OR julianday(c.expires_at)>julianday('now'))`).bind(hash).first<any>();
      if (!row || row.status !== "active" || row.deleted_at) throw unauthorized();
      auth = { userId: row.system_id, scopes: JSON.parse(row.permissions), type: "system", credentialId: row.credential_id };
    } else {
      auth = await verifyJwt(raw, context.env.JWT_SECRET);
    }
    context.set("currentUserId", auth.userId);
    context.set("authScopes", auth.scopes);
    context.set("authType", auth.type);
    context.set("currentPrincipal", { type: auth.type, id: auth.userId, scopes: auth.scopes, credentialId: auth.credentialId, tokenId: auth.tokenId });
    let failed=false;
    try { await next(); } catch(error) { failed=true; throw error; } finally {
      const familyId=context.req.path.match(/^\/api\/v1\/families\/([^/]+)/)?.[1];
      console.info("Core authenticated request",{requestId:context.get("requestId"),principalType:auth.type,principalId:auth.userId,credentialId:auth.credentialId,familyId,method:context.req.method,path:context.req.path,status:failed?"exception":context.res.status});
    }
  };
}

export function requireInternal(): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    if (context.get("authType") !== "service" || !context.get("authScopes").includes("internal")) {
      throw new ApiError("FORBIDDEN", "Internal scope is required", 403);
    }
    await next();
  };
}
