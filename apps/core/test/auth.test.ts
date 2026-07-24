import { describe, expect, it } from "vitest";
import { verifyJwt } from "../src/auth";

const secret = "test-secret-at-least-32-characters";

function encode(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function token(payload: Record<string, unknown>, signingSecret = secret): Promise<string> {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const encodedSignature = btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${body}.${encodedSignature}`;
}

describe("HS256 JWT verification", () => {
  it("accepts a valid user subject", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyJwt(await token({ sub: "usr_valid", type: "user", iss: "homemew-identity", aud: "homemew-core", iat: now, exp: now + 3600 }), secret)).resolves.toEqual({
      userId: "usr_valid",
      scopes: [],
      type: "user",
    });
  });

  it("extracts internal scope", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyJwt(await token({ sub: "svc_identity", type: "service", scope: "internal", iss: "homemew-identity", aud: "homemew-core-internal", iat: now, exp: now + 3600 }), secret)).resolves.toEqual({
      userId: "svc_identity",
      scopes: ["internal"],
      type: "service",
    });
  });

  it("accepts only credential-bound system JWTs", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: "sys_valid", type: "system", scope: "events:read", iss: "homemew-identity", aud: "homemew-core", iat: now, exp: now + 3600 };
    await expect(verifyJwt(await token({ ...claims, cid: "crd_valid", jti: "tok_valid" }), secret)).resolves.toEqual({
      userId: "sys_valid", scopes: ["events:read"], type: "system", credentialId: "crd_valid", tokenId: "tok_valid",
    });
    await expect(verifyJwt(await token(claims), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects an invalid signature", async () => {
    await expect(verifyJwt(await token({ sub: "usr_valid" }, "wrong-secret-at-least-32-characters"), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects expired or subjectless tokens", async () => {
    await expect(verifyJwt(await token({ sub: "usr_valid", exp: 1 }), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(verifyJwt(await token({ exp: 4_102_444_800 }), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects missing or mismatched required claims and excessive lifetimes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = { sub: "usr_valid", type: "user", iss: "homemew-identity", aud: "homemew-core", iat: now, exp: now + 3600 };
    for (const payload of [
      { ...valid, exp: undefined },
      { ...valid, iat: undefined },
      { ...valid, iss: "other" },
      { ...valid, aud: "homemew-core-internal" },
      { ...valid, type: "service" },
      { ...valid, iat: now + 60 },
      { ...valid, exp: now + 3601 },
    ]) {
      await expect(verifyJwt(await token(payload), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });
});
