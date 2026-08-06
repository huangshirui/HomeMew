import { describe, expect, it } from "vitest";
import { createFamily, request } from "./helpers";

async function createEvent(
  familyId: string,
  token: string,
  input: Record<string, unknown>,
) {
  return request(`/api/v1/families/${familyId}/events`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function createTask(
  familyId: string,
  token: string,
  input: Record<string, unknown>,
) {
  return request(`/api/v1/families/${familyId}/tasks`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

describe("family event and task search", () => {
  it("searches event summary, description, and location within the requested window", async () => {
    const family = await createFamily("Event search");
    const base = {
      isAllDay: false,
      startAt: "2026-08-10T01:00:00Z",
      endAt: "2026-08-10T02:00:00Z",
      attendeeIds: [family.admin.id],
    };

    await createEvent(family.id, family.admin.token, {
      ...base,
      summary: "Football training",
      description: "Bring the blue jersey",
      location: "Riverside pitch",
    });
    await createEvent(family.id, family.admin.token, {
      ...base,
      summary: "Piano lesson",
      description: "Practice scales",
      location: "Music room",
    });

    const search = async (q: string) => {
      const response = await request(
        `/api/v1/families/${family.id}/events?startDate=2026-08-10&endDateExclusive=2026-08-11&timezone=Asia/Shanghai&q=${encodeURIComponent(q)}`,
        family.admin.token,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json<any>()).data.items.map((item: any) => item.summary);
    };

    expect(await search("football")).toEqual(["Football training"]);
    expect(await search("BLUE JERSEY")).toEqual(["Football training"]);
    expect(await search("riverside")).toEqual(["Football training"]);
    expect(await search("missing")).toEqual([]);
  });

  it("searches task name and description and binds cursors to the keyword", async () => {
    const family = await createFamily("Task search");
    for (const input of [
      { name: "Buy football boots", description: "Black size 36", dueDate: "2026-08-10" },
      { name: "Wash kit", description: "Football shirt and socks", dueDate: "2026-08-11" },
      { name: "Piano practice", description: "Twenty minutes", dueDate: "2026-08-12" },
    ]) {
      await createTask(family.id, family.admin.token, {
        ...input,
        assigneeIds: [family.admin.id],
      });
    }

    const first = await request(
      `/api/v1/families/${family.id}/tasks?status=pending&assigneeId=me&q=football&limit=1`,
      family.admin.token,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const page = await first.json<any>();
    expect(page.data.items).toHaveLength(1);
    expect(page.data.nextCursor).toBeTypeOf("string");

    const second = await request(
      `/api/v1/families/${family.id}/tasks?status=pending&assigneeId=me&q=football&limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`,
      family.admin.token,
    );
    expect((await second.json<any>()).data.items).toHaveLength(1);

    const wrongKeyword = await request(
      `/api/v1/families/${family.id}/tasks?status=pending&assigneeId=me&q=piano&limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`,
      family.admin.token,
    );
    expect(wrongKeyword.status).toBe(400);
  });

  it("rejects blank and overlong search terms", async () => {
    const family = await createFamily("Search validation");
    const eventBase = `/api/v1/families/${family.id}/events?startDate=2026-08-10&endDateExclusive=2026-08-11`;

    expect((await request(`${eventBase}&q=%20%20`, family.admin.token)).status).toBe(400);
    expect((await request(
      `/api/v1/families/${family.id}/tasks?q=${"a".repeat(101)}`,
      family.admin.token,
    )).status).toBe(400);
  });
});
