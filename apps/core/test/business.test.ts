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
      body: JSON.stringify({ displayName: "KK爸爸", createdFrom: "wechat_miniprogram" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json<{ data: { id: string; avatarUrl: string | null } }>();
    expect(createdBody.data.avatarUrl).toBeNull();

    const token = await makeToken(createdBody.data.id);
    const updated = await request("/api/v1/me", token, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "家事喵用户" }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json<{ data: { displayName: string } }>()).data.displayName).toBe("家事喵用户");
  });

  it("uploads an avatar to R2 and stores only its object key", async () => {
    const user = await createUser("Avatar User");
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "avatar.jpg", { type: "image/jpeg" }));

    const uploaded = await request("/api/v1/me/avatar", user.token, {
      method: "PUT",
      body: form,
    });
    expect(uploaded.status).toBe(200);
    const payload = await uploaded.json<{ data: { avatarUrl: string } }>();
    expect(payload.data.avatarUrl).toMatch(/^https:\/\/assets\.test\.example\/avatars\//);

    const stored = await bindings.DB.prepare("SELECT avatar_key FROM users WHERE id = ?").bind(user.id).first<{ avatar_key: string }>();
    expect(stored?.avatar_key).toMatch(new RegExp(`^avatars/${user.id}/.+\\.jpg$`));
    expect(await bindings.AVATARS.get(stored!.avatar_key)).not.toBeNull();

    const profile = await request("/api/v1/me", user.token);
    expect((await profile.json<{ data: { avatarUrl: string } }>()).data.avatarUrl).toBe(payload.data.avatarUrl);
  });

  it("rejects unsupported avatar types", async () => {
    const user = await createUser("Invalid Avatar");
    const form = new FormData();
    form.set("file", new File(["not an image"], "avatar.txt", { type: "text/plain" }));
    const response = await request("/api/v1/me/avatar", user.token, { method: "PUT", body: form });
    expect(response.status).toBe(415);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("UNSUPPORTED_AVATAR_TYPE");
  });

  it("creates a family with its creator as admin and enforces the creation limit", async () => {
    const user = await createUser("Creator");
    for (let index = 0; index < 3; index += 1) {
      const response = await request("/api/v1/families", user.token, { method: "POST", body: JSON.stringify({ name: `Family ${index}` }) });
      expect(response.status).toBe(201);
      expect((await response.json<{ data: { role: string; memberCount: number } }>()).data).toMatchObject({ role: "admin", memberCount: 1 });
    }
    const fourth = await request("/api/v1/families", user.token, { method: "POST", body: JSON.stringify({ name: "Fourth" }) });
    expect(fourth.status).toBe(409);
    expect((await fourth.json<{ error: { code: string } }>()).error.code).toBe("FAMILY_CREATE_LIMIT_REACHED");
  });

  it("uploads and replaces a family avatar while exposing only its public URL", async () => {
    const admin = await createUser("Avatar Admin");
    const familyResponse = await request("/api/v1/families", admin.token, {
      method: "POST",
      body: JSON.stringify({ name: "Avatar Family" }),
    });
    const family = (await familyResponse.json<{ data: { id: string } }>()).data;

    const firstForm = new FormData();
    firstForm.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "first.jpg", { type: "image/jpeg" }));
    const firstUpload = await request(`/api/v1/families/${family.id}/avatar`, admin.token, {
      method: "PUT",
      body: firstForm,
    });
    expect(firstUpload.status).toBe(200);
    const firstPayload = await firstUpload.json<{ data: { avatarUrl: string } }>();
    expect(firstPayload.data.avatarUrl).toMatch(
      new RegExp(`^https://assets\\.test\\.example/avatars/families/${family.id}/.+\\.jpg$`),
    );

    const firstStored = await bindings.DB.prepare("SELECT avatar_key FROM families WHERE id = ?")
      .bind(family.id)
      .first<{ avatar_key: string }>();
    expect(firstStored?.avatar_key).toMatch(new RegExp(`^avatars/families/${family.id}/.+\\.jpg$`));
    expect(await bindings.AVATARS.get(firstStored!.avatar_key)).not.toBeNull();

    const secondForm = new FormData();
    secondForm.set("file", new File([new Uint8Array([1, 2, 3])], "second.png", { type: "image/png" }));
    const secondUpload = await request(`/api/v1/families/${family.id}/avatar`, admin.token, {
      method: "PUT",
      body: secondForm,
    });
    expect(secondUpload.status).toBe(200);

    const secondStored = await bindings.DB.prepare("SELECT avatar_key FROM families WHERE id = ?")
      .bind(family.id)
      .first<{ avatar_key: string }>();
    expect(secondStored?.avatar_key).toMatch(new RegExp(`^avatars/families/${family.id}/.+\\.png$`));
    expect(await bindings.AVATARS.get(firstStored!.avatar_key)).toBeNull();
    expect(await bindings.AVATARS.get(secondStored!.avatar_key)).not.toBeNull();

    const detail = await request(`/api/v1/families/${family.id}`, admin.token);
    expect((await detail.json<{ data: { avatarUrl: string } }>()).data.avatarUrl)
      .toBe(`https://assets.test.example/${secondStored!.avatar_key}`);

    const familyList = await request("/api/v1/me/families", admin.token);
    const listPayload = await familyList.json<{ data: { items: Array<{ id: string; avatarUrl: string }> } }>();
    expect(listPayload.data.items.find((item) => item.id === family.id)?.avatarUrl)
      .toBe(`https://assets.test.example/${secondStored!.avatar_key}`);

    const inviteResponse = await request(`/api/v1/families/${family.id}/invites`, admin.token, {
      method: "POST",
      body: "{}",
    });
    const invite = (await inviteResponse.json<{ data: { code: string } }>()).data;
    const preview = await request(`/api/v1/family-invites/${invite.code}`, admin.token);
    expect((await preview.json<{ data: { family: { avatarUrl: string } } }>()).data.family.avatarUrl)
      .toBe(`https://assets.test.example/${secondStored!.avatar_key}`);
  }, 20_000);

  it("allows only family admins to upload family avatars", async () => {
    const admin = await createUser("Upload Admin");
    const member = await createUser("Upload Member");
    const outsider = await createUser("Upload Outsider");
    const familyResponse = await request("/api/v1/families", admin.token, {
      method: "POST",
      body: JSON.stringify({ name: "Protected Avatar" }),
    });
    const family = (await familyResponse.json<{ data: { id: string } }>()).data;
    const inviteResponse = await request(`/api/v1/families/${family.id}/invites`, admin.token, {
      method: "POST",
      body: "{}",
    });
    const code = (await inviteResponse.json<{ data: { code: string } }>()).data.code;
    await request(`/api/v1/family-invites/${code}/join`, member.token, { method: "POST", body: "{}" });

    for (const token of [member.token, outsider.token]) {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1])], "avatar.png", { type: "image/png" }));
      const response = await request(`/api/v1/families/${family.id}/avatar`, token, {
        method: "PUT",
        body: form,
      });
      expect(response.status).toBe(403);
    }
  }, 20_000);

  it("rejects arbitrary family avatar URLs in JSON writes", async () => {
    const admin = await createUser("URL Admin");
    const createResponse = await request("/api/v1/families", admin.token, {
      method: "POST",
      body: JSON.stringify({ name: "Unsafe", avatarUrl: "https://untrusted.example/avatar.png" }),
    });
    expect(createResponse.status).toBe(400);

    const familyResponse = await request("/api/v1/families", admin.token, {
      method: "POST",
      body: JSON.stringify({ name: "Safe" }),
    });
    const family = (await familyResponse.json<{ data: { id: string } }>()).data;
    const patchResponse = await request(`/api/v1/families/${family.id}`, admin.token, {
      method: "PATCH",
      body: JSON.stringify({ avatarUrl: "https://untrusted.example/avatar.png" }),
    });
    expect(patchResponse.status).toBe(400);
  });

  it("applies avatar file validation to family uploads", async () => {
    const admin = await createUser("Validation Admin");
    const familyResponse = await request("/api/v1/families", admin.token, {
      method: "POST",
      body: JSON.stringify({ name: "Validated Avatar" }),
    });
    const family = (await familyResponse.json<{ data: { id: string } }>()).data;
    const cases = [
      { file: new File(["text"], "avatar.txt", { type: "text/plain" }), status: 415, code: "UNSUPPORTED_AVATAR_TYPE" },
      { file: new File([], "empty.png", { type: "image/png" }), status: 413, code: "AVATAR_TOO_LARGE" },
      { file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.webp", { type: "image/webp" }), status: 413, code: "AVATAR_TOO_LARGE" },
    ];

    for (const item of cases) {
      const form = new FormData();
      form.set("file", item.file);
      const response = await request(`/api/v1/families/${family.id}/avatar`, admin.token, {
        method: "PUT",
        body: form,
      });
      expect(response.status).toBe(item.status);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe(item.code);
    }
  }, 20_000);

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

  it("allows only one concurrent redemption of the final invite use", async () => {
    const admin = await createUser("Race Admin");
    const first = await createUser("Race One");
    const second = await createUser("Race Two");
    const family = (await (await request("/api/v1/families", admin.token, { method: "POST", body: JSON.stringify({ name: "Race" }) })).json<any>()).data;
    const invite = (await (await request(`/api/v1/families/${family.id}/invites`, admin.token, { method: "POST", body: JSON.stringify({ maxUses: 1 }) })).json<any>()).data;
    const responses = await Promise.all([first, second].map((user) => request(`/api/v1/family-invites/${invite.code}/join`, user.token, { method: "POST", body: "{}" })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const count = await bindings.DB.prepare("SELECT COUNT(*) count FROM family_members WHERE family_id=? AND status='active'").bind(family.id).first<{ count: number }>();
    const stored = await bindings.DB.prepare("SELECT used_count FROM family_invites WHERE id=?").bind(invite.id).first<{ used_count: number }>();
    expect(count?.count).toBe(2);
    expect(stored?.used_count).toBe(1);
  });

  it("stores and returns a family IANA timezone", async () => {
    const admin = await createUser("Tokyo Admin");
    const created = await request("/api/v1/families", admin.token, { method: "POST", body: JSON.stringify({ name: "Tokyo", timezone: "Asia/Tokyo" }) });
    expect((await created.json<any>()).data.timezone).toBe("Asia/Tokyo");
    const list = await request("/api/v1/me/families", admin.token);
    expect((await list.json<any>()).data.items[0].timezone).toBe("Asia/Tokyo");
  });

  it("stores mutation audit timestamps as canonical UTC", async () => {
    const user = await createUser("UTC profile");
    const response = await request("/api/v1/me", user.token, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "UTC profile updated" }),
    });
    expect(response.status).toBe(200);
    const row = await bindings.DB.prepare(
      "SELECT updated_at FROM users WHERE id=?",
    ).bind(user.id).first<{ updated_at: string }>();
    expect(row?.updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});
