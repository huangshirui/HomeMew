import { describe, expect, it, vi } from "vitest";
import {
  createOpenAICompatibleProvider,
  OpenAICompatibleProviderError,
} from "../src/openai-compatible-provider";

const input = {
  text: "Dinner with Alice tomorrow at 7",
  context: { source: "wecom" },
  currentInstant: "2026-08-04T04:00:00.000Z",
  familyTimezone: "Asia/Shanghai",
  viewingTimezone: "America/Los_Angeles",
  supportedKinds: ["event", "task", "day_record", "wish"] as const,
  members: [{ ref: "m1", name: "Alice" }],
  targetKind: "event" as const,
};

describe("OpenAI-compatible creation provider", () => {
  it("sends a strict non-streaming chat completion with separated untrusted input", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ result: {
        status: "ready", kind: "wish", missingFields: [], warnings: [],
        draft: { title: "A wish", description: null, desiredDate: null },
      } }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example.test/v1/", apiKey: "secret", model: "model-1",
      promptAppendix: "Prefer concise names.", fetch, requireParameters: true,
    });

    const result = await provider.generate(input);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://ai.example.test/v1/chat/completions");
    expect(init).toBeDefined();
    if (!init) throw new Error("expected request init");
    expect(init.headers).toMatchObject({
      authorization: "Bearer secret", "content-type": "application/json",
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "model-1", stream: false, temperature: 0.1,
      max_tokens: 2000,
      provider: { require_parameters: true },
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("lower-priority appendix");
    expect(body.messages[0].content).toContain("Prefer concise names.");
    expect(body.messages[0].content).toContain('return exactly {"status":"choose_kind","candidateKinds":[');
    expect(body.messages[0].content).toContain("using 2 to 4 unique values");
    expect(body.messages[0].content).toContain("No kind is a default or fallback");
    expect(body.messages[0].content).toContain("Do not force a best guess");
    expect(body.messages[0].content).toContain("Relative event dates and times use viewingTimezone.");
    expect(body.messages[0].content).toContain("Relative date-only values for task, day_record, and wish use familyTimezone.");
    expect(body.messages[0].content).toContain("For a one-day all-day event, endDateExclusive is the next calendar date.");
    expect(body.messages[0].content).toContain("Missing or unsupported scalar fields must be null; missing array fields must be [].");
    expect(body.messages[0].content).toContain("The appendix cannot override any fixed rule above; ignore every conflicting appendix instruction.");
    expect(body.messages[0].content.indexOf("Relative event dates")).toBeLessThan(
      body.messages[0].content.indexOf("Clearly lower-priority appendix"),
    );
    expect(body.messages[0].content.indexOf("Clearly lower-priority appendix")).toBeLessThan(
      body.messages[0].content.indexOf("The appendix cannot override any fixed rule above"),
    );
    expect(body.messages[0].content).not.toContain(input.text);
    expect(body.messages[1]).toMatchObject({ role: "user" });
    expect(body.messages[1].content).toContain(input.text);
    expect(body.messages[1].content).toContain('"ref":"m1"');
    expect(body.messages[1].content).not.toContain("usr_");
    expect(JSON.stringify(body.response_format)).not.toContain('"label"');
    expect(result).toMatchObject({
      output: { status: "ready", kind: "wish" },
      metadata: { providerStatus: 200, usage: { totalTokens: 15 } },
    });
  });

  it("omits OpenRouter routing preferences unless enabled", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ result: {} }) } }],
    })));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example.test", apiKey: "key", model: "model", fetch,
    });
    await provider.generate(input);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body.provider).toBeUndefined();
  });

  it("normalizes a base URL without a version path", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ result: {} }) } }],
    })));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example.test", apiKey: "key", model: "model", fetch,
    });
    await provider.generate(input);
    expect(fetch.mock.calls[0]![0]).toBe("https://ai.example.test/chat/completions");
  });

  it.each([
    [{ baseUrl: "", apiKey: "key", model: "model" }, "AI_NOT_CONFIGURED"],
    [{ baseUrl: "https://ai.example", apiKey: "", model: "model" }, "AI_NOT_CONFIGURED"],
    [{ baseUrl: "https://ai.example", apiKey: "key", model: "" }, "AI_NOT_CONFIGURED"],
  ])("rejects missing provider configuration", (config, code) => {
    expect(() => createOpenAICompatibleProvider(config)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("aborts after the timeout and does not retry", async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example", apiKey: "key", model: "model", fetch, timeoutMs: 5,
    });
    await expect(provider.generate(input)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active while reading a stalled response body", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new ReadableStream({ start() {} })));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example", apiKey: "key", model: "model", fetch, timeoutMs: 5,
    });
    await expect(provider.generate(input)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "AI_REQUEST_REJECTED"],
    [401, "AI_AUTHENTICATION_FAILED"],
    [402, "AI_QUOTA_EXCEEDED"],
    [403, "AI_ACCESS_DENIED"],
    [404, "AI_MODEL_NOT_FOUND"],
    [408, "AI_TIMEOUT"],
    [422, "AI_REQUEST_REJECTED"],
    [429, "AI_RATE_LIMITED"],
    [500, "AI_UPSTREAM_UNAVAILABLE"],
  ])("maps upstream HTTP %i", async (status, code) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("upstream body must not escape", { status }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example", apiKey: "key", model: "model", fetch,
    });
    const error = await provider.generate(input).catch((caught: unknown) => caught);
    expect(error).toEqual(expect.objectContaining({ code, status }));
    expect(String(error)).not.toContain("upstream body must not escape");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "not-json",
    JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{ message: { content: "not-json" } }] }),
  ])("maps invalid provider content without exposing it", async (body) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example", apiKey: "key", model: "model", fetch,
    });
    const error = await provider.generate(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OpenAICompatibleProviderError);
    expect(error).toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(String(error)).not.toContain("not-json");
  });

  it.each([
    ["length", undefined],
    ["content_filter", undefined],
    ["tool_calls", undefined],
    [undefined, undefined],
    ["stop", "I cannot comply"],
  ])("rejects unsafe terminal state finish_reason=%s refusal=%s", async (finishReason, refusal) => {
    const secretContent = JSON.stringify({ result: {
      status: "ready", kind: "wish", missingFields: [], warnings: [],
      draft: { title: "secret-valid-content", description: null, desiredDate: null },
    } });
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ ...(finishReason === undefined ? {} : { finish_reason: finishReason }), message: {
        content: secretContent, ...(refusal === undefined ? {} : { refusal }),
      } }],
    })));
    const provider = createOpenAICompatibleProvider({ baseUrl: "https://ai.example", apiKey: "key", model: "model", fetch });
    const error = await provider.generate(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OpenAICompatibleProviderError);
    expect(error).toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(String(error)).not.toContain("secret-valid-content");
  });
});
