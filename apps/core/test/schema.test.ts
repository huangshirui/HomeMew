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

describe("current schema", () => {
  it("creates resource tables, stores avatar keys, and advances the schema version", async () => {
    const tables = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name IN ('events', 'event_attendees', 'tasks', 'task_assignees') ORDER BY name`,
    ).all<{ name: string }>();
    const version = await env.DB.prepare(
      "SELECT value FROM schema_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>();
    const familyColumns = await env.DB.prepare(
      "PRAGMA table_info('families')",
    ).all<{ name: string }>();

    expect(tables.results.map((row: { name: string }) => row.name)).toEqual([
      "event_attendees", "events", "task_assignees", "tasks",
    ]);
    expect(familyColumns.results.map((column: { name: string }) => column.name)).toContain("avatar_key");
    expect(familyColumns.results.map((column: { name: string }) => column.name)).not.toContain("avatar_url");
    expect(version?.value).toBe("10");
    const wishTables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='wishes'",
    ).all<{ name: string }>();
    expect(wishTables.results.map((row: { name: string }) => row.name)).toEqual(["wishes"]);
    const wishColumns = await env.DB.prepare("PRAGMA table_info('wishes')").all<{ name: string }>();
    expect(wishColumns.results.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining([
      "owner_user_id", "desired_date", "claimant_user_id", "claimed_at", "fulfilled_by_user_id",
      "fulfilled_at", "archived_from_status", "created_by_type", "updated_by_type", "version", "deleted_at",
    ]));
    const dayTables = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
       AND name IN ('day_records','day_record_occurrences') ORDER BY name`,
    ).all<{ name: string }>();
    expect(dayTables.results.map((row: { name: string }) => row.name)).toEqual([
      "day_record_occurrences", "day_records",
    ]);
    const dayColumns = await env.DB.prepare("PRAGMA table_info('day_records')").all<{ name: string }>();
    expect(dayColumns.results.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining([
      "anchor_date", "cycle_days", "next_due_date", "subject_user_id", "mutation_token",
      "created_by_type", "created_by_id", "updated_by_type", "updated_by_id",
    ]));
    const integrationTables = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
       AND name IN ('system_identities','family_system_access','system_credentials','oauth_rate_limits')
       ORDER BY name`,
    ).all<{ name: string }>();
    expect(integrationTables.results.map((row: { name: string }) => row.name)).toEqual([
      "family_system_access", "oauth_rate_limits", "system_credentials", "system_identities",
    ]);
    const eventColumns = await env.DB.prepare("PRAGMA table_info('events')").all<{ name: string }>();
    const taskColumns = await env.DB.prepare("PRAGMA table_info('tasks')").all<{ name: string }>();
    const eventColumnNames = eventColumns.results.map((column: { name: string }) => column.name);
    expect(eventColumnNames).toEqual(expect.arrayContaining(["start_timezone", "end_timezone"]));
    expect(eventColumnNames).not.toContain("timezone");
    expect(eventColumns.results.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining(["created_by_type", "created_by_id", "updated_by_type", "updated_by_id", "deleted_by_type", "deleted_by_id"]));
    expect(taskColumns.results.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining(["completed_by_type", "completed_by_id"]));
    expect(eventColumns.results.map((column: { name: string }) => column.name)).not.toEqual(expect.arrayContaining(["created_by", "updated_by", "deleted_by"]));
    expect(taskColumns.results.map((column: { name: string }) => column.name)).not.toEqual(expect.arrayContaining(["created_by", "updated_by", "deleted_by", "completed_by"]));
  });

  it("stores database-generated text timestamps as canonical UTC", async () => {
    const adminId = createId("usr");
    await env.DB.prepare(
      "INSERT INTO users (id, display_name, created_from) VALUES (?, ?, ?)",
    ).bind(adminId, "UTC user", "admin").run();
    const row = await env.DB.prepare(
      "SELECT created_at, updated_at FROM users WHERE id=?",
    ).bind(adminId).first<{ created_at: string; updated_at: string }>();
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row?.updated_at).toMatch(/Z$/);
  });

  it("supports event and task identifiers", () => {
    expect(createId("evt")).toMatch(/^evt_/);
    expect(createId("tsk")).toMatch(/^tsk_/);
    expect(createId("sys")).toMatch(/^sys_/);
    expect(createId("crd")).toMatch(/^crd_/);
    expect(createId("day")).toMatch(/^day_/);
    expect(createId("dyo")).toMatch(/^dyo_/);
    expect(createId("wsh")).toMatch(/^wsh_/);
  });
});
