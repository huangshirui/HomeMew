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
    await expect(verifyJwt(await token({ sub: "usr_valid", exp: 4_102_444_800 }), secret)).resolves.toEqual({
      userId: "usr_valid",
      scopes: [],
    });
  });

  it("extracts internal scope", async () => {
    await expect(verifyJwt(await token({ sub: "svc_identity", scope: "internal", exp: 4_102_444_800 }), secret)).resolves.toEqual({
      userId: "svc_identity",
      scopes: ["internal"],
    });
  });

  it("rejects an invalid signature", async () => {
    await expect(verifyJwt(await token({ sub: "usr_valid" }, "wrong-secret-at-least-32-characters"), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects expired or subjectless tokens", async () => {
    await expect(verifyJwt(await token({ sub: "usr_valid", exp: 1 }), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(verifyJwt(await token({ exp: 4_102_444_800 }), secret)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
