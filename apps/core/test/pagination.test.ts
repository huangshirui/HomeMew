import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parseLimit } from "../src/pagination";
import { exactDate, offsetDateTime, stringIds, timezone } from "../src/validation";

describe("pagination and domain validation", () => {
  it("round trips a cursor and rejects a mismatched context", () => {
    const encoded = encodeCursor({ v: 2, resource: "events", sort: "start_asc", key: "2026-07-25", id: "evt_1" });
    expect(decodeCursor(encoded, "events", "start_asc")).toMatchObject({ id: "evt_1" });
    expect(() => decodeCursor(encoded, "tasks", "due_asc")).toThrowError(/cursor/i);
    expect(() => decodeCursor("broken", "events", "start_asc")).toThrowError(/cursor/i);
  });

  it("validates limits, dates, date-times, timezones, and unique IDs", () => {
    expect(parseLimit(undefined)).toBe(100);
    expect(parseLimit("25")).toBe(25);
    expect(() => parseLimit("101")).toThrow();
    expect(exactDate("2026-07-25", "due")).toBe("2026-07-25");
    expect(() => exactDate("2026-7-25", "due")).toThrow();
    expect(offsetDateTime("2026-07-25T16:00:00+08:00", "start")).toBe("2026-07-25T08:00:00.000Z");
    expect(() => offsetDateTime("2026-07-25T16:00:00", "start")).toThrow();
    expect(timezone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(() => timezone("Mars/Olympus")).toThrow();
    expect(stringIds(["usr_1", "usr_2"], "attendeeIds")).toEqual(["usr_1", "usr_2"]);
    expect(() => stringIds(["usr_1", "usr_1"], "attendeeIds")).toThrow();
  });
});
