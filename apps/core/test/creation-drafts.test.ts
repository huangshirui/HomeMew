import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { CreationProviderInput, CreationProviderResult } from "../src/openai-compatible-provider";
import { OpenAICompatibleProviderError } from "../src/openai-compatible-provider";
import { createId } from "../src/ids";
import { bindings, createFamily, createUser, makeSystemToken, makeToken } from "./helpers";

const instant = new Date("2026-08-04T01:30:00.000Z");
const pathFor = (familyId: string) => `/api/v1/families/${familyId}/creation-drafts/interpret`;

const readyWish = {
  status: "ready", kind: "wish", missingFields: [], warnings: [],
  draft: { title: "See the sea", description: null, desiredDate: null },
} as const;

const chooseKind = {
  status: "choose_kind",
  candidateKinds: ["event", "task"],
} as const;

type Provider = { generate(input: CreationProviderInput): Promise<CreationProviderResult> };

function testBindings(overrides: Record<string, unknown> = {}) {
  return {
    ...bindings,
    AI_API_KEY: "test-ai-key",
    AI_BASE_URL: "https://ai.example.test/v1",
    AI_MODEL: "test-model",
    AI_PROMPT_APPENDIX: "",
    AI_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    ...overrides,
  };
}

function appWith(provider: Provider, now = () => instant) {
  return createApp({
    now,
    createCreationProvider: () => provider,
  });
}

async function call(
  app: ReturnType<typeof createApp>, familyId: string, token: string,
  body: unknown = { text: "Make a wish", viewingTimezone: "Asia/Shanghai" },
  bindingOverrides: Record<string, unknown> = {}, headers: Record<string, string> = {},
) {
  return app.request(pathFor(familyId), {
    method: "POST",
    headers: { authorization: token ? `Bearer ${token}` : "", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }, testBindings(bindingOverrides));
}

async function addMember(familyId: string, displayName: string, joinedAt?: string) {
  const member = await createUser(displayName);
  await env.DB.prepare(`INSERT INTO family_members (id,family_id,user_id,role,joined_at)
    VALUES (?,?,?,'member',COALESCE(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).bind(
    createId("fmem"), familyId, member.id, joinedAt ?? null,
  ).run();
  return member;
}

describe("AI creation draft route", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns a normalized ready draft and forwards trimmed input and targetKind", async () => {
    const family = await createFamily("Creation ready");
    const generate = vi.fn(async (_input: CreationProviderInput) => ({
      output: readyWish,
      metadata: { providerStatus: 200, usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 } },
    }));
    const response = await call(appWith({ generate }), family.id, family.admin.token, {
      text: "  Make a wish  ", viewingTimezone: "Asia/Shanghai", targetKind: "wish",
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toEqual({ data: {
      status: "ready", kind: "wish", missingFields: [], warnings: [],
      draft: { title: "See the sea", description: null, desiredDate: null },
    } });
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]![0]).toMatchObject({
      text: "Make a wish", targetKind: "wish",
      supportedKinds: ["event", "task", "day_record", "wish"],
    });
  });

  it("returns choose_kind when no targetKind is supplied", async () => {
    const family = await createFamily("Creation choose kind");
    const response = await call(appWith({ generate: vi.fn(async () => ({ output: chooseKind, metadata: { providerStatus: 200 } })) }), family.id, family.admin.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: chooseKind });
  });

  it("rejects the legacy labeled choose_kind shape", async () => {
    const family = await createFamily("Creation legacy choose kind");
    const response = await call(appWith({ generate: vi.fn(async () => ({
      output: {
        status: "choose_kind",
        candidates: [{ kind: "event", label: "Event" }, { kind: "task", label: "Task" }],
        missingFields: ["kind"], warnings: [],
      },
      metadata: { providerStatus: 200 },
    })) }), family.id, family.admin.token);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "AI_INVALID_RESPONSE" } });
  });

  it.each([
    ["invalid JSON", "{", "INVALID_REQUEST"],
    ["non-object JSON", [], "INVALID_REQUEST"],
    ["extra fields", { text: "x", viewingTimezone: "UTC", extra: true }, "INVALID_REQUEST"],
    ["missing text", { viewingTimezone: "UTC" }, "INVALID_REQUEST"],
    ["blank text", { text: "   ", viewingTimezone: "UTC" }, "INVALID_REQUEST"],
    ["overlong text", { text: "x".repeat(5001), viewingTimezone: "UTC" }, "INVALID_REQUEST"],
    ["missing timezone", { text: "x" }, "INVALID_REQUEST"],
    ["invalid timezone", { text: "x", viewingTimezone: "Mars/Olympus" }, "INVALID_REQUEST"],
    ["invalid target kind", { text: "x", viewingTimezone: "UTC", targetKind: "note" }, "INVALID_REQUEST"],
  ])("rejects %s", async (_label, body, code) => {
    const family = await createFamily(`Creation invalid ${String(_label)}`);
    const generate = vi.fn(async () => ({ output: readyWish, metadata: { providerStatus: 200 } }));
    const response = await call(appWith({ generate }), family.id, family.admin.token, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(generate).not.toHaveBeenCalled();
  });

  it("requires authentication and returns the standard request-id error envelope", async () => {
    const app = appWith({ generate: vi.fn() });
    const response = await app.request(pathFor("fam_missing"), {
      method: "POST", headers: { "content-type": "application/json", "x-request-id": "req-ai-auth" },
      body: JSON.stringify({ text: "x", viewingTimezone: "UTC" }),
    }, testBindings());
    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("req-ai-auth");
    expect(await response.json()).toEqual({ error: {
      code: "UNAUTHORIZED", message: "Authentication is required", requestId: "req-ai-auth",
    } });
  });

  it("forbids service and system principals without calling the provider", async () => {
    const family = await createFamily("Creation principals");
    const generate = vi.fn();
    const app = appWith({ generate });
    const service = await call(app, family.id, await makeToken("svc_test", "internal"));
    const system = await call(app, family.id, await makeSystemToken("sys_test", "crd_test", "tok_test", "family:read"));
    expect(service.status).toBe(403);
    expect(system.status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it("forbids a non-member after checking the active user", async () => {
    const family = await createFamily("Creation member auth");
    const outsider = await createUser("Creation outsider");
    const generate = vi.fn();
    const response = await call(appWith({ generate }), family.id, outsider.token);
    expect(response.status).toBe(403);
    expect((await response.json() as any).error.code).toBe("FORBIDDEN");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rate limits by user ID after authorization and before the provider call", async () => {
    const family = await createFamily("Creation rate limit");
    const generate = vi.fn();
    const limit = vi.fn(async () => ({ success: false }));
    const response = await call(appWith({ generate }), family.id, family.admin.token, undefined, {
      AI_RATE_LIMITER: { limit },
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "AI_RATE_LIMITED" } });
    expect(limit).toHaveBeenCalledWith({ key: family.admin.id });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses one injected instant, viewing timezone for event interpretation, and family timezone for familyToday", async () => {
    const family = await createFamily("Creation timezone");
    await env.DB.prepare("UPDATE families SET timezone='Asia/Shanghai' WHERE id=?").bind(family.id).run();
    const generate = vi.fn(async (_input: CreationProviderInput) => ({
      output: {
        status: "ready", kind: "day_record", missingFields: [], warnings: [],
        draft: {
          dayRecordKind: "elapsed", name: "Exercise", description: null, anchorDate: "2026-08-04",
          subjectMemberRef: null, icon: null, attentionAfterDays: null, attentionBeforeDays: null, cycleDays: null,
        },
      },
      metadata: { providerStatus: 200 },
    }));
    const response = await call(appWith({ generate }), family.id, family.admin.token, {
      text: "Yesterday I exercised", viewingTimezone: "America/Los_Angeles", targetKind: "day_record",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(generate.mock.calls[0]![0]).toMatchObject({
      currentInstant: instant.toISOString(), familyTimezone: "Asia/Shanghai",
      viewingTimezone: "America/Los_Angeles",
    });
    expect((await response.json() as any).data.draft.anchorDate).toBe("2026-08-04");
  });

  it("keeps stable temporary refs but never resolves duplicate display names to user IDs", async () => {
    const family = await createFamily("Creation members");
    const first = await addMember(family.id, "Sam", "2026-08-03T00:00:00.000Z");
    const second = await addMember(family.id, "Sam", "2026-08-03T00:00:00.000Z");
    const inputs: CreationProviderInput[] = [];
    const generate = vi.fn(async (input: CreationProviderInput) => {
      inputs.push(input);
      const refs = input.members.filter((member) => member.name === "Sam").map((member) => member.ref);
      return {
        output: { status: "ready", kind: "task", missingFields: [], warnings: [], draft: {
          name: "Help Sam", description: null, dueDate: null, assigneeRefs: refs,
        } },
        metadata: { providerStatus: 200 },
      };
    });
    const app = appWith({ generate });
    const firstResponse = await call(app, family.id, family.admin.token, { text: "Help Sam", viewingTimezone: "UTC", targetKind: "task" });
    await call(app, family.id, family.admin.token, { text: "Help Sam again", viewingTimezone: "UTC", targetKind: "task" });

    expect(inputs[0]!.members.map((member) => member.ref)).toEqual(inputs[0]!.members.map((_member, index) => `m${index + 1}`));
    expect(inputs[1]!.members).toEqual(inputs[0]!.members);
    expect(JSON.stringify(inputs[0]!.members)).not.toContain(first.id);
    expect(JSON.stringify(inputs[0]!.members)).not.toContain(second.id);
    const payload = (await firstResponse.json() as any).data;
    expect(payload.draft.assigneeIds).toEqual([]);
    expect(payload.missingFields).toContain("assigneeIds");
    expect(payload.warnings).toEqual([
      { code: "AMBIGUOUS_MEMBER", field: "assigneeIds", message: "The referenced member is ambiguous." },
      { code: "AMBIGUOUS_MEMBER", field: "assigneeIds", message: "The referenced member is ambiguous." },
    ]);
    expect(JSON.stringify(payload)).not.toContain(first.id);
    expect(JSON.stringify(payload)).not.toContain(second.id);
  });

  it("returns 503 when AI configuration is missing", async () => {
    const family = await createFamily("Creation config");
    const app = createApp({ now: () => instant });
    const response = await call(app, family.id, family.admin.token, undefined, {
      AI_API_KEY: undefined, AI_MODEL: "", AI_BASE_URL: "",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "AI_NOT_CONFIGURED" } });
  });

  it.each(["absent", "blank"] as const)("keeps non-AI routes available when AI configuration is %s", async (mode) => {
    const family = await createFamily(`Creation config isolation ${mode}`);
    const configured = testBindings();
    const app = createApp({ now: () => instant });
    const appBindings = mode === "blank"
      ? { ...configured, AI_API_KEY: "", AI_BASE_URL: "", AI_MODEL: "", AI_PROMPT_APPENDIX: "" }
      : (({ AI_API_KEY: _key, AI_BASE_URL: _url, AI_MODEL: _model, AI_PROMPT_APPENDIX: _appendix, ...rest }) => rest)(configured);

    const health = await app.request("/health", {}, appBindings);
    const status = await app.request("/api/v1/status", {}, appBindings);
    const me = await app.request("/api/v1/me", {
      headers: { authorization: `Bearer ${family.admin.token}` },
    }, appBindings);
    const creation = await app.request(pathFor(family.id), {
      method: "POST",
      headers: { authorization: `Bearer ${family.admin.token}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "Make a wish", viewingTimezone: "UTC" }),
    }, appBindings);

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ data: { status: "ok" } });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ data: { status: "ok", database: "available" } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ data: { id: family.admin.id } });
    expect(creation.status).toBe(503);
    expect(await creation.json()).toMatchObject({ error: { code: "AI_NOT_CONFIGURED" } });
  });

  it.each([
    [new OpenAICompatibleProviderError("AI_TIMEOUT", "secret timeout"), 504, "AI_PROVIDER_TIMEOUT"],
    [new OpenAICompatibleProviderError("AI_RATE_LIMITED", "secret rate", 429), 429, "AI_RATE_LIMITED"],
    [new OpenAICompatibleProviderError("AI_UPSTREAM_UNAVAILABLE", "secret unavailable", 503), 502, "AI_PROVIDER_UNAVAILABLE"],
    [new OpenAICompatibleProviderError("AI_NOT_CONFIGURED", "secret bad request", 400), 503, "AI_NOT_CONFIGURED"],
    [new OpenAICompatibleProviderError("AI_INVALID_RESPONSE", "secret raw model", 200), 502, "AI_INVALID_RESPONSE"],
  ])("maps provider errors safely", async (providerError, status, code) => {
    const family = await createFamily(`Creation error ${code}`);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await call(appWith({ generate: vi.fn(async () => { throw providerError; }) }), family.id, family.admin.token);
    expect(response.status).toBe(status);
    const payload = await response.json() as any;
    expect(payload.error.code).toBe(code);
    expect(JSON.stringify(payload)).not.toContain("secret");
    if (providerError.status !== undefined) {
      const aiLog = info.mock.calls.find(([message]) => message === "AI creation draft call");
      expect(aiLog?.[1]).toMatchObject({ upstreamStatus: providerError.status, errorCategory: code });
    }
  });

  it("maps invalid normalized model output without exposing it", async () => {
    const family = await createFamily("Creation invalid model");
    const response = await call(appWith({ generate: vi.fn(async () => ({
      output: { secretRawModelText: "do not expose" }, metadata: { providerStatus: 200 },
    })) }), family.id, family.admin.token);
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("AI_INVALID_RESPONSE");
    expect(text).not.toContain("secretRawModelText");
    expect(text).not.toContain("do not expose");
  });

  it("does not write event, task, day-record, or wish tables", async () => {
    const family = await createFamily("Creation read only");
    const tables = ["events", "tasks", "day_records", "wishes"];
    const before = await Promise.all(tables.map(async (table) => (await env.DB.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())!.count));
    const response = await call(appWith({ generate: vi.fn(async () => ({ output: readyWish, metadata: { providerStatus: 200 } })) }), family.id, family.admin.token);
    const after = await Promise.all(tables.map(async (table) => (await env.DB.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())!.count));
    expect(response.status).toBe(200);
    expect(after).toEqual(before);
  });

  it("emits exactly one safe AI-call log with request, result, timing, upstream, token, and category metadata", async () => {
    const family = await createFamily("Creation logs");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await call(appWith({ generate: vi.fn(async () => ({
      output: readyWish,
      metadata: { providerStatus: 200, usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
    })) }), family.id, family.admin.token, { text: "private household text", viewingTimezone: "UTC" }, {}, { "x-request-id": "req-ai-log" });
    expect(response.status).toBe(200);
    const aiLogs = info.mock.calls.filter(([message]) => message === "AI creation draft call");
    expect(aiLogs).toHaveLength(1);
    expect(aiLogs[0]![1]).toMatchObject({
      requestId: "req-ai-log", status: "ready", kind: "wish", durationMs: 0,
      upstreamStatus: 200, promptTokens: 10, completionTokens: 4, totalTokens: 14,
      errorCategory: null,
    });
    const serialized = JSON.stringify(aiLogs);
    expect(serialized).not.toContain("private household text");
    expect(serialized).not.toContain("test-ai-key");
  });
});
