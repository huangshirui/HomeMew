import { describe, expect, it } from "vitest";
import { bindings, createFamily, createUser, request } from "./helpers";

async function createEvent(familyId: string, token: string, input: Record<string, unknown>) {
  return request(`/api/v1/families/${familyId}/events`, token, { method: "POST", body: JSON.stringify(input) });
}

describe("family event API", () => {
  it("creates and reads timed and all-day events with attendees", async () => {
    const family = await createFamily("Events");
    const timed = await createEvent(family.id, family.admin.token, {
      summary: " 足球训练 ", description: "带水", start: "2026-07-25T16:00:00+08:00",
      end: "2026-07-25T18:00:00+08:00", isAllDay: false, timezone: "Asia/Shanghai",
      attendeeIds: [family.admin.id], location: "浦东足球公园",
    });
    expect(timed.status).toBe(201);
    const body = await timed.json<any>();
    expect(body.data).toMatchObject({ summary: "足球训练", start: "2026-07-25T16:00:00+08:00", version: 1 });
    expect(body.data.attendees).toHaveLength(1);
    const stored = await bindings.DB.prepare("SELECT start_at, start_date FROM events WHERE id = ?").bind(body.data.id).first<any>();
    expect(stored).toMatchObject({ start_at: "2026-07-25T08:00:00.000Z", start_date: null });

    const allDay = await createEvent(family.id, family.admin.token, {
      summary: "学校暑假", start: "2026-07-25", end: "2026-07-26", isAllDay: true,
      timezone: "Asia/Shanghai", attendeeIds: [],
    });
    expect(allDay.status).toBe(201);
    expect((await allDay.json<any>()).data.start).toBe("2026-07-25");

    const detail = await request(`/api/v1/families/${family.id}/events/${body.data.id}`, family.admin.token);
    expect(detail.status).toBe(200);
    expect((await detail.json<any>()).data.createdBy.userId).toBe(family.admin.id);
  });

  it("validates event times, family membership, and attendees", async () => {
    const family = await createFamily("Validation");
    const outsider = await createUser("Outsider");
    const input = { summary: "Event", start: "2026-07-25T16:00:00+08:00", end: "2026-07-25T18:00:00+08:00", isAllDay: false, timezone: "Asia/Shanghai", attendeeIds: [] };
    expect((await createEvent(family.id, outsider.token, input)).status).toBe(403);
    const badAttendee = await createEvent(family.id, family.admin.token, { ...input, attendeeIds: [outsider.id] });
    expect((await badAttendee.json<any>()).error.code).toBe("ATTENDEE_NOT_FAMILY_MEMBER");
    const duplicate = await createEvent(family.id, family.admin.token, { ...input, attendeeIds: [family.admin.id, family.admin.id] });
    expect((await duplicate.json<any>()).error.code).toBe("DUPLICATE_ATTENDEE");
    expect((await createEvent(family.id, family.admin.token, { ...input, timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await createEvent(family.id, family.admin.token, { ...input, end: input.start })).status).toBe(400);
  });

  it("updates with optimistic locking, replaces attendees, and soft deletes", async () => {
    const family = await createFamily("Mutation");
    const response = await createEvent(family.id, family.admin.token, { summary: "Original", start: "2026-07-25", end: "2026-07-26", isAllDay: true, timezone: "Asia/Shanghai", attendeeIds: [] });
    const event = (await response.json<any>()).data;
    const updated = await request(`/api/v1/families/${family.id}/events/${event.id}`, family.admin.token, { method: "PATCH", body: JSON.stringify({ summary: "Updated", attendeeIds: [family.admin.id], version: 1 }) });
    expect((await updated.json<any>()).data).toMatchObject({ summary: "Updated", version: 2 });
    const conflict = await request(`/api/v1/families/${family.id}/events/${event.id}`, family.admin.token, { method: "PATCH", body: JSON.stringify({ summary: "Stale", version: 1 }) });
    expect((await conflict.json<any>()).error.code).toBe("EVENT_VERSION_CONFLICT");
    const deleted = await request(`/api/v1/families/${family.id}/events/${event.id}?version=2`, family.admin.token, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await request(`/api/v1/families/${family.id}/events/${event.id}`, family.admin.token)).status).toBe(404);
  });

  it("lists overlapping events with attendee me and cursor pagination", async () => {
    const family = await createFamily("Listing");
    for (const [summary, start, end] of [["A", "2026-07-24T23:00:00+08:00", "2026-07-25T01:00:00+08:00"], ["B", "2026-07-25T10:00:00+08:00", "2026-07-25T11:00:00+08:00"]]) {
      await createEvent(family.id, family.admin.token, { summary, start, end, isAllDay: false, timezone: "Asia/Shanghai", attendeeIds: [family.admin.id] });
    }
    const first = await request(`/api/v1/families/${family.id}/events?start=2026-07-25&end=2026-07-26&attendeeId=me&limit=1`, family.admin.token);
    const page1 = await first.json<any>();
    expect(page1.data.items).toHaveLength(1);
    expect(page1.data.nextCursor).toBeTypeOf("string");
    const second = await request(`/api/v1/families/${family.id}/events?start=2026-07-25&end=2026-07-26&attendeeId=me&limit=1&cursor=${encodeURIComponent(page1.data.nextCursor)}`, family.admin.token);
    expect((await second.json<any>()).data.items).toHaveLength(1);
  });
});
