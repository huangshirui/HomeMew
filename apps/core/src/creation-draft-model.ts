export const CREATION_KINDS = ["event", "task", "day_record", "wish"] as const;
export type CreationKind = (typeof CREATION_KINDS)[number];
export type DraftWarningCode =
  | "AMBIGUOUS_MEMBER"
  | "UNRESOLVED_MEMBER"
  | "INVALID_INFERRED_VALUE"
  | "UNSUPPORTED_DETAIL";

export interface DraftWarning {
  code: DraftWarningCode;
  field: string | null;
  message: string;
}

export interface EventFormDraft {
  summary: string | null;
  description: string | null;
  isAllDay: boolean | null;
  startDate: string | null;
  endDate: string | null;
  endDateExclusive: string | null;
  startTime: string | null;
  endTime: string | null;
  startTimezone: string | null;
  endTimezone: string | null;
  location: string | null;
  attendeeIds: string[];
}

export interface TaskFormDraft {
  name: string | null;
  description: string | null;
  dueDate: string | null;
  assigneeIds: string[];
}

export interface DayRecordFormDraft {
  dayRecordKind: "elapsed" | "countdown" | "cycle" | null;
  name: string | null;
  description: string | null;
  anchorDate: string | null;
  subjectUserId: string | null;
  icon: string | null;
  attentionAfterDays: number | null;
  attentionBeforeDays: number | null;
  cycleDays: number | null;
}

export interface WishFormDraft {
  title: string | null;
  description: string | null;
  desiredDate: string | null;
}

type ReadyDraft =
  | { status: "ready"; kind: "event"; draft: EventFormDraft; missingFields: string[]; warnings: DraftWarning[] }
  | { status: "ready"; kind: "task"; draft: TaskFormDraft; missingFields: string[]; warnings: DraftWarning[] }
  | { status: "ready"; kind: "day_record"; draft: DayRecordFormDraft; missingFields: string[]; warnings: DraftWarning[] }
  | { status: "ready"; kind: "wish"; draft: WishFormDraft; missingFields: string[]; warnings: DraftWarning[] };

export type NormalizedCreationDraft = ReadyDraft | {
  status: "choose_kind";
  candidateKinds: CreationKind[];
};

export interface ActiveMemberRef {
  ref: string;
  userId: string;
  name: string;
}

export class CreationDraftInvalidResponseError extends Error {
  readonly code = "AI_INVALID_RESPONSE";

  constructor(message = "The AI response does not match the creation draft schema") {
    super(message);
    this.name = "CreationDraftInvalidResponseError";
  }
}

const nullableString = { type: ["string", "null"] } as const;
const nullableStringWithMax = (maxLength: number) => ({ type: ["string", "null"], maxLength } as const);
const nullableInteger = { type: ["integer", "null"] } as const;
const closedObject = (required: readonly string[], properties: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, required, properties,
});
const warningSchema = closedObject(["code", "field", "message"], {
  code: { type: "string", enum: ["AMBIGUOUS_MEMBER", "UNRESOLVED_MEMBER", "INVALID_INFERRED_VALUE", "UNSUPPORTED_DETAIL"] },
  field: { type: ["string", "null"] }, message: { type: "string", minLength: 1, maxLength: 500 },
});
const commonReady = {
  status: { const: "ready" },
  missingFields: { type: "array", maxItems: 32, items: { type: "string" } },
  warnings: { type: "array", maxItems: 32, items: warningSchema },
};
const readySchema = (kind: CreationKind, draft: unknown) => closedObject(
  ["status", "kind", "draft", "missingFields", "warnings"],
  { ...commonReady, kind: { const: kind }, draft },
);

export const CREATION_DRAFT_JSON_SCHEMA = {
  name: "homemew_creation_draft",
  strict: true,
  schema: closedObject(["result"], {
    result: { anyOf: [
      closedObject(["status", "candidateKinds"], {
        status: { const: "choose_kind" },
        candidateKinds: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", enum: CREATION_KINDS } },
      }),
      readySchema("event", closedObject([
        "summary", "description", "isAllDay", "startDate", "endDate", "endDateExclusive",
        "startTime", "endTime", "startTimezone", "endTimezone", "location", "attendeeRefs",
      ], {
        summary: nullableStringWithMax(100), description: nullableStringWithMax(5000), isAllDay: { type: ["boolean", "null"] },
        startDate: nullableString, endDate: nullableString, endDateExclusive: nullableString,
        startTime: nullableString, endTime: nullableString, startTimezone: nullableString,
        endTimezone: nullableString, location: nullableStringWithMax(500),
        attendeeRefs: { type: "array", maxItems: 8, items: { type: "string" } },
      })),
      readySchema("task", closedObject(["name", "description", "dueDate", "assigneeRefs"], {
        name: nullableStringWithMax(100), description: nullableStringWithMax(5000), dueDate: nullableString,
        assigneeRefs: { type: "array", maxItems: 8, items: { type: "string" } },
      })),
      readySchema("day_record", closedObject([
        "dayRecordKind", "name", "description", "anchorDate", "subjectMemberRef", "icon",
        "attentionAfterDays", "attentionBeforeDays", "cycleDays",
      ], {
        dayRecordKind: { type: ["string", "null"], enum: ["elapsed", "countdown", "cycle", null] },
        name: nullableStringWithMax(100), description: nullableStringWithMax(5000), anchorDate: nullableString,
        subjectMemberRef: nullableString, icon: nullableStringWithMax(50),
        attentionAfterDays: nullableInteger, attentionBeforeDays: nullableInteger, cycleDays: nullableInteger,
      })),
      readySchema("wish", closedObject(["title", "description", "desiredDate"], {
        title: nullableStringWithMax(100), description: nullableStringWithMax(5000), desiredDate: nullableString,
      })),
    ] },
  }),
} as const;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, allowed: readonly string[]): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CreationDraftInvalidResponseError();
  const result = value as UnknownRecord;
  if (Object.keys(result).some((key) => !allowed.includes(key))) throw new CreationDraftInvalidResponseError();
  return result;
}

function requiredKeys(value: UnknownRecord, keys: readonly string[]): void {
  if (keys.some((key) => !(key in value))) throw new CreationDraftInvalidResponseError();
}

function stringOrNull(value: unknown): string | null {
  if (value === null || typeof value === "string") return value;
  throw new CreationDraftInvalidResponseError();
}

function integerOrNull(value: unknown): number | null {
  if (value === null || (typeof value === "number" && Number.isInteger(value))) return value;
  throw new CreationDraftInvalidResponseError();
}

function stringArray(value: unknown, maxItems = 32): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) throw new CreationDraftInvalidResponseError();
  return [...new Set(value)];
}

function parseCommon(value: UnknownRecord): { missingFields: string[]; warnings: DraftWarning[] } {
  const missingFields = stringArray(value.missingFields);
  if (!Array.isArray(value.warnings) || value.warnings.length > 32) throw new CreationDraftInvalidResponseError();
  const warnings = value.warnings.map((item): DraftWarning => {
    const warning = record(item, ["code", "field", "message"]);
    requiredKeys(warning, ["code", "field", "message"]);
    if (!["AMBIGUOUS_MEMBER", "UNRESOLVED_MEMBER", "INVALID_INFERRED_VALUE", "UNSUPPORTED_DETAIL"].includes(String(warning.code)) || (warning.field !== null && typeof warning.field !== "string")) {
      throw new CreationDraftInvalidResponseError();
    }
    if (typeof warning.message !== "string" || !warning.message.length || warning.message.length > 500) throw new CreationDraftInvalidResponseError();
    return { code: warning.code as DraftWarningCode, field: warning.field as string | null, message: warning.message };
  });
  return { missingFields, warnings };
}

const DERIVED_WARNING_MESSAGES: Record<DraftWarningCode, string> = {
  AMBIGUOUS_MEMBER: "The referenced member is ambiguous.",
  UNRESOLVED_MEMBER: "The referenced member could not be resolved.",
  INVALID_INFERRED_VALUE: "Invalid inferred value was discarded.",
  UNSUPPORTED_DETAIL: "Unsupported field was discarded.",
};

function derivedWarning(code: DraftWarningCode, field: string | null): DraftWarning {
  return { code, field, message: DERIVED_WARNING_MESSAGES[code] };
}

function cappedCommon(common: { missingFields: string[]; warnings: DraftWarning[] }) {
  return {
    missingFields: common.missingFields.slice(-32),
    warnings: common.warnings.slice(-32),
  };
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

function zonedLocalEpoch(date: string, time: string, timeZone: string): number | null {
  const target = Date.parse(`${date}T${time}:00.000Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const representedAt = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  };
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = target + hours * 60 * 60 * 1000;
    offsets.add(representedAt(sample) - sample);
  }
  const candidates = [...offsets]
    .map((offset) => target - offset)
    .filter((instant) => representedAt(instant) === target);
  const uniqueCandidates = [...new Set(candidates)];
  return uniqueCandidates.length === 1 ? uniqueCandidates[0]! : null;
}

function clearInvalid(
  draft: Record<string, unknown>, field: string, validator: (value: string) => boolean,
  missingFields: string[], warnings: DraftWarning[], required = false,
): void {
  const value = draft[field];
  if (typeof value === "string" && !validator(value)) {
    draft[field] = null;
    warnings.push(derivedWarning("INVALID_INFERRED_VALUE", field));
    if (required && !missingFields.includes(field)) missingFields.push(field);
  }
}

function clearOverLimit(
  draft: Record<string, unknown>, field: string, maxLength: number,
  missingFields: string[], warnings: DraftWarning[], required = false,
): void {
  clearInvalid(draft, field, (value) => value.length <= maxLength, missingFields, warnings, required);
}

function resolveMembers(
  refs: string[], field: string, members: ActiveMemberRef[], missingFields: string[], warnings: DraftWarning[],
): string[] {
  const byRef = new Map<string, ActiveMemberRef[]>();
  const nameCounts = new Map<string, number>();
  for (const member of members) byRef.set(member.ref, [...(byRef.get(member.ref) ?? []), member]);
  for (const member of members) nameCounts.set(member.name, (nameCounts.get(member.name) ?? 0) + 1);
  const resolved: string[] = [];
  for (const ref of refs) {
    const matches = byRef.get(ref) ?? [];
    if (matches.length === 1 && nameCounts.get(matches[0]!.name) === 1) resolved.push(matches[0]!.userId);
    else warnings.push(derivedWarning(matches.length ? "AMBIGUOUS_MEMBER" : "UNRESOLVED_MEMBER", field));
  }
  if (warnings.some((warning) => warning.field === field) && !missingFields.includes(field)) missingFields.push(field);
  return [...new Set(resolved)];
}

export function normalizeCreationDraftOutput(
  input: unknown,
  options: { members: ActiveMemberRef[]; familyToday: string; targetKind?: CreationKind; supportedKinds?: readonly CreationKind[] },
): NormalizedCreationDraft {
  if (!validDate(options.familyToday)) throw new Error("familyToday must be YYYY-MM-DD");
  const supportedKinds = new Set(options.supportedKinds ?? CREATION_KINDS);
  const envelope = record(input, ["status", "kind", "draft", "candidateKinds", "missingFields", "warnings"]);
  if (envelope.status === "choose_kind") {
    const choose = record(input, ["status", "candidateKinds"]);
    requiredKeys(choose, ["status", "candidateKinds"]);
    if (!Array.isArray(choose.candidateKinds) || choose.candidateKinds.length < 2 || choose.candidateKinds.length > 4 || options.targetKind) throw new CreationDraftInvalidResponseError();
    if (choose.candidateKinds.some((candidate) => typeof candidate !== "string" || !CREATION_KINDS.includes(candidate as CreationKind) || !supportedKinds.has(candidate as CreationKind))) throw new CreationDraftInvalidResponseError();
    if (new Set(choose.candidateKinds).size !== choose.candidateKinds.length) throw new CreationDraftInvalidResponseError();
    return { status: "choose_kind", candidateKinds: choose.candidateKinds as CreationKind[] };
  }
  if (envelope.status !== "ready") throw new CreationDraftInvalidResponseError();
  requiredKeys(envelope, ["status", "kind", "draft", "missingFields", "warnings"]);
  if ("candidateKinds" in envelope || !CREATION_KINDS.includes(envelope.kind as CreationKind)) throw new CreationDraftInvalidResponseError();
  const kind = envelope.kind as CreationKind;
  if (!supportedKinds.has(kind) || (options.targetKind && options.targetKind !== kind)) throw new CreationDraftInvalidResponseError();
  const common = parseCommon(envelope);

  if (kind === "event") {
    const fields = ["summary", "description", "isAllDay", "startDate", "endDate", "endDateExclusive", "startTime", "endTime", "startTimezone", "endTimezone", "location", "attendeeRefs"];
    const raw = record(envelope.draft, fields); requiredKeys(raw, fields);
    if (raw.isAllDay !== null && typeof raw.isAllDay !== "boolean") throw new CreationDraftInvalidResponseError();
    const draft: Record<string, unknown> = {
      summary: stringOrNull(raw.summary), description: stringOrNull(raw.description), isAllDay: raw.isAllDay,
      startDate: stringOrNull(raw.startDate), endDate: stringOrNull(raw.endDate), endDateExclusive: stringOrNull(raw.endDateExclusive),
      startTime: stringOrNull(raw.startTime), endTime: stringOrNull(raw.endTime), startTimezone: stringOrNull(raw.startTimezone),
      endTimezone: stringOrNull(raw.endTimezone), location: stringOrNull(raw.location), attendeeIds: [],
    };
    const refs = stringArray(raw.attendeeRefs, 8);
    draft.attendeeIds = resolveMembers(refs, "attendeeIds", options.members, common.missingFields, common.warnings);
    clearOverLimit(draft, "summary", 100, common.missingFields, common.warnings, true);
    clearOverLimit(draft, "description", 5000, common.missingFields, common.warnings);
    clearOverLimit(draft, "location", 500, common.missingFields, common.warnings);
    for (const field of ["startDate", "endDate", "endDateExclusive"]) clearInvalid(draft, field, validDate, common.missingFields, common.warnings, field === "startDate");
    for (const field of ["startTime", "endTime"]) clearInvalid(draft, field, validTime, common.missingFields, common.warnings);
    for (const field of ["startTimezone", "endTimezone"]) clearInvalid(draft, field, validTimezone, common.missingFields, common.warnings);
    const clearUnsupportedEventField = (field: string) => {
      if (draft[field] !== null) common.warnings.push(derivedWarning("UNSUPPORTED_DETAIL", field));
      draft[field] = null;
    };
    if (draft.isAllDay === true) {
      for (const field of ["endDate", "startTime", "endTime", "startTimezone", "endTimezone"]) clearUnsupportedEventField(field);
      if (!draft.endDateExclusive || !draft.startDate || draft.endDateExclusive <= draft.startDate) {
        if (draft.endDateExclusive) common.warnings.push(derivedWarning("INVALID_INFERRED_VALUE", "endDateExclusive"));
        draft.endDateExclusive = null;
        if (!common.missingFields.includes("endDateExclusive")) common.missingFields.push("endDateExclusive");
      }
    } else if (draft.isAllDay === false) {
      clearUnsupportedEventField("endDateExclusive");
      for (const field of ["startDate", "endDate", "startTime", "endTime"]) if (!draft[field] && !common.missingFields.includes(field)) common.missingFields.push(field);
      let localStart = draft.startDate && draft.startTime && draft.startTimezone
        ? zonedLocalEpoch(String(draft.startDate), String(draft.startTime), String(draft.startTimezone)) : null;
      let localEnd = draft.endDate && draft.endTime && draft.endTimezone
        ? zonedLocalEpoch(String(draft.endDate), String(draft.endTime), String(draft.endTimezone)) : null;
      if (draft.startDate && draft.startTime && draft.startTimezone && localStart === null) {
        common.warnings.push(derivedWarning("INVALID_INFERRED_VALUE", "startTime"));
        draft.startTime = null;
        if (!common.missingFields.includes("startTime")) common.missingFields.push("startTime");
      }
      if (draft.endDate && draft.endTime && draft.endTimezone && localEnd === null) {
        common.warnings.push(derivedWarning("INVALID_INFERRED_VALUE", "endTime"));
        draft.endTime = null;
        if (!common.missingFields.includes("endTime")) common.missingFields.push("endTime");
      }
      if (!draft.startTime) localStart = null;
      if (!draft.endTime) localEnd = null;
      const invalidOrder = localStart !== null && localEnd !== null
        ? localEnd <= localStart
        : draft.startDate && draft.endDate && draft.startTime && draft.endTime && `${draft.endDate}T${draft.endTime}` <= `${draft.startDate}T${draft.startTime}`;
      if (invalidOrder) {
        common.warnings.push(derivedWarning("INVALID_INFERRED_VALUE", "endTime"));
        draft.endTime = null; if (!common.missingFields.includes("endTime")) common.missingFields.push("endTime");
      }
    } else if (!common.missingFields.includes("isAllDay")) common.missingFields.push("isAllDay");
    if (!draft.summary && !common.missingFields.includes("summary")) common.missingFields.push("summary");
    return { status: "ready", kind, draft: draft as unknown as EventFormDraft, ...cappedCommon(common) };
  }

  if (kind === "task") {
    const fields = ["name", "description", "dueDate", "assigneeRefs"];
    const raw = record(envelope.draft, fields); requiredKeys(raw, fields);
    const draft: TaskFormDraft = {
      name: stringOrNull(raw.name), description: stringOrNull(raw.description), dueDate: stringOrNull(raw.dueDate),
      assigneeIds: resolveMembers(stringArray(raw.assigneeRefs, 8), "assigneeIds", options.members, common.missingFields, common.warnings),
    };
    clearOverLimit(draft as unknown as Record<string, unknown>, "name", 100, common.missingFields, common.warnings, true);
    clearOverLimit(draft as unknown as Record<string, unknown>, "description", 5000, common.missingFields, common.warnings);
    clearInvalid(draft as unknown as Record<string, unknown>, "dueDate", validDate, common.missingFields, common.warnings);
    if (!draft.name && !common.missingFields.includes("name")) common.missingFields.push("name");
    return { status: "ready", kind, draft, ...cappedCommon(common) };
  }

  if (kind === "wish") {
    const fields = ["title", "description", "desiredDate"];
    const raw = record(envelope.draft, fields); requiredKeys(raw, fields);
    const draft: WishFormDraft = { title: stringOrNull(raw.title), description: stringOrNull(raw.description), desiredDate: stringOrNull(raw.desiredDate) };
    clearOverLimit(draft as unknown as Record<string, unknown>, "title", 100, common.missingFields, common.warnings, true);
    clearOverLimit(draft as unknown as Record<string, unknown>, "description", 5000, common.missingFields, common.warnings);
    clearInvalid(draft as unknown as Record<string, unknown>, "desiredDate", validDate, common.missingFields, common.warnings);
    if (!draft.title && !common.missingFields.includes("title")) common.missingFields.push("title");
    return { status: "ready", kind, draft, ...cappedCommon(common) };
  }

  const fields = ["dayRecordKind", "name", "description", "anchorDate", "subjectMemberRef", "icon", "attentionAfterDays", "attentionBeforeDays", "cycleDays"];
  const raw = record(envelope.draft, fields); requiredKeys(raw, fields);
  if (raw.dayRecordKind !== null && !["elapsed", "countdown", "cycle"].includes(String(raw.dayRecordKind))) throw new CreationDraftInvalidResponseError();
  const subjectRef = stringOrNull(raw.subjectMemberRef);
  const subjectIds = subjectRef ? resolveMembers([subjectRef], "subjectUserId", options.members, common.missingFields, common.warnings) : [];
  const draft: DayRecordFormDraft = {
    dayRecordKind: raw.dayRecordKind as DayRecordFormDraft["dayRecordKind"], name: stringOrNull(raw.name),
    description: stringOrNull(raw.description), anchorDate: stringOrNull(raw.anchorDate), subjectUserId: subjectIds[0] ?? null,
    icon: stringOrNull(raw.icon), attentionAfterDays: integerOrNull(raw.attentionAfterDays),
    attentionBeforeDays: integerOrNull(raw.attentionBeforeDays), cycleDays: integerOrNull(raw.cycleDays),
  };
  clearOverLimit(draft as unknown as Record<string, unknown>, "name", 100, common.missingFields, common.warnings, true);
  clearOverLimit(draft as unknown as Record<string, unknown>, "description", 5000, common.missingFields, common.warnings);
  clearOverLimit(draft as unknown as Record<string, unknown>, "icon", 50, common.missingFields, common.warnings);
  clearInvalid(draft as unknown as Record<string, unknown>, "anchorDate", validDate, common.missingFields, common.warnings, true);
  const invalidateNumber = (field: "attentionAfterDays" | "attentionBeforeDays" | "cycleDays", positive: boolean) => {
    const value = draft[field];
    if (value !== null && (value < 0 || value > 3650 || (positive && value < 1))) {
      draft[field] = null; common.warnings.push(derivedWarning("INVALID_INFERRED_VALUE", field));
    }
  };
  invalidateNumber("attentionAfterDays", true); invalidateNumber("attentionBeforeDays", false); invalidateNumber("cycleDays", true);
  if ((draft.dayRecordKind === "elapsed" || draft.dayRecordKind === "cycle") && draft.anchorDate && draft.anchorDate > options.familyToday) {
    common.warnings.push(derivedWarning("INVALID_INFERRED_VALUE", "anchorDate")); draft.anchorDate = null;
  }
  const clearUnsupported = (field: "attentionAfterDays" | "attentionBeforeDays" | "cycleDays") => {
    const value = draft[field];
    if (value !== null) common.warnings.push(derivedWarning("UNSUPPORTED_DETAIL", field));
    draft[field] = null;
  };
  if (draft.dayRecordKind === "elapsed") { clearUnsupported("attentionBeforeDays"); clearUnsupported("cycleDays"); }
  if (draft.dayRecordKind === "countdown") { clearUnsupported("attentionAfterDays"); clearUnsupported("cycleDays"); }
  if (draft.dayRecordKind === "cycle") clearUnsupported("attentionAfterDays");
  for (const field of ["dayRecordKind", "name", "anchorDate"] as const) if (!draft[field] && !common.missingFields.includes(field)) common.missingFields.push(field);
  if (draft.dayRecordKind === "cycle" && draft.cycleDays === null && !common.missingFields.includes("cycleDays")) common.missingFields.push("cycleDays");
  return { status: "ready", kind, draft, ...cappedCommon(common) };
}
