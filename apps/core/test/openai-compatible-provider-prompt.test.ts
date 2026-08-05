import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider } from "../src/openai-compatible-provider";

const validWish = {
  result: {
    status: "ready",
    kind: "wish",
    missingFields: [],
    warnings: [],
    draft: { title: "去看海", description: null, desiredDate: null },
  },
};

describe("AI creation draft prompt semantics", () => {
  it("requires positive evidence and asks the user when classification is uncertain", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validWish) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://ai.example.test/v1",
      apiKey: "secret",
      model: "model-1",
      fetch,
    });

    await provider.generate({
      text: "提醒我周五交水费，另外周六带KK踢球",
      currentInstant: "2026-08-05T00:45:00.000Z",
      familyTimezone: "Asia/Shanghai",
      viewingTimezone: "Asia/Shanghai",
      supportedKinds: ["event", "task", "day_record", "wish"],
      members: [{ ref: "m1", name: "爸爸" }, { ref: "m2", name: "KK" }],
      requestingMemberRef: "m1",
    });

    const init = fetch.mock.calls[0]![1];
    expect(init).toBeDefined();
    const body = JSON.parse(String(init!.body));
    const systemPrompt = String(body.messages[0].content);
    const userPayload = JSON.parse(String(body.messages[1].content));

    expect(systemPrompt).toContain("event: an occurrence whose defining meaning");
    expect(systemPrompt).toContain("task: an action or obligation whose defining meaning");
    expect(systemPrompt).toContain("day_record: a record whose defining meaning");
    expect(systemPrompt).toContain("wish: an expressed desire, aspiration, or idea");
    expect(systemPrompt).toContain("positive evidence for that kind");
    expect(systemPrompt).toContain("No kind is a default or fallback");
    expect(systemPrompt).toContain("Do not force a best guess");
    expect(systemPrompt).toContain("all and only the plausible supported kinds");
    expect(systemPrompt).toContain("Distinguish uncertainty about the kind from missing fields inside a known kind");
    expect(systemPrompt).toContain("extract only the first item and add an UNSUPPORTED_DETAIL warning");
    expect(systemPrompt).toContain("refer only to requestingMemberRef");
    expect(systemPrompt).toContain("A weekday without “next/下周” means the nearest occurrence");
    expect(systemPrompt).toContain("If an event has an explicit date but no time expression, treat it as all-day");
    expect(systemPrompt).toContain("never invent a duration");
    expect(systemPrompt).toContain("Required fields are:");
    expect(userPayload.requestingMemberRef).toBe("m1");
    expect(userPayload.members).toEqual([{ ref: "m1", name: "爸爸" }, { ref: "m2", name: "KK" }]);
  });
});
