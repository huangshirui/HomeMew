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
const INVALID_MESSAGE = "Invalid inferred value was discarded.";
const UNSUPPORTED_MESSAGE = "Unsupported field was discarded.";
const AMBIGUOUS_MESSAGE = "The referenced member is ambiguous.";
const UNRESOLVED_MESSAGE = "The referenced member could not be resolved.";

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

  it("keeps exact string-limit boundaries for all draft kinds", () => {
    const event = normalizeCreationDraftOutput({ status: "ready", kind: "event", ...common, draft: {
      summary: "s".repeat(100), description: "d".repeat(5000), isAllDay: true,
      startDate: "2026-08-05", endDate: null, endDateExclusive: "2026-08-06",
      startTime: null, endTime: null, startTimezone: null, endTimezone: null,
      location: "l".repeat(500), attendeeRefs: [],
    } }, { members, familyToday: "2026-08-04" });
    expect(event).toMatchObject({ draft: {
      summary: "s".repeat(100), description: "d".repeat(5000), location: "l".repeat(500),
    } });

    const task = normalizeCreationDraftOutput({ status: "ready", kind: "task", ...common,
      draft: { name: "n".repeat(100), description: "d".repeat(5000), dueDate: null, assigneeRefs: [] },
    }, { members, familyToday: "2026-08-04" });
    expect(task).toMatchObject({ draft: { name: "n".repeat(100), description: "d".repeat(5000) } });

    const dayRecord = normalizeCreationDraftOutput({ status: "ready", kind: "day_record", ...common, draft: {
      dayRecordKind: "elapsed", name: "n".repeat(100), description: "d".repeat(5000),
      anchorDate: "2026-08-01", subjectMemberRef: null, icon: "i".repeat(50),
      attentionAfterDays: null, attentionBeforeDays: null, cycleDays: null,
    } }, { members, familyToday: "2026-08-04" });
    expect(dayRecord).toMatchObject({ draft: {
      name: "n".repeat(100), description: "d".repeat(5000), icon: "i".repeat(50),
    } });

    const wish = normalizeCreationDraftOutput({ status: "ready", kind: "wish", ...common,
      draft: { title: "t".repeat(100), description: "d".repeat(5000), desiredDate: null },
    }, { members, familyToday: "2026-08-04" });
    expect(wish).toMatchObject({ draft: { title: "t".repeat(100), description: "d".repeat(5000) } });
  });

  it("clears every over-limit inferred string with warnings and required missing fields", () => {
    const event = normalizeCreationDraftOutput({ status: "ready", kind: "event", ...common, draft: {
      summary: "s".repeat(101), description: "d".repeat(5001), isAllDay: true,
      startDate: "2026-08-05", endDate: null, endDateExclusive: "2026-08-06",
      startTime: null, endTime: null, startTimezone: null, endTimezone: null,
      location: "l".repeat(501), attendeeRefs: [],
    } }, { members, familyToday: "2026-08-04" });
    expect(event).toMatchObject({
      draft: { summary: null, description: null, location: null },
      missingFields: expect.arrayContaining(["summary"]),
      warnings: expect.arrayContaining([
        { code: "INVALID_INFERRED_VALUE", field: "summary", message: INVALID_MESSAGE },
        { code: "INVALID_INFERRED_VALUE", field: "description", message: INVALID_MESSAGE },
        { code: "INVALID_INFERRED_VALUE", field: "location", message: INVALID_MESSAGE },
      ]),
    });

    const task = normalizeCreationDraftOutput({ status: "ready", kind: "task", ...common,
      draft: { name: "n".repeat(101), description: "d".repeat(5001), dueDate: null, assigneeRefs: [] },
    }, { members, familyToday: "2026-08-04" });
    expect(task).toMatchObject({
      draft: { name: null, description: null }, missingFields: expect.arrayContaining(["name"]),
      warnings: expect.arrayContaining([
        { code: "INVALID_INFERRED_VALUE", field: "name", message: INVALID_MESSAGE },
        { code: "INVALID_INFERRED_VALUE", field: "description", message: INVALID_MESSAGE },
      ]),
    });

    const dayRecord = normalizeCreationDraftOutput({ status: "ready", kind: "day_record", ...common, draft: {
      dayRecordKind: "elapsed", name: "n".repeat(101), description: "d".repeat(5001),
      anchorDate: "2026-08-01", subjectMemberRef: null, icon: "i".repeat(51),
      attentionAfterDays: null, attentionBeforeDays: null, cycleDays: null,
    } }, { members, familyToday: "2026-08-04" });
    expect(dayRecord).toMatchObject({
      draft: { name: null, description: null, icon: null }, missingFields: expect.arrayContaining(["name"]),
      warnings: expect.arrayContaining([
        { code: "INVALID_INFERRED_VALUE", field: "name", message: INVALID_MESSAGE },
        { code: "INVALID_INFERRED_VALUE", field: "description", message: INVALID_MESSAGE },
        { code: "INVALID_INFERRED_VALUE", field: "icon", message: INVALID_MESSAGE },
      ]),
    });

    const wish = normalizeCreationDraftOutput({ status: "ready", kind: "wish", ...common,
      draft: { title: "t".repeat(101), description: "d".repeat(5001), desiredDate: null },
    }, { members, familyToday: "2026-08-04" });
    expect(wish).toMatchObject({
      draft: { title: null, description: null }, missingFields: expect.arrayContaining(["title"]),
      warnings: expect.arrayContaining([
        { code: "INVALID_INFERRED_VALUE", field: "title", message: INVALID_MESSAGE },
        { code: "INVALID_INFERRED_VALUE", field: "description", message: INVALID_MESSAGE },
      ]),
    });
  });

  it("emits the exact choose_kind shape with two to four unique supported kinds", () => {
    expect(normalizeCreationDraftOutput({
      status: "choose_kind",
      candidateKinds: ["event", "task"],
    }, { members, familyToday: "2026-08-04" })).toEqual({
      status: "choose_kind",
      candidateKinds: ["event", "task"],
    });
    for (const candidateKinds of [
      ["event"], ["event", "event"], ["event", "note"],
    ]) expect(() => normalizeCreationDraftOutput({ status: "choose_kind", candidateKinds }, {
      members, familyToday: "2026-08-04",
    })).toThrow(CreationDraftInvalidResponseError);
    expect(() => normalizeCreationDraftOutput({ status: "choose_kind", candidateKinds: ["event", "task"] }, {
      members, familyToday: "2026-08-04", targetKind: "event",
    })).toThrow(CreationDraftInvalidResponseError);

    expect(() => normalizeCreationDraftOutput({
      status: "choose_kind",
      candidates: [{ kind: "event", label: "Event" }, { kind: "task", label: "Task" }],
      missingFields: ["kind"], warnings: [],
    }, { members, familyToday: "2026-08-04" })).toThrow(CreationDraftInvalidResponseError);

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
        { code: "AMBIGUOUS_MEMBER", field: "assigneeIds", message: AMBIGUOUS_MESSAGE },
        { code: "UNRESOLVED_MEMBER", field: "assigneeIds", message: UNRESOLVED_MESSAGE },
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
    if (result.status !== "ready") throw new Error("expected ready event draft");
    expect(result).toMatchObject({
      draft: {
        startDate: null, endDate: null, endDateExclusive: null,
        startTime: null, endTime: null, startTimezone: null, endTimezone: null,
      },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      { code: "UNSUPPORTED_DETAIL", field: "endDate", message: UNSUPPORTED_MESSAGE },
      { code: "UNSUPPORTED_DETAIL", field: "endTime", message: UNSUPPORTED_MESSAGE },
      { code: "UNSUPPORTED_DETAIL", field: "endTimezone", message: UNSUPPORTED_MESSAGE },
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
      warnings: expect.arrayContaining([{ code: "INVALID_INFERRED_VALUE", field: "startTime", message: INVALID_MESSAGE }]),
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
    if (result.status !== "ready") throw new Error("expected ready day-record draft");
    expect(result).toMatchObject({
      draft: {
        anchorDate: null, attentionAfterDays: null,
        attentionBeforeDays: null, cycleDays: null,
      },
      missingFields: expect.arrayContaining(["anchorDate", "cycleDays"]),
    });
    expect(result.warnings).toContainEqual({
      code: "UNSUPPORTED_DETAIL", field: "attentionAfterDays", message: UNSUPPORTED_MESSAGE,
    });

    const elapsed = normalizeCreationDraftOutput({
      status: "ready", kind: "day_record", ...common,
      draft: {
        dayRecordKind: "elapsed", name: "Exercise", description: null,
        anchorDate: "2026-08-01", subjectMemberRef: null, icon: null,
        attentionAfterDays: 0, attentionBeforeDays: null, cycleDays: null,
      },
    }, { members, familyToday: "2026-08-04" });
    if (elapsed.status !== "ready") throw new Error("expected ready day-record draft");
    expect(elapsed).toMatchObject({ draft: { attentionAfterDays: null } });
    expect(elapsed.warnings).toContainEqual({
      code: "INVALID_INFERRED_VALUE", field: "attentionAfterDays", message: INVALID_MESSAGE,
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

  it("requires the exact model warning shape and accepts a nullable field", () => {
    expect(() => normalizeCreationDraftOutput({
      status: "ready", kind: "wish", missingFields: [],
      warnings: [{ code: "UNSUPPORTED_DETAIL", field: "description", value: null }],
      draft: { title: "Wish", description: null, desiredDate: null },
    }, { members, familyToday: "2026-08-04" })).toThrow(CreationDraftInvalidResponseError);

    expect(normalizeCreationDraftOutput({
      status: "ready", kind: "wish", missingFields: [],
      warnings: [{ code: "UNSUPPORTED_DETAIL", field: null, message: "A safe global warning." }],
      draft: { title: "Wish", description: null, desiredDate: null },
    }, { members, familyToday: "2026-08-04" })).toMatchObject({
      warnings: [{ code: "UNSUPPORTED_DETAIL", field: null, message: "A safe global warning." }],
    });
    for (const message of ["", "m".repeat(501)]) expect(() => normalizeCreationDraftOutput({
      status: "ready", kind: "wish", missingFields: [],
      warnings: [{ code: "UNSUPPORTED_DETAIL", field: null, message }],
      draft: { title: "Wish", description: null, desiredDate: null },
    }, { members, familyToday: "2026-08-04" })).toThrow(CreationDraftInvalidResponseError);
  });

  it("keeps normalized warning and missing-field arrays capped while retaining derived validation", () => {
    const result = normalizeCreationDraftOutput({
      status: "ready", kind: "event",
      missingFields: Array.from({ length: 32 }, (_, index) => `modelField${index}`),
      warnings: Array.from({ length: 32 }, (_, index) => ({
        code: "UNSUPPORTED_DETAIL", field: `modelField${index}`, message: "Model warning.",
      })),
      draft: {
        summary: "s".repeat(101), description: null, isAllDay: true,
        startDate: "2026-08-05", endDate: null, endDateExclusive: "2026-08-06",
        startTime: null, endTime: null, startTimezone: null, endTimezone: null,
        location: null, attendeeRefs: [],
      },
    }, { members, familyToday: "2026-08-04" });
    if (result.status !== "ready") throw new Error("expected ready event draft");
    expect(result.missingFields).toHaveLength(32);
    expect(result.missingFields).toContain("summary");
    expect(result.warnings).toHaveLength(32);
    expect(result.warnings).toContainEqual({
      code: "INVALID_INFERRED_VALUE", field: "summary", message: INVALID_MESSAGE,
    });
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
    const variants = (CREATION_DRAFT_JSON_SCHEMA.schema.properties.result as { anyOf: Array<any> }).anyOf;
    expect(variants[0]).toMatchObject({
      required: ["status", "candidateKinds"],
      properties: { candidateKinds: { minItems: 2, maxItems: 4 } },
    });
    expect(variants[0].properties.candidateKinds).not.toHaveProperty("uniqueItems");
    expect(Object.keys(variants[0].properties)).toEqual(["status", "candidateKinds"]);
    expect(serialized).not.toContain('"label"');
    expect(variants[1].properties.draft.properties).toMatchObject({
      summary: { maxLength: 100 }, description: { maxLength: 5000 }, location: { maxLength: 500 },
      attendeeRefs: { maxItems: 8 },
    });
    expect(variants[2].properties.draft.properties).toMatchObject({
      name: { maxLength: 100 }, description: { maxLength: 5000 }, assigneeRefs: { maxItems: 8 },
    });
    expect(variants[3].properties.draft.properties).toMatchObject({
      name: { maxLength: 100 }, description: { maxLength: 5000 }, icon: { maxLength: 50 },
    });
    expect(variants[4].properties.draft.properties).toMatchObject({
      title: { maxLength: 100 }, description: { maxLength: 5000 },
    });
    for (const variant of variants) {
      if (variant.properties.missingFields) expect(variant.properties.missingFields.maxItems).toBe(32);
      if (variant.properties.warnings) {
        expect(variant.properties.warnings.maxItems).toBe(32);
        expect(variant.properties.warnings.items).toMatchObject({
          required: ["code", "field", "message"],
          properties: { field: { type: ["string", "null"] }, message: { minLength: 1, maxLength: 500 } },
        });
        expect(variant.properties.warnings.items.properties).not.toHaveProperty("value");
      }
    }
  });
});
