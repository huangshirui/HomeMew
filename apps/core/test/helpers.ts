import { env } from "cloudflare:workers";
import type { Bindings } from "../src/env";

export const jwtSecret = "test-secret-at-least-32-characters";
export const bindings: Bindings = {
  DB: env.DB,
  AVATARS: env.AVATARS,
  ASSETS_PUBLIC_URL: "https://assets.test.example",
  JWT_SECRET: jwtSecret,
};

function encode(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function makeToken(sub: string, scope?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const service = scope !== undefined;
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub,
    scope,
    type: service ? "service" : "user",
    iss: "homemew-identity",
    aud: service ? "homemew-core-internal" : "homemew-core",
    iat: now,
    exp: now + 3600,
  })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const encoded = btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${body}.${encoded}`;
}

export async function request(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const app = (await import("../src/index")).default;
  return app.request(path, { ...init, headers }, bindings);
}

export async function createUser(displayName: string): Promise<{ id: string; token: string }> {
  const internalToken = await makeToken("svc_test", "internal");
  const response = await request("/api/v1/internal/users", internalToken, {
    method: "POST",
    body: JSON.stringify({ displayName, createdFrom: "other" }),
  });
  const body = await response.json<{ data: { id: string } }>();
  return { id: body.data.id, token: await makeToken(body.data.id) };
}

export async function createFamily(name = "Test Family"): Promise<{ id: string; admin: { id: string; token: string } }> {
  const admin = await createUser(`${name} Admin`);
  const response = await request("/api/v1/families", admin.token, { method: "POST", body: JSON.stringify({ name }) });
  const payload = await response.json<{ data: { id: string } }>();
  return { id: payload.data.id, admin };
}
