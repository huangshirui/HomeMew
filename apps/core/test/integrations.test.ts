import { describe, expect, it } from "vitest";
import { bindings, createFamily, createUser, makeSystemToken, request } from "./helpers";

async function createIntegration(familyId: string, token: string, permissions = ["family:read", "events:read", "events:write", "tasks:read", "tasks:write"]) {
  return request(`/api/v1/families/${familyId}/integrations`, token, {
    method: "POST",
    body: JSON.stringify({ name: "家庭 n8n", description: "自动化", permissions }),
  });
}

describe("external system integrations", () => {
  it("lets an admin create, inspect, update and soft-delete an integration", async () => {
    const family = await createFamily();
    const created = await createIntegration(family.id, family.admin.token);
    expect(created.status).toBe(201);
    const integration = (await created.json<any>()).data;
    expect(integration).toMatchObject({ name: "家庭 n8n", status: "active", permissions: ["family:read", "events:read", "events:write", "tasks:read", "tasks:write"] });
    expect(integration.id).toMatch(/^sys_/);

    const listed = await request(`/api/v1/families/${family.id}/integrations`, family.admin.token);
    expect((await listed.json<any>()).data.items).toHaveLength(1);

    const updated = await request(`/api/v1/families/${family.id}/integrations/${integration.id}`, family.admin.token, {
      method: "PATCH",
      body: JSON.stringify({ status: "disabled", permissions: ["events:read"] }),
    });
    expect(await updated.json<any>()).toMatchObject({ data: { status: "disabled", permissions: ["events:read"] } });

    expect((await request(`/api/v1/families/${family.id}/integrations/${integration.id}`, family.admin.token, { method: "DELETE" })).status).toBe(204);
  });

  it("rejects non-admin management and invalid write-only permissions", async () => {
    const family = await createFamily();
    const member = await createUser("Member");
    await request(`/api/v1/families/${family.id}/members`, family.admin.token);
    await family.admin.token;
    const bad = await createIntegration(family.id, family.admin.token, ["events:write"]);
    expect(bad.status).toBe(400);
    expect((await bad.json<any>()).error.code).toBe("INVALID_PERMISSIONS");
    const outsider = await createIntegration(family.id, member.token);
    expect(outsider.status).toBe(403);
  });

  it("creates one-time API tokens and OAuth client secrets", async () => {
    const family = await createFamily();
    const integration = (await (await createIntegration(family.id, family.admin.token)).json<any>()).data;
    const patResponse = await request(`/api/v1/families/${family.id}/integrations/${integration.id}/api-tokens`, family.admin.token, { method: "POST", body: "{}" });
    expect(patResponse.status).toBe(201);
    const pat = (await patResponse.json<any>()).data;
    expect(pat.token).toMatch(/^hmw_pat_/);

    const secretResponse = await request(`/api/v1/families/${family.id}/integrations/${integration.id}/client-secrets`, family.admin.token, { method: "POST", body: "{}" });
    expect(secretResponse.status).toBe(201);
    const secret = (await secretResponse.json<any>()).data;
    expect(secret.clientId).toBe(integration.id);
    expect(secret.clientSecret).toMatch(/^hmw_cs_/);

    const credentials = await request(`/api/v1/families/${family.id}/integrations/${integration.id}/credentials`, family.admin.token);
    const items = (await credentials.json<any>()).data.items;
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items)).not.toContain(pat.token);
    expect(JSON.stringify(items)).not.toContain(secret.clientSecret);
  });

  it("exchanges client credentials and uses both system bearer forms on shared APIs", async () => {
    const family = await createFamily();
    const integration = (await (await createIntegration(family.id, family.admin.token)).json<any>()).data;
    const pat = (await (await request(`/api/v1/families/${family.id}/integrations/${integration.id}/api-tokens`, family.admin.token, { method: "POST", body: "{}" })).json<any>()).data.token;
    const secret = (await (await request(`/api/v1/families/${family.id}/integrations/${integration.id}/client-secrets`, family.admin.token, { method: "POST", body: "{}" })).json<any>()).data;

    const oauth = await request("/oauth/token", "", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: secret.clientId, client_secret: secret.clientSecret, scope: "family:read events:read events:write" }).toString(),
    });
    expect(oauth.status, JSON.stringify(await oauth.clone().json())).toBe(200);
    const access = await oauth.json<any>();
    expect(access).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "family:read events:read events:write" });
    expect(access.refresh_token).toBeUndefined();

    const familyResult = await request(`/api/v1/families/${family.id}`, pat);
    expect(await familyResult.json<any>()).toMatchObject({ data: { id: family.id, currentUserRole: null } });

    const event = await request(`/api/v1/families/${family.id}/events`, access.access_token, {
      method: "POST",
      body: JSON.stringify({ summary: "系统日程", start: "2026-07-25", end: "2026-07-26", isAllDay: true, timezone: "Asia/Shanghai", attendeeIds: [] }),
    });
    expect(event.status).toBe(201);
    expect((await event.json<any>()).data.createdBy).toMatchObject({ type: "system", id: integration.id, name: "家庭 n8n" });
  });

  it("rejects me filters for systems and applies permission changes immediately", async () => {
    const family = await createFamily();
    const integration = (await (await createIntegration(family.id, family.admin.token)).json<any>()).data;
    const patData = (await (await request(`/api/v1/families/${family.id}/integrations/${integration.id}/api-tokens`, family.admin.token, { method: "POST", body: "{}" })).json<any>()).data;
    const me = await request(`/api/v1/families/${family.id}/events?attendeeId=me`, patData.token);
    expect(me.status).toBe(400);
    expect((await me.json<any>()).error.code).toBe("INVALID_FILTER");

    await request(`/api/v1/families/${family.id}/integrations/${integration.id}`, family.admin.token, {
      method: "PATCH",
      body: JSON.stringify({ permissions: ["events:read"] }),
    });
    const denied = await request(`/api/v1/families/${family.id}/events`, patData.token, {
      method: "POST",
      body: JSON.stringify({ summary: "No", start: "2026-07-25", end: "2026-07-26", isAllDay: true, timezone: "Asia/Shanghai" }),
    });
    expect(denied.status).toBe(403);
    expect((await denied.json<any>()).error.code).toBe("SYSTEM_PERMISSION_DENIED");
  });

  it("supports Basic client authentication and immediately revokes issued JWTs", async () => {
    const family = await createFamily();
    const integration = (await (await createIntegration(family.id, family.admin.token)).json<any>()).data;
    const secret = (await (await request(`/api/v1/families/${family.id}/integrations/${integration.id}/client-secrets`, family.admin.token, { method: "POST", body: "{}" })).json<any>()).data;
    const oauth = await request("/oauth/token", "", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${btoa(`${secret.clientId}:${secret.clientSecret}`)}`,
      },
      body: "grant_type=client_credentials&scope=events%3Aread",
    });
    expect(oauth.status).toBe(200);
    const accessToken = (await oauth.json<any>()).access_token;
    expect((await request(`/api/v1/families/${family.id}/events`, accessToken)).status).toBe(200);

    expect((await request(`/api/v1/families/${family.id}/integrations/${integration.id}/credentials/${secret.id}`, family.admin.token, { method: "DELETE" })).status).toBe(204);
    const revoked = await request(`/api/v1/families/${family.id}/events`, accessToken);
    expect(revoked.status).toBe(401);
    expect((await revoked.json<any>()).error.code).toBe("CREDENTIAL_REVOKED");
  });

  it("records system actors when creating and completing tasks", async () => {
    const family = await createFamily();
    const integration = (await (await createIntegration(family.id, family.admin.token)).json<any>()).data;
    const pat = (await (await request(`/api/v1/families/${family.id}/integrations/${integration.id}/api-tokens`, family.admin.token, { method: "POST", body: "{}" })).json<any>()).data.token;
    const created = await request(`/api/v1/families/${family.id}/tasks`, pat, {
      method: "POST", body: JSON.stringify({ name: "系统待办", assigneeIds: [] }),
    });
    expect(created.status).toBe(201);
    const task = (await created.json<any>()).data;
    expect(task.createdBy).toMatchObject({ type: "system", id: integration.id, name: "家庭 n8n" });
    const completed = await request(`/api/v1/families/${family.id}/tasks/${task.id}/complete`, pat, {
      method: "POST", body: JSON.stringify({ version: task.version }),
    });
    expect((await completed.json<any>()).data.completedBy).toMatchObject({ type: "system", id: integration.id });
    const me = await request(`/api/v1/families/${family.id}/tasks?assigneeId=me`, pat);
    expect(me.status).toBe(400);
    expect((await me.json<any>()).error.code).toBe("INVALID_FILTER");
  });

  it("rejects expired credentials and resets failures after a lock expires", async () => {
    const family = await createFamily();
    const integration = (await (await createIntegration(family.id, family.admin.token)).json<any>()).data;
    const secret = (await (await request(`/api/v1/families/${family.id}/integrations/${integration.id}/client-secrets`, family.admin.token, { method: "POST", body: "{}" })).json<any>()).data;
    await bindings.DB.prepare("INSERT INTO oauth_rate_limits(dimension,subject,window_started_at,request_count,failure_count,locked_until) VALUES('client',?,?,1,5,?)")
      .bind(integration.id, Math.floor(Date.now()/1000)-60, Math.floor(Date.now()/1000)-1).run();
    const wrong = await request("/oauth/token", "", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: integration.id, client_secret: "wrong" }).toString() });
    expect(wrong.status).toBe(401);
    const limit = await bindings.DB.prepare("SELECT failure_count,locked_until FROM oauth_rate_limits WHERE dimension='client' AND subject=?").bind(integration.id).first<any>();
    expect(limit.failure_count).toBe(1);
    expect(limit.locked_until).toBeNull();

    await bindings.DB.prepare("UPDATE system_credentials SET expires_at='2000-01-01 00:00:00' WHERE id=?").bind(secret.id).run();
    const expired = await request("/oauth/token", "", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: integration.id, client_secret: secret.clientSecret }).toString() });
    expect(expired.status).toBe(401);
    expect((await expired.json<any>()).error).toBe("invalid_client");
  });

  it("rejects a signed system JWT that was not issued by the token endpoint", async () => {
    const family=await createFamily();
    const integration=(await (await createIntegration(family.id,family.admin.token)).json<any>()).data;
    const secret=(await (await request(`/api/v1/families/${family.id}/integrations/${integration.id}/client-secrets`,family.admin.token,{method:"POST",body:"{}"})).json<any>()).data;
    const forged=await makeSystemToken(integration.id,secret.id,"tok_not_issued","events:read");
    const response=await request(`/api/v1/families/${family.id}/events`,forged);
    expect(response.status).toBe(401);
    expect((await response.json<any>()).error.code).toBe("UNAUTHORIZED");
  });
});
