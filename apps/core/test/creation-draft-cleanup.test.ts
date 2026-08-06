import { describe, expect, it } from "vitest";
import { cleanupExpiredCreationDraftJobs } from "../src/creation-draft-cleanup";
import { bindings, createFamily } from "./helpers";

describe("creation draft cleanup", () => {
  it("deletes only jobs whose expires_at is at or before the cleanup cutoff", async () => {
    const family = await createFamily("Draft cleanup");
    const cutoff = new Date("2026-08-06T09:00:00.000Z");

    await bindings.DB.batch([
      bindings.DB.prepare(`INSERT INTO creation_draft_jobs
        (id,family_id,requested_by_user_id,status,generation,input_text,viewing_timezone,expires_at)
        VALUES (?,?,?,'queued',1,?,'Asia/Shanghai',?)`)
        .bind("drf_expired", family.id, family.admin.id, "expired", "2026-08-06T08:59:59.999Z"),
      bindings.DB.prepare(`INSERT INTO creation_draft_jobs
        (id,family_id,requested_by_user_id,status,generation,input_text,viewing_timezone,expires_at)
        VALUES (?,?,?,'queued',1,?,'Asia/Shanghai',?)`)
        .bind("drf_boundary", family.id, family.admin.id, "boundary", "2026-08-06T09:00:00.000Z"),
      bindings.DB.prepare(`INSERT INTO creation_draft_jobs
        (id,family_id,requested_by_user_id,status,generation,input_text,viewing_timezone,expires_at)
        VALUES (?,?,?,'queued',1,?,'Asia/Shanghai',?)`)
        .bind("drf_active", family.id, family.admin.id, "active", "2026-08-06T09:00:00.001Z"),
    ]);

    const result = await cleanupExpiredCreationDraftJobs(bindings, cutoff);

    expect(result).toEqual({ deleted: 2, cutoff: cutoff.toISOString() });
    const remaining = await bindings.DB.prepare(
      "SELECT id FROM creation_draft_jobs WHERE family_id=? ORDER BY id",
    ).bind(family.id).all<{ id: string }>();
    expect(remaining.results.map((row) => row.id)).toEqual(["drf_active"]);
  });
});
