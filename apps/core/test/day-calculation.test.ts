import { describe, expect, it } from "vitest";
import {
  addDateDays,
  computeDayRecord,
  daysBetween,
  familyToday,
} from "../src/day-calculation";

describe("day record date calculations", () => {
  it("derives today from the family timezone at an instant boundary", () => {
    const instant = new Date("2026-08-01T16:30:00.000Z");
    expect(familyToday("Asia/Shanghai", instant)).toBe("2026-08-02");
    expect(familyToday("America/Los_Angeles", instant)).toBe("2026-08-01");
  });

  it("keeps calendar-day semantics across a daylight-saving transition", () => {
    expect(familyToday("America/Los_Angeles", new Date("2026-03-08T07:30:00.000Z"))).toBe("2026-03-07");
    expect(familyToday("America/Los_Angeles", new Date("2026-03-08T10:30:00.000Z"))).toBe("2026-03-08");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("uses pure calendar arithmetic across leap days", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(addDateDays("2024-02-28", 2)).toBe("2024-03-01");
  });

  it("computes elapsed threshold state and nullable reminders", () => {
    expect(computeDayRecord({ kind: "elapsed", anchorDate: "2026-07-01", attentionAfterDays: 35 }, "2026-08-01")).toEqual({
      today: "2026-08-01", elapsedDays: 31, remainingDays: 4,
      state: "normal", attentionLevel: "none", isAttentionRequired: false,
    });
    expect(computeDayRecord({ kind: "elapsed", anchorDate: "2026-07-01", attentionAfterDays: null }, "2026-08-01").remainingDays).toBeNull();
    expect(computeDayRecord({ kind: "elapsed", anchorDate: "2026-06-01", attentionAfterDays: 35 }, "2026-08-01")).toMatchObject({
      remainingDays: -26, state: "threshold_reached", attentionLevel: "warning", isAttentionRequired: true,
    });
  });

  it("computes countdown attention through future, today, and past states", () => {
    expect(computeDayRecord({ kind: "countdown", anchorDate: "2026-09-15", attentionBeforeDays: 30 }, "2026-08-01")).toMatchObject({ state: "future", remainingDays: 45, attentionLevel: "none" });
    expect(computeDayRecord({ kind: "countdown", anchorDate: "2026-08-15", attentionBeforeDays: 30 }, "2026-08-01")).toMatchObject({ state: "upcoming", remainingDays: 14, attentionLevel: "info" });
    expect(computeDayRecord({ kind: "countdown", anchorDate: "2026-08-01", attentionBeforeDays: null }, "2026-08-01")).toMatchObject({ state: "today", remainingDays: 0, attentionLevel: "warning", isAttentionRequired: true });
    expect(computeDayRecord({ kind: "countdown", anchorDate: "2026-07-30", attentionBeforeDays: null }, "2026-08-01")).toMatchObject({ state: "past", remainingDays: -2, attentionLevel: "critical", isAttentionRequired: true });
  });

  it("computes cycle due state and an unclamped four-decimal ratio", () => {
    expect(computeDayRecord({ kind: "cycle", anchorDate: "2026-05-02", cycleDays: 90, nextDueDate: "2026-07-31", attentionBeforeDays: 7 }, "2026-07-27")).toEqual({
      today: "2026-07-27", elapsedDays: 86, remainingDays: 4, progressRatio: 0.9556,
      state: "upcoming", attentionLevel: "warning", isAttentionRequired: true,
    });
    expect(computeDayRecord({ kind: "cycle", anchorDate: "2026-05-02", cycleDays: 90, nextDueDate: "2026-07-31", attentionBeforeDays: null }, "2026-08-02")).toMatchObject({
      remainingDays: -2, progressRatio: 1.0222, state: "overdue", attentionLevel: "critical", isAttentionRequired: true,
    });
  });
});
