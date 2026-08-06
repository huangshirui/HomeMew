import type { Bindings } from "./env";

export type CreationDraftCleanupResult = {
  deleted: number;
  cutoff: string;
};

/**
 * Physically removes creation-draft jobs after their per-record expiry time.
 *
 * Draft jobs are created with a 24-hour expires_at value. The hourly Cron means
 * an expired row is normally removed within the following hour.
 */
export async function cleanupExpiredCreationDraftJobs(
  env: Pick<Bindings, "DB">,
  now: Date = new Date(),
): Promise<CreationDraftCleanupResult> {
  const cutoff = now.toISOString();
  const result = await env.DB.prepare(
    "DELETE FROM creation_draft_jobs WHERE expires_at <= ?",
  ).bind(cutoff).run();

  return {
    deleted: result.meta.changes ?? 0,
    cutoff,
  };
}
