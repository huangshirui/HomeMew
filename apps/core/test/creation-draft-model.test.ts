import { describe, expect, it } from "vitest";
import {
  CREATION_DRAFT_JSON_SCHEMA,
  CreationDraftInvalidResponseError,
  normalizeCreationDraftOutput,
} from "../src/creation-draft-model";

const members = [
  { ref: "m1", userId: "usr_alice", name: "Alice" },
  { ref: "m2", userId: "usr_bob", name: "Bob" },
];

const common = { missingFields: [], warnings: [] };

describe("creation draft model normalization", () => {
  it("normalizes each supported ready draft kind", () => {
    expect(normalizeCreationDraftOutput({
      status: "ready", kind: "event", ...common,
      draft: {
        summary: "Dinner", description: null, isAllDay: false,
        startDate: "2026-08-05", endDate: "2026-08-05", endDateExclusive: null,
        startTime: "18:30", endTime: "20:00", startTimezone: "Asia/Shanghai",
        endTimezone: "Asia/Shanghai", location: null, attendeeRefs: ["m1", "m2"],
      },
    }, { members, familyToday: "2026-08-04" })).toEqual({
      status: "ready", kind: "event", ...common,
      draft: {
        summary: "Dinner", description: null, isAllDay: false,
        startDate: "2026-08-05", endDate: "2026-08-05", endDateExclusive: null,
        startTime: "18:30", endTime: "20:00", startTimezone: "Asia/Shanghai",
        endTimezone: "Asia/Shanghai", location: null,
        attendeeIds: ["usr_alice", "usr_bob"],
      },
    });

    expect(normalizeCreationDraftOutput({
      status: "ready", kind: "task", ...common,
      draft: { name: "Buy milk", description: null, dueDate: null, assigneeRefs: [] },
    }, { members, familyToday: "2026-08-04" })).toMatchObject({
      status: "ready", kind: "task",
      draft: { name: "Buy milk", description: null, dueDate: null, assigneeIds: [] },
    });

    expect(normalizeCreationDraftOutput({
      status: "ready", kind: "day_record", ...common,
      draft: {
        dayRecordKind: "cycle", name: "Filter", description: null,
        anchorDate: "2026-08-01", subjectMemberRef: "m1", icon: null,
        attentionAfterDays: null, attentionBeforeDays: 7, cycleDays: 90,
      },
    }, { members, familyToday: "2026-08-04" })).toMatchObject({
      status: "ready", kind: "day_record",
      draft: { dayRecordKind: "cycle", subjectUserId: "usr_alice", cycleDays: 90 },
    });

    expect(normalizeCreationDraftOutput({
      status: "ready", kind: "wish", ...common,
      draft: { title: "See the sea", description: null, desiredDate: "2026-10-01" },
    }, { members, familyToday: "2026-08-04" })).toMatchObject({
      status: "ready", kind: "wish",
      draft: { title: "See the sea", description: null, desiredDate: "2026-10-01" },
    });
  });

  it("preserves nullable scalar fields and never returns null arrays", () => {
    const result = normalizeCreationDraftOutput({
      status: "ready", kind: "task", missingFields: ["name"], warnings: [],
      draft: { name: null, description: null, dueDate: null, assigneeRefs: [] },
    }, { members, familyToday: "2026-08-04" });
    expect(result).toMatchObject({ draft: { name: null, assigneeIds: [] }, missingFields: ["name"] });
  });

  it("accepts choose_kind only with at least two unique supported candidates", () => {
    expect(normalizeCreationDraftOutput({
      status: "choose_kind",
      candidates: [
        { kind: "event", label: "Calendar event" },
        { kind: "task", label: "Task" },
        { kind: "event", label: "Duplicate" },
      ],
      missingFields: ["kind"], warnings: [],
    }, { members, familyToday: "2026-08-04" })).toEqual({
      status: "choose_kind",
      candidates: [
        { kind: "event", label: "Calendar event" },
        { kind: "task", label: "Task" },
      ],
      missingFields: ["kind"], warnings: [],
    });
    expect(() => normalizeCreationDraftOutput({
      status: "choose_kind", candidates: [{ kind: "event", label: "Event" }],
      missingFields: [], warnings: [],
    }, { members, familyToday: "2026-08-04", targetKind: "event" })).toThrow(CreationDraftInvalidResponseError);

    expect(() => normalizeCreationDraftOutput({
      status: "ready", kind: "wish", ...common,
      draft: { title: "No", description: null, desiredDate: null },
    }, { members, familyToday: "2026-08-04", supportedKinds: ["event"] })).toThrow(CreationDraftInvalidResponseError);
  });

  it("maps only unique temporary member refs and warns for duplicate mappings and unknown refs", () => {
    const result = normalizeCreationDraftOutput({
      status: "ready", kind: "task", ...common,
      draft: { name: "Carry boxes", description: null, dueDate: null, assigneeRefs: ["m1", "m1", "m2", "m3"] },
    }, {
      members: [...members, { ref: "m2", userId: "usr_other_bob", name: "Another Bob" }],
      familyToday: "2026-08-04",
    });
    expect(result).toMatchObject({
      draft: { assigneeIds: ["usr_alice"] },
      missingFields: ["assigneeIds"],
      warnings: [
        { code: "AMBIGUOUS_MEMBER", field: "assigneeIds", value: "m2" },
        { code: "UNRESOLVED_MEMBER", field: "assigneeIds", value: "m3" },
      ],
    });
  });

  it("clears invalid event values and mutually exclusive fields", () => {
    const result = normalizeCreationDraftOutput({
      status: "ready", kind: "event", ...common,
      draft: {
        summary: "Trip", description: null, isAllDay: true,
        startDate: "2026-02-30", endDate: "2026-08-05", endDateExclusive: "2026-08-04",
        startTime: "25:00", endTime: "10:00", startTimezone: "Mars/Olympus",
        endTimezone: "Asia/Shanghai", location: null, attendeeRefs: [],
      },
    }, { members, familyToday: "2026-08-04" });
    expect(result).toMatchObject({
      draft: {
        startDate: null, endDate: null, endDateExclusive: null,
        startTime: null, endTime: null, startTimezone: null, endTimezone: null,
      },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      { code: "UNSUPPORTED_DETAIL", field: "endDate", value: "2026-08-05" },
      { code: "UNSUPPORTED_DETAIL", field: "endTime", value: "10:00" },
      { code: "UNSUPPORTED_DETAIL", field: "endTimezone", value: "Asia/Shanghai" },
    ]));
    expect(result.missingFields).toEqual(expect.arrayContaining(["startDate", "endDateExclusive"]));

    const crossZone = normalizeCreationDraftOutput({
      status: "ready", kind: "event", ...common,
      draft: {
        summary: "Flight", description: null, isAllDay: false,
        startDate: "2026-08-05", endDate: "2026-08-05", endDateExclusive: null,
        startTime: "12:00", endTime: "13:00", startTimezone: "America/Los_Angeles",
        endTimezone: "Asia/Shanghai", location: null, attendeeRefs: [],
      },
    }, { members, familyToday: "2026-08-04" });
    expect(crossZone).toMatchObject({ draft: { endTime: null }, missingFields: expect.arrayContaining(["endTime"]) });

    const nonexistentLocalTime = normalizeCreationDraftOutput({
      status: "ready", kind: "event", ...common,
      draft: {
        summary: "Early meeting", description: null, isAllDay: false,
        startDate: "2026-03-08", endDate: "2026-03-08", endDateExclusive: null,
        startTime: "02:30", endTime: "04:00", startTimezone: "America/Los_Angeles",
        endTimezone: "America/Los_Angeles", location: null, attendeeRefs: [],
      },
    }, { members, familyToday: "2026-03-07" });
    expect(nonexistentLocalTime).toMatchObject({
      draft: { startTime: null }, missingFields: expect.arrayContaining(["startTime"]),
      warnings: expect.arrayContaining([{ code: "INVALID_INFERRED_VALUE", field: "startTime", value: "02:30" }]),
    });
  });

  it("enforces day-record kind constraints using familyToday", () => {
    const result = normalizeCreationDraftOutput({
      status: "ready", kind: "day_record", ...common,
      draft: {
        dayRecordKind: "cycle", name: "Water", description: null,
        anchorDate: "2026-08-05", subjectMemberRef: null, icon: null,
        attentionAfterDays: 3, attentionBeforeDays: -1, cycleDays: 0,
      },
    }, { members, familyToday: "2026-08-04" });
    expect(result).toMatchObject({
      draft: {
        anchorDate: null, attentionAfterDays: null,
        attentionBeforeDays: null, cycleDays: null,
      },
      missingFields: expect.arrayContaining(["anchorDate", "cycleDays"]),
    });
    expect(result.warnings).toContainEqual({
      code: "UNSUPPORTED_DETAIL", field: "attentionAfterDays", value: "3",
    });

    const elapsed = normalizeCreationDraftOutput({
      status: "ready", kind: "day_record", ...common,
      draft: {
        dayRecordKind: "elapsed", name: "Exercise", description: null,
        anchorDate: "2026-08-01", subjectMemberRef: null, icon: null,
        attentionAfterDays: 0, attentionBeforeDays: null, cycleDays: null,
      },
    }, { members, familyToday: "2026-08-04" });
    expect(elapsed).toMatchObject({ draft: { attentionAfterDays: null } });
    expect(elapsed.warnings).toContainEqual({
      code: "INVALID_INFERRED_VALUE", field: "attentionAfterDays", value: "0",
    });

    const overLimit = normalizeCreationDraftOutput({
      status: "ready", kind: "day_record", ...common,
      draft: {
        dayRecordKind: "cycle", name: "Filter", description: null,
        anchorDate: "2026-08-01", subjectMemberRef: null, icon: null,
        attentionAfterDays: null, attentionBeforeDays: 3651, cycleDays: 3651,
      },
    }, { members, familyToday: "2026-08-04" });
    expect(overLimit).toMatchObject({
      draft: { attentionBeforeDays: null, cycleDays: null },
      missingFields: expect.arrayContaining(["cycleDays"]),
    });
  });

  it.each([
    { status: "ready", kind: "wish", ...common, draft: { title: "x", description: null, desiredDate: null }, extra: true },
    { status: "ready", kind: "unknown", ...common, draft: {} },
    { status: "ready", kind: "wish", ...common, draft: { title: 42, description: null, desiredDate: null } },
  ])("rejects malformed, extra, unknown, or wrongly typed output", (value) => {
    expect(() => normalizeCreationDraftOutput(value, { members, familyToday: "2026-08-04" }))
      .toThrowError(expect.objectContaining({ code: "AI_INVALID_RESPONSE" }));
  });

  it("exports a closed strict JSON schema without confidence or free-form objects", () => {
    const serialized = JSON.stringify(CREATION_DRAFT_JSON_SCHEMA);
    expect(CREATION_DRAFT_JSON_SCHEMA.strict).toBe(true);
    expect(CREATION_DRAFT_JSON_SCHEMA.schema).toMatchObject({
      type: "object", additionalProperties: false, required: ["result"],
      properties: { result: { anyOf: expect.any(Array) } },
    });
    expect(serialized).not.toContain("confidence");
    expect(serialized).not.toContain('"additionalProperties":true');
    expect(serialized).toContain('"additionalProperties":false');
    expect(serialized).toContain("attendeeRefs");
    expect(serialized).not.toContain("attendeeIds");
  });
});
