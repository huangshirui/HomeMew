import { describe, expect, it } from "vitest";
import { addDateDays, familyToday } from "../src/day-calculation";
import { createId } from "../src/ids";
import { bindings, createFamily, createUser, request } from "./helpers";

async function createDayRecord(familyId: string, token: string, input: Record<string, unknown>) {
  return request(`/api/v1/families/${familyId}/day-records`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

const today = () => familyToday("Asia/Shanghai");

describe("family day record API", () => {
  it("creates all three discriminated kinds with defaults and initial history", async () => {
    const family = await createFamily("Day kinds");
    const current = today();

    const elapsedResponse = await createDayRecord(family.id, family.admin.token, {
      name: "上次理发", kind: "elapsed", anchorDate: current, subjectUserId: family.admin.id,
    });
    expect(elapsedResponse.status, await elapsedResponse.clone().text()).toBe(201);
    const elapsed = (await elapsedResponse.json<any>()).data;
    expect(elapsed).toMatchObject({
      id: expect.stringMatching(/^day_/), familyId: family.id, kind: "elapsed",
      anchorDate: current, attentionAfterDays: null, status: "active", version: 1,
      subject: { userId: family.admin.id },
      computed: { today: current, elapsedDays: 0, remainingDays: null, state: "normal" },
      createdBy: { type: "user", id: family.admin.id },
    });
    expect(elapsed).not.toHaveProperty("attentionBeforeDays");

    const countdown = (await (await createDayRecord(family.id, family.admin.token, {
      name: "旅行", kind: "countdown", anchorDate: current,
    })).json<any>()).data;
    expect(countdown).toMatchObject({ kind: "countdown", attentionBeforeDays: 30, computed: { state: "today", remainingDays: 0 } });
    expect(countdown).not.toHaveProperty("cycleDays");

    const cycleAnchor = addDateDays(current, -10);
    const cycle = (await (await createDayRecord(family.id, family.admin.token, {
      name: "换滤芯", kind: "cycle", anchorDate: cycleAnchor, cycleDays: 10,
    })).json<any>()).data;
    expect(cycle).toMatchObject({
      kind: "cycle", attentionBeforeDays: 7, nextDueDate: current,
      computed: { elapsedDays: 10, remainingDays: 0, progressRatio: 1, state: "due", attentionLevel: "critical" },
    });

    const history = await request(`/api/v1/families/${family.id}/day-records/${elapsed.id}/occurrences`, family.admin.token);
    expect(history.status, await history.clone().text()).toBe(200);
    expect((await history.json<any>()).data).toMatchObject({
      items: [{ id: expect.stringMatching(/^dyo_/), occurredOn: current, source: "initial", intervalDays: null }],
      nextCursor: null,
    });
  });

  it("validates kind rules, dates, unsupported fields, and active subjects", async () => {
    const family = await createFamily("Day validation");
    const outsider = await createUser("Day outsider");
    const current = today();

    const invalidKind = await createDayRecord(family.id, family.admin.token, { name: "Bad", kind: "other", anchorDate: current });
    expect((await invalidKind.json<any>()).error.code).toBe("INVALID_DAY_RECORD_KIND");
    const mixed = await createDayRecord(family.id, family.admin.token, { name: "Bad", kind: "elapsed", anchorDate: current, cycleDays: 10 });
    expect((await mixed.json<any>()).error.code).toBe("INVALID_DAY_RECORD_RULE");
    const futureElapsed = await createDayRecord(family.id, family.admin.token, { name: "Bad", kind: "elapsed", anchorDate: addDateDays(current, 1) });
    expect((await futureElapsed.json<any>()).error.code).toBe("INVALID_DAY_RECORD_DATE");
    const foreignSubject = await createDayRecord(family.id, family.admin.token, { name: "Bad", kind: "countdown", anchorDate: current, subjectUserId: outsider.id });
    expect((await foreignSubject.json<any>()).error.code).toBe("SUBJECT_NOT_FAMILY_MEMBER");
    expect((await createDayRecord(family.id, outsider.token, { name: "No", kind: "countdown", anchorDate: current })).status).toBe(403);
  });

  it("records forward occurrences atomically and returns interval history", async () => {
    const family = await createFamily("Day occurrences");
    const current = today();
    const anchor = addDateDays(current, -3);
    const record = (await (await createDayRecord(family.id, family.admin.token, {
      name: "洗车", kind: "cycle", anchorDate: anchor, cycleDays: 30,
    })).json<any>()).data;

    const response = await request(`/api/v1/families/${family.id}/day-records/${record.id}/occurrences`, family.admin.token, {
      method: "POST",
      body: JSON.stringify({ occurredOn: current, note: "手洗", version: record.version }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const added = (await response.json<any>()).data;
    expect(added).toMatchObject({ previousAnchorDate: anchor, intervalDays: 3, record: { anchorDate: current, version: 2 } });
    expect(added.record.nextDueDate).toBe(addDateDays(current, 30));

    const history = (await (await request(`/api/v1/families/${family.id}/day-records/${record.id}/occurrences?limit=10`, family.admin.token)).json<any>()).data;
    expect(history.items.map((item: any) => ({ date: item.occurredOn, source: item.source, interval: item.intervalDays }))).toEqual([
      { date: current, source: "manual", interval: 3 },
      { date: anchor, source: "initial", interval: null },
    ]);

    const duplicate = await request(`/api/v1/families/${family.id}/day-records/${record.id}/occurrences`, family.admin.token, {
      method: "POST", body: JSON.stringify({ occurredOn: current, version: 2 }),
    });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json<any>()).error.code).toBe("DUPLICATE_DAY_OCCURRENCE");

    const future = await request(`/api/v1/families/${family.id}/day-records/${record.id}/occurrences`, family.admin.token, {
      method: "POST", body: JSON.stringify({ occurredOn: addDateDays(current, 1), version: 2 }),
    });
    expect((await future.json<any>()).error.code).toBe("INVALID_DAY_RECORD_DATE");

    const staleRecord = (await (await createDayRecord(family.id, family.admin.token, {
      name: "Stale occurrence", kind: "elapsed", anchorDate: addDateDays(current, -5),
    })).json<any>()).data;
    const stale = await request(`/api/v1/families/${family.id}/day-records/${staleRecord.id}/occurrences`, family.admin.token, {
      method: "POST", body: JSON.stringify({ occurredOn: addDateDays(current, -1), version: 99 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json<any>()).error.code).toBe("DAY_RECORD_VERSION_CONFLICT");
  });

  it("enforces versions and an archived read-only lifecycle", async () => {
    const family = await createFamily("Day lifecycle");
    const current = today();
    const record = (await (await createDayRecord(family.id, family.admin.token, {
      name: "纪念日", kind: "countdown", anchorDate: current, attentionBeforeDays: null,
    })).json<any>()).data;

    const stale = await request(`/api/v1/families/${family.id}/day-records/${record.id}`, family.admin.token, {
      method: "PATCH", body: JSON.stringify({ name: "Stale", version: 99 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json<any>()).error.code).toBe("DAY_RECORD_VERSION_CONFLICT");

    const invalidArchive = await request(`/api/v1/families/${family.id}/day-records/${record.id}/archive`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 1, status: "archived" }),
    });
    expect(invalidArchive.status).toBe(400);

    const archived = await request(`/api/v1/families/${family.id}/day-records/${record.id}/archive`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 1 }),
    });
    expect((await archived.json<any>()).data).toMatchObject({ status: "archived", version: 2 });
    const editArchived = await request(`/api/v1/families/${family.id}/day-records/${record.id}`, family.admin.token, {
      method: "PATCH", body: JSON.stringify({ name: "No", version: 2 }),
    });
    expect((await editArchived.json<any>()).error.code).toBe("DAY_RECORD_ARCHIVED");

    const restored = await request(`/api/v1/families/${family.id}/day-records/${record.id}/restore`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 2 }),
    });
    expect((await restored.json<any>()).data).toMatchObject({ status: "active", version: 3 });
    const updated = await request(`/api/v1/families/${family.id}/day-records/${record.id}`, family.admin.token, {
      method: "PATCH", body: JSON.stringify({ anchorDate: addDateDays(current, 1), attentionBeforeDays: 0, version: 3 }),
    });
    expect((await updated.json<any>()).data).toMatchObject({ anchorDate: addDateDays(current, 1), attentionBeforeDays: 0, version: 4 });
    const deleted = await request(`/api/v1/families/${family.id}/day-records/${record.id}?version=4`, family.admin.token, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await request(`/api/v1/families/${family.id}/day-records/${record.id}`, family.admin.token)).status).toBe(404);
  });

  it("rejects occurrences for countdown and archived records", async () => {
    const family = await createFamily("Occurrence states");
    const current = today();
    const countdown = (await (await createDayRecord(family.id, family.admin.token, {
      name: "Countdown", kind: "countdown", anchorDate: current,
    })).json<any>()).data;
    const notAllowed = await request(`/api/v1/families/${family.id}/day-records/${countdown.id}/occurrences`, family.admin.token, {
      method: "POST", body: JSON.stringify({ occurredOn: current, version: 1 }),
    });
    expect((await notAllowed.json<any>()).error.code).toBe("OCCURRENCE_NOT_ALLOWED");

    const elapsed = (await (await createDayRecord(family.id, family.admin.token, {
      name: "Archived", kind: "elapsed", anchorDate: addDateDays(current, -1),
    })).json<any>()).data;
    await request(`/api/v1/families/${family.id}/day-records/${elapsed.id}/archive`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 1 }),
    });
    const archived = await request(`/api/v1/families/${family.id}/day-records/${elapsed.id}/occurrences`, family.admin.token, {
      method: "POST", body: JSON.stringify({ occurredOn: current, version: 2 }),
    });
    expect((await archived.json<any>()).error.code).toBe("DAY_RECORD_ARCHIVED");
  });

  it("sorts attention, filters subjects, paginates, and binds cursors", async () => {
    const family = await createFamily("Day lists");
    const current = today();
    const inputs = [
      { name: "Critical", kind: "countdown", anchorDate: addDateDays(current, -1), subjectUserId: family.admin.id },
      { name: "Warning", kind: "cycle", anchorDate: addDateDays(current, -9), cycleDays: 10, attentionBeforeDays: 2 },
      { name: "Info", kind: "countdown", anchorDate: addDateDays(current, 5), attentionBeforeDays: 7 },
      { name: "None", kind: "elapsed", anchorDate: current },
    ];
    for (const input of inputs) await createDayRecord(family.id, family.admin.token, input);

    const query = "status=active&attentionOnly=true&sort=attention&limit=2";
    const first = await request(`/api/v1/families/${family.id}/day-records?${query}`, family.admin.token);
    expect(first.status, await first.clone().text()).toBe(200);
    const firstPage = (await first.json<any>()).data;
    expect(firstPage.items.map((item: any) => item.name)).toEqual(["Critical", "Warning"]);
    expect(firstPage.nextCursor).toBeTypeOf("string");
    const second = await request(`/api/v1/families/${family.id}/day-records?${query}&cursor=${encodeURIComponent(firstPage.nextCursor)}`, family.admin.token);
    expect((await second.json<any>()).data.items.map((item: any) => item.name)).toEqual(["Info"]);

    const mismatched = await request(`/api/v1/families/${family.id}/day-records?kind=countdown&status=active&attentionOnly=true&sort=attention&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`, family.admin.token);
    expect(mismatched.status).toBe(400);

    const mine = await request(`/api/v1/families/${family.id}/day-records?subjectUserId=me&sort=created_desc`, family.admin.token);
    expect((await mine.json<any>()).data.items.map((item: any) => item.name)).toEqual(["Critical"]);
  });

  it("isolates day records between families", async () => {
    const first = await createFamily("Day family one");
    const second = await createFamily("Day family two");
    const record = (await (await createDayRecord(first.id, first.admin.token, {
      name: "Private", kind: "countdown", anchorDate: today(),
    })).json<any>()).data;
    expect((await request(`/api/v1/families/${second.id}/day-records/${record.id}`, second.admin.token)).status).toBe(404);
    expect((await request(`/api/v1/families/${first.id}/day-records`, second.admin.token)).status).toBe(403);
  });

  it("preserves a subject reference after that member is removed", async () => {
    const family = await createFamily("Historical subject");
    const viewer = await createUser("Day viewer");
    const subject = await createUser("Former subject");
    for (const user of [viewer, subject]) {
      await bindings.DB.prepare("INSERT INTO family_members(id,family_id,user_id,role) VALUES(?,?,?,'member')")
        .bind(createId("fmem"), family.id, user.id).run();
    }
    const record = (await (await createDayRecord(family.id, family.admin.token, {
      name: "Former member record", kind: "elapsed", anchorDate: today(), subjectUserId: subject.id,
    })).json<any>()).data;
    await bindings.DB.prepare("UPDATE family_members SET status='removed',removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE family_id=? AND user_id=?")
      .bind(family.id, subject.id).run();

    const response = await request(`/api/v1/families/${family.id}/day-records/${record.id}`, viewer.token);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json<any>()).data.subject).toMatchObject({ userId: subject.id, displayName: "Former subject" });
  });
});
