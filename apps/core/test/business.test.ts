import { describe, expect, it } from "vitest";
import { bindings, createUser, makeToken, request } from "./helpers";

describe("user and family API", () => {
  it("requires authentication for business routes", async () => {
    const app = (await import("../src/index")).default;
    const response = await app.request("/api/v1/me", {}, bindings);
    expect(response.status).toBe(401);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("UNAUTHORIZED");
  });

  it("creates an internal user and manages the current profile", async () => {
    const internal = await makeToken("svc", "internal");
    const created = await request("/api/v1/internal/users", internal, {
      method: "POST",
      body: JSON.stringify({ displayName: "KK爸爸", avatarUrl: null, createdFrom: "wechat_miniprogram" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json<{ data: { id: string } }>();

    const token = await makeToken(createdBody.data.id);
    const updated = await request("/api/v1/me", token, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "家事喵用户", avatarUrl: "https://example.com/avatar.jpg" }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json<{ data: { displayName: string } }>()).data.displayName).toBe("家事喵用户");
  });

  it("creates a family with its creator as admin and enforces the creation limit", async () => {
    const user = await createUser("Creator");
    for (let index = 0; index < 3; index += 1) {
      const response = await request("/api/v1/families", user.token, { method: "POST", body: JSON.stringify({ name: `Family ${index}`, avatarUrl: null }) });
      expect(response.status).toBe(201);
      expect((await response.json<{ data: { role: string; memberCount: number } }>()).data).toMatchObject({ role: "admin", memberCount: 1 });
    }
    const fourth = await request("/api/v1/families", user.token, { method: "POST", body: JSON.stringify({ name: "Fourth" }) });
    expect(fourth.status).toBe(409);
    expect((await fourth.json<{ error: { code: string } }>()).error.code).toBe("FAMILY_CREATE_LIMIT_REACHED");
  });

  it("creates an invitation and lets another user join atomically", async () => {
    const admin = await createUser("Admin");
    const member = await createUser("Member");
    const familyResponse = await request("/api/v1/families", admin.token, { method: "POST", body: JSON.stringify({ name: "黄家" }) });
    const family = (await familyResponse.json<{ data: { id: string } }>()).data;
    const inviteResponse = await request(`/api/v1/families/${family.id}/invites`, admin.token, { method: "POST", body: JSON.stringify({ maxUses: 2, expiresInMinutes: 60 }) });
    expect(inviteResponse.status).toBe(201);
    const invite = (await inviteResponse.json<{ data: { code: string; id: string } }>()).data;
    expect(invite.code).toMatch(/^HM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const joined = await request(`/api/v1/family-invites/${invite.code}/join`, member.token, { method: "POST", body: "{}" });
    expect(joined.status).toBe(200);
    expect((await joined.json<{ data: { role: string } }>()).data.role).toBe("member");

    const stored = await bindings.DB.prepare("SELECT code_hash, used_count FROM family_invites WHERE id = ?").bind(invite.id).first<{ code_hash: string; used_count: number }>();
    expect(stored?.code_hash).not.toBe(invite.code);
    expect(stored?.used_count).toBe(1);
  });

  it("enforces member administration and last-admin rules", async () => {
    const adminUser = await createUser("Family Admin");
    const memberUser = await createUser("Family Member");
    const familyResponse = await request("/api/v1/families", adminUser.token, { method: "POST", body: JSON.stringify({ name: "Managed" }) });
    const family = (await familyResponse.json<{ data: { id: string } }>()).data;
    const inviteResponse = await request(`/api/v1/families/${family.id}/invites`, adminUser.token, { method: "POST", body: "{}" });
    const code = (await inviteResponse.json<{ data: { code: string } }>()).data.code;
    await request(`/api/v1/family-invites/${code}/join`, memberUser.token, { method: "POST", body: "{}" });

    const forbidden = await request(`/api/v1/families/${family.id}/invites`, memberUser.token, { method: "POST", body: "{}" });
    expect(forbidden.status).toBe(403);

    const lastAdminLeave = await request(`/api/v1/families/${family.id}/leave`, adminUser.token, { method: "POST" });
    expect(lastAdminLeave.status).toBe(409);
    expect((await lastAdminLeave.json<{ error: { code: string } }>()).error.code).toBe("LAST_ADMIN_CANNOT_BE_REMOVED");

    const promoted = await request(`/api/v1/families/${family.id}/members/${memberUser.id}`, adminUser.token, { method: "PATCH", body: JSON.stringify({ role: "admin" }) });
    expect(promoted.status).toBe(200);
    const left = await request(`/api/v1/families/${family.id}/leave`, adminUser.token, { method: "POST" });
    expect(left.status).toBe(204);
  });

  it("does not consume an invitation for duplicate membership", async () => {
    const adminUser = await createUser("Dup Admin");
    const familyResponse = await request("/api/v1/families", adminUser.token, { method: "POST", body: JSON.stringify({ name: "Duplicate" }) });
    const family = (await familyResponse.json<{ data: { id: string } }>()).data;
    const inviteResponse = await request(`/api/v1/families/${family.id}/invites`, adminUser.token, { method: "POST", body: JSON.stringify({ maxUses: 2 }) });
    const invite = (await inviteResponse.json<{ data: { id: string; code: string } }>()).data;
    const duplicate = await request(`/api/v1/family-invites/${invite.code}/join`, adminUser.token, { method: "POST", body: "{}" });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json<{ error: { code: string } }>()).error.code).toBe("ALREADY_FAMILY_MEMBER");
    const stored = await bindings.DB.prepare("SELECT used_count FROM family_invites WHERE id = ?").bind(invite.id).first<{ used_count: number }>();
    expect(stored?.used_count).toBe(0);
  });
});
