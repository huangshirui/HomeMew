import { describe, expect, it } from "vitest";
import { bindings, createFamily, createUser, request } from "./helpers";

async function createEvent(familyId: string, token: string, input: Record<string, unknown>) {
  return request(`/api/v1/families/${familyId}/events`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

const timedInput = {
  summary: "Timed event",
  isAllDay: false,
  startAt: "2026-08-01T01:00:00Z",
  endAt: "2026-08-01T03:00:00.000Z",
  attendeeIds: [] as string[],
};

describe("family event API", () => {
  it("stores and returns canonical UTC while defaulting omitted display zones", async () => {
    const admin = await createUser("Tokyo admin");
    const family = (await (await request("/api/v1/families", admin.token, {
      method: "POST",
      body: JSON.stringify({ name: "Tokyo family", timezone: "Asia/Tokyo" }),
    })).json<any>()).data;

    const response = await createEvent(family.id, admin.token, {
      ...timedInput,
      attendeeIds: [admin.id],
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const event = (await response.json<any>()).data;
    expect(event).toMatchObject({
      isAllDay: false,
      startAt: "2026-08-01T01:00:00.000Z",
      endAt: "2026-08-01T03:00:00.000Z",
      startTimezone: "Asia/Tokyo",
      endTimezone: "Asia/Tokyo",
      version: 1,
    });
    expect(event).not.toHaveProperty("start");
    expect(event).not.toHaveProperty("timezone");
    expect(event.attendees).toHaveLength(1);

    const stored = await bindings.DB.prepare(
      "SELECT start_at, end_at, start_date, start_timezone, end_timezone FROM events WHERE id=?",
    ).bind(event.id).first<any>();
    expect(stored).toMatchObject({
      start_at: "2026-08-01T01:00:00.000Z",
      end_at: "2026-08-01T03:00:00.000Z",
      start_date: null,
      start_timezone: "Asia/Tokyo",
      end_timezone: "Asia/Tokyo",
    });
  });

  it("supports independent nullable display zones and date-only all-day events", async () => {
    const family = await createFamily("Event shapes");
    const timed = await createEvent(family.id, family.admin.token, {
      ...timedInput,
      startTimezone: "Asia/Tokyo",
      endTimezone: null,
    });
    expect((await timed.json<any>()).data).toMatchObject({
      startTimezone: "Asia/Tokyo",
      endTimezone: null,
    });

    const allDay = await createEvent(family.id, family.admin.token, {
      summary: "Europe trip",
      isAllDay: true,
      startDate: "2026-08-01",
      endDateExclusive: "2026-08-13",
      attendeeIds: [],
    });
    expect(allDay.status, await allDay.clone().text()).toBe(201);
    const event = (await allDay.json<any>()).data;
    expect(event).toMatchObject({
      isAllDay: true,
      startDate: "2026-08-01",
      endDateExclusive: "2026-08-13",
    });
    expect(event).not.toHaveProperty("startAt");
    expect(event).not.toHaveProperty("startTimezone");
  });

  it("rejects offsets, mixed shapes, old fields, invalid zones, and invalid ranges", async () => {
    const family = await createFamily("Event validation");
    const offset = await createEvent(family.id, family.admin.token, {
      ...timedInput,
      startAt: "2026-08-01T10:00:00+09:00",
    });
    expect((await offset.json<any>()).error.code).toBe("INVALID_REQUEST");

    for (const input of [
      { ...timedInput, startDate: "2026-08-01" },
      { ...timedInput, start: timedInput.startAt, end: timedInput.endAt },
      { ...timedInput, startTimezone: "Mars/Olympus" },
      { ...timedInput, endAt: timedInput.startAt },
      {
        summary: "All day with zone",
        isAllDay: true,
        startDate: "2026-08-01",
        endDateExclusive: "2026-08-02",
        startTimezone: "Asia/Shanghai",
      },
    ]) {
      expect((await createEvent(family.id, family.admin.token, input)).status).toBe(400);
    }
  });

  it("updates display zones and requires a complete shape when switching type", async () => {
    const family = await createFamily("Event updates");
    const created = (await (await createEvent(family.id, family.admin.token, timedInput)).json<any>()).data;

    const cleared = await request(`/api/v1/families/${family.id}/events/${created.id}`, family.admin.token, {
      method: "PATCH",
      body: JSON.stringify({ startTimezone: null, endTimezone: "Europe/Paris", version: 1 }),
    });
    expect((await cleared.json<any>()).data).toMatchObject({
      startTimezone: null,
      endTimezone: "Europe/Paris",
      version: 2,
    });

    const incompleteSwitch = await request(`/api/v1/families/${family.id}/events/${created.id}`, family.admin.token, {
      method: "PATCH",
      body: JSON.stringify({ isAllDay: true, version: 2 }),
    });
    expect(incompleteSwitch.status).toBe(400);

    const switched = await request(`/api/v1/families/${family.id}/events/${created.id}`, family.admin.token, {
      method: "PATCH",
      body: JSON.stringify({
        isAllDay: true,
        startDate: "2026-08-01",
        endDateExclusive: "2026-08-02",
        version: 2,
      }),
    });
    const event = (await switched.json<any>()).data;
    expect(event).toMatchObject({ isAllDay: true, startDate: "2026-08-01", version: 3 });
    expect(event).not.toHaveProperty("startTimezone");
  });

  it("rejects a PATCH that only supplies the optimistic concurrency version", async () => {
    const family = await createFamily("Event empty patch");
    const created = (await (await createEvent(
      family.id,
      family.admin.token,
      timedInput,
    )).json<any>()).data;

    const response = await request(
      `/api/v1/families/${family.id}/events/${created.id}`,
      family.admin.token,
      {
        method: "PATCH",
        body: JSON.stringify({ version: created.version }),
      },
    );

    expect(response.status).toBe(400);
    expect((await response.json<any>()).error.code).toBe("INVALID_REQUEST");
  });

  it("requires a date window and queries timed events in the requested viewing timezone", async () => {
    const family = await createFamily("Event queries");
    await createEvent(family.id, family.admin.token, {
      ...timedInput,
      summary: "Tokyo early morning",
      startAt: "2026-07-31T15:30:00Z",
      endAt: "2026-07-31T16:00:00Z",
      attendeeIds: [family.admin.id],
    });

    expect((await request(`/api/v1/families/${family.id}/events`, family.admin.token)).status).toBe(400);
    expect((await request(
      `/api/v1/families/${family.id}/events?startDate=2026-08-01`,
      family.admin.token,
    )).status).toBe(400);

    const response = await request(
      `/api/v1/families/${family.id}/events?startDate=2026-08-01&endDateExclusive=2026-08-02&timezone=Asia/Tokyo&attendeeId=me`,
      family.admin.token,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json<any>()).data.items.map((item: any) => item.summary))
      .toContain("Tokyo early morning");
  });

  it("paginates overlapping timed and all-day events with half-open ranges", async () => {
    const family = await createFamily("Event pagination");
    await createEvent(family.id, family.admin.token, {
      ...timedInput,
      summary: "Timed",
      attendeeIds: [family.admin.id],
    });
    await createEvent(family.id, family.admin.token, {
      summary: "All day",
      isAllDay: true,
      startDate: "2026-08-01",
      endDateExclusive: "2026-08-03",
      attendeeIds: [family.admin.id],
    });

    const query = `startDate=2026-08-01&endDateExclusive=2026-08-02&attendeeId=me&limit=1`;
    const first = await request(`/api/v1/families/${family.id}/events?${query}`, family.admin.token);
    const page1 = await first.json<any>();
    expect(page1.data.items).toHaveLength(1);
    expect(page1.data.nextCursor).toBeTypeOf("string");
    const second = await request(
      `/api/v1/families/${family.id}/events?${query}&cursor=${encodeURIComponent(page1.data.nextCursor)}`,
      family.admin.token,
    );
    expect((await second.json<any>()).data.items).toHaveLength(1);
  });

  it("handles DST viewing windows and enforces the 366-day limit", async () => {
    const family = await createFamily("DST queries");
    await createEvent(family.id, family.admin.token, {
      ...timedInput,
      summary: "Before DST jump",
      startAt: "2026-03-08T06:30:00Z",
      endAt: "2026-03-08T07:30:00Z",
    });
    await createEvent(family.id, family.admin.token, {
      ...timedInput,
      summary: "At exclusive end",
      startAt: "2026-03-09T04:00:00Z",
      endAt: "2026-03-09T05:00:00Z",
    });
    const response = await request(
      `/api/v1/families/${family.id}/events?startDate=2026-03-08&endDateExclusive=2026-03-09&timezone=America/New_York`,
      family.admin.token,
    );
    expect((await response.json<any>()).data.items.map((item: any) => item.summary))
      .toEqual(["Before DST jump"]);

    const tooWide = await request(
      `/api/v1/families/${family.id}/events?startDate=2026-01-01&endDateExclusive=2027-01-03`,
      family.admin.token,
    );
    expect(tooWide.status).toBe(400);
  });

  it("keeps family authorization and attendee validation", async () => {
    const family = await createFamily("Event access");
    const outsider = await createUser("Event outsider");
    expect((await createEvent(family.id, outsider.token, timedInput)).status).toBe(403);
    const response = await createEvent(family.id, family.admin.token, {
      ...timedInput,
      attendeeIds: [outsider.id],
    });
    expect((await response.json<any>()).error.code).toBe("ATTENDEE_NOT_FAMILY_MEMBER");
  });
});
