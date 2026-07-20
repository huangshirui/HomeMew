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

export async function verifyJwt(rawToken: string, secret: string): Promise<{ userId: string; scopes: string[] }> {
  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = rawToken.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) throw unauthorized();
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as { alg?: unknown };
    if (header.alg !== "HS256") throw unauthorized();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
    if (!valid) throw unauthorized();
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as { sub?: unknown; exp?: unknown; scope?: unknown };
    if (typeof payload.sub !== "string" || payload.sub.trim() === "") throw unauthorized();
    if (payload.exp !== undefined && (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000))) throw unauthorized();
    const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
    return { userId: payload.sub, scopes };
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
    const auth = await verifyJwt(authorization.slice(7), context.env.JWT_SECRET);
    context.set("currentUserId", auth.userId);
    context.set("authScopes", auth.scopes);
    await next();
  };
}

export function requireInternal(): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    if (!context.get("authScopes").includes("internal")) {
      throw new ApiError("FORBIDDEN", "Internal scope is required", 403);
    }
    await next();
  };
}
