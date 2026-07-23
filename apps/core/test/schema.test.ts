import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createId } from "../src/ids";

describe("user and family schema", () => {
  it("creates the four business tables", async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (?, ?, ?, ?)
       ORDER BY name`,
    )
      .bind("users", "families", "family_members", "family_invites")
      .all<{ name: string }>();

    expect(result.results.map((row: { name: string }) => row.name)).toEqual([
      "families",
      "family_invites",
      "family_members",
      "users",
    ]);
  });

  it("enforces one membership record per family and user", async () => {
    const indexes = await env.DB.prepare(
      "PRAGMA index_list('family_members')",
    ).all<{ name: string; unique: number }>();

    expect(indexes.results.some((index: { unique: number }) => index.unique === 1)).toBe(true);
  });
});

describe("event and task schema", () => {
  it("creates the resource tables and advances the schema version", async () => {
    const tables = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name IN ('events', 'event_attendees', 'tasks', 'task_assignees') ORDER BY name`,
    ).all<{ name: string }>();
    const version = await env.DB.prepare(
      "SELECT value FROM schema_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>();

    expect(tables.results.map((row: { name: string }) => row.name)).toEqual([
      "event_attendees", "events", "task_assignees", "tasks",
    ]);
    expect(version?.value).toBe("5");
  });

  it("supports event and task identifiers", () => {
    expect(createId("evt")).toMatch(/^evt_/);
    expect(createId("tsk")).toMatch(/^tsk_/);
  });
});
