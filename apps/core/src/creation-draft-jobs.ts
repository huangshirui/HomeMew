import type { Context, Hono } from "hono";
import { CREATION_KINDS, CreationDraftInvalidResponseError, normalizeCreationDraftOutput, type ActiveMemberRef, type CreationKind } from "./creation-draft-model";
import { familyToday } from "./day-calculation";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireActiveUser, requireFamilyMember } from "./family-access";
import { success } from "./http";
import { createId } from "./ids";
import { OpenAICompatibleProviderError, type CreationProviderResult } from "./openai-compatible-provider";
import type { CreationDraftDependencies, CreationProvider } from "./creation-drafts";
import { requireObject, timezone } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;

export type CreationDraftQueueMessage = {
  draftId: string;
  generation: number;
};

type JobRow = {
  id: string;
  family_id: string;
  requested_by_user_id: string;
  status: "queued" | "processing" | "choose_kind" | "ready" | "failed";
  generation: number;
  input_text: string | null;
  viewing_timezone: string;
  target_kind: CreationKind | null;
  result_json: string | null;
  error_code: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string;
};

const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function publicStatus(status: JobRow["status"]): "processing" | "choose_kind" | "ready" | "failed" {
  return status === "queued" ? "processing" : status;
}

function providerErrorCode(error: unknown): string {
  if (error instanceof OpenAICompatibleProviderError) {
    if (error.code === "AI_NOT_CONFIGURED") return "AI_NOT_CONFIGURED";
    if (error.code === "AI_TIMEOUT") return "AI_PROVIDER_TIMEOUT";
    if (error.code === "AI_RATE_LIMITED") return "AI_RATE_LIMITED";
    if (error.code === "AI_AUTHENTICATION_FAILED") return "AI_AUTHENTICATION_FAILED";
    if (error.code === "AI_QUOTA_EXCEEDED") return "AI_QUOTA_EXCEEDED";
    if (error.code === "AI_ACCESS_DENIED") return "AI_ACCESS_DENIED";
    if (error.code === "AI_MODEL_NOT_FOUND") return "AI_MODEL_NOT_FOUND";
    if (error.code === "AI_REQUEST_REJECTED") return "AI_REQUEST_REJECTED";
    if (error.code === "AI_INVALID_RESPONSE") return "AI_INVALID_RESPONSE";
  }
  if (error instanceof CreationDraftInvalidResponseError) return "AI_INVALID_RESPONSE";
  return "AI_PROVIDER_UNAVAILABLE";
}

async function body(context: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    return requireObject(await context.req.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

function parseCreateInput(input: Record<string, unknown>): { text: string; viewingTimezone: string } {
  if (Object.keys(input).some((field) => !["text", "viewingTimezone"].includes(field))) {
    throw new ApiError("INVALID_REQUEST", "Request contains unsupported creation draft fields", 400);
  }
  if (typeof input.text !== "string" || input.text.trim().length < 1 || input.text.trim().length > 5000) {
    throw new ApiError("INVALID_REQUEST", "text must contain between 1 and 5000 characters", 400);
  }
  let viewingTimezone: string;
  try {
    viewingTimezone = timezone(input.viewingTimezone);
  } catch {
    throw new ApiError("INVALID_REQUEST", "viewingTimezone must be a valid IANA timezone", 400);
  }
  return { text: input.text.trim(), viewingTimezone };
}

function parseKindInput(input: Record<string, unknown>): CreationKind {
  if (Object.keys(input).some((field) => field !== "targetKind")) {
    throw new ApiError("INVALID_REQUEST", "Request contains unsupported creation draft fields", 400);
  }
  if (!CREATION_KINDS.includes(input.targetKind as CreationKind)) {
    throw new ApiError("INVALID_REQUEST", "targetKind is invalid", 400);
  }
  return input.targetKind as CreationKind;
}

async function familyContext(env: Bindings, familyId: string): Promise<{ familyTimezone: string; members: ActiveMemberRef[] }> {
  const family = await env.DB.prepare("SELECT timezone FROM families WHERE id = ? AND status = 'active'")
    .bind(familyId).first<{ timezone: string }>();
  if (!family) throw new ApiError("FAMILY_NOT_FOUND", "Family not found", 404);
  const rows = await env.DB.prepare(`SELECT u.id user_id, u.display_name
    FROM family_members fm JOIN users u ON u.id = fm.user_id AND u.status = 'active'
    WHERE fm.family_id = ? AND fm.status = 'active'
    ORDER BY fm.joined_at ASC, u.id ASC`).bind(familyId).all<{ user_id: string; display_name: string }>();
  return {
    familyTimezone: family.timezone,
    members: rows.results.map((member, index) => ({ ref: `m${index + 1}`, userId: member.user_id, name: member.display_name })),
  };
}

async function ownedJob(env: Bindings, familyId: string, draftId: string, userId: string): Promise<JobRow> {
  const job = await env.DB.prepare(`SELECT * FROM creation_draft_jobs
    WHERE id=? AND family_id=? AND requested_by_user_id=?`).bind(draftId, familyId, userId).first<JobRow>();
  if (!job) throw new ApiError("CREATION_DRAFT_NOT_FOUND", "Creation draft job not found", 404);
  if (Date.parse(job.expires_at) <= Date.now()) throw new ApiError("CREATION_DRAFT_EXPIRED", "Creation draft job expired", 404);
  return job;
}

function serializeJob(job: JobRow): Record<string, unknown> {
  const status = publicStatus(job.status);
  const base = { draftId: job.id, status, expiresAt: job.expires_at };
  if (job.status === "choose_kind" || job.status === "ready") {
    const result = job.result_json ? JSON.parse(job.result_json) as Record<string, unknown> : {};
    return { ...base, ...result };
  }
  if (job.status === "failed") return { ...base, error: { code: job.error_code ?? "AI_PROVIDER_UNAVAILABLE" } };
  return base;
}

async function enqueue(env: Bindings, message: CreationDraftQueueMessage): Promise<void> {
  try {
    await env.CREATION_DRAFT_QUEUE.send(message);
  } catch {
    await env.DB.prepare(`UPDATE creation_draft_jobs SET status='failed', error_code='AI_QUEUE_UNAVAILABLE',
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND generation=?`).bind(message.draftId, message.generation).run();
    throw new ApiError("AI_QUEUE_UNAVAILABLE", "AI creation queue is unavailable", 502);
  }
}

export function registerCreationDraftJobRoutes(app: App): void {
  app.post("/api/v1/families/:familyId/creation-drafts", async (context) => {
    const principal = context.get("currentPrincipal");
    if (principal.type !== "user") throw new ApiError("FORBIDDEN", "Only family members can create draft jobs", 403);
    await requireActiveUser(context.env, principal.id);
    const familyId = context.req.param("familyId");
    await requireFamilyMember(context.env, familyId, principal.id);
    const input = parseCreateInput(await body(context));
    const rateLimit = await context.env.AI_RATE_LIMITER.limit({ key: principal.id });
    if (!rateLimit.success) throw new ApiError("AI_RATE_LIMITED", "AI creation rate limit reached", 429);

    const id = createId("drf");
    const expiresAt = new Date(Date.now() + JOB_TTL_MS).toISOString();
    await context.env.DB.prepare(`INSERT INTO creation_draft_jobs
      (id,family_id,requested_by_user_id,status,generation,input_text,viewing_timezone,expires_at)
      VALUES (?,?,?,'queued',1,?,?,?)`).bind(id, familyId, principal.id, input.text, input.viewingTimezone, expiresAt).run();
    await enqueue(context.env, { draftId: id, generation: 1 });
    return context.json(success({ draftId: id, status: "processing", expiresAt }), 202);
  });

  app.get("/api/v1/families/:familyId/creation-drafts/:draftId", async (context) => {
    const principal = context.get("currentPrincipal");
    if (principal.type !== "user") throw new ApiError("FORBIDDEN", "Only family members can read draft jobs", 403);
    await requireActiveUser(context.env, principal.id);
    const familyId = context.req.param("familyId");
    await requireFamilyMember(context.env, familyId, principal.id);
    const job = await ownedJob(context.env, familyId, context.req.param("draftId"), principal.id);
    return context.json(success(serializeJob(job)));
  });

  app.post("/api/v1/families/:familyId/creation-drafts/:draftId/choose-kind", async (context) => {
    const principal = context.get("currentPrincipal");
    if (principal.type !== "user") throw new ApiError("FORBIDDEN", "Only family members can update draft jobs", 403);
    await requireActiveUser(context.env, principal.id);
    const familyId = context.req.param("familyId");
    await requireFamilyMember(context.env, familyId, principal.id);
    const draftId = context.req.param("draftId");
    const job = await ownedJob(context.env, familyId, draftId, principal.id);
    if (job.status !== "choose_kind") throw new ApiError("CREATION_DRAFT_STATE_CONFLICT", "Creation draft is not awaiting a kind", 409);
    const targetKind = parseKindInput(await body(context));
    const nextGeneration = job.generation + 1;
    const update = await context.env.DB.prepare(`UPDATE creation_draft_jobs SET
      status='queued', generation=?, target_kind=?, result_json=NULL, error_code=NULL,
      started_at=NULL, completed_at=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND generation=? AND status='choose_kind'`).bind(nextGeneration, targetKind, draftId, job.generation).run();
    if (!update.meta.changes) throw new ApiError("CREATION_DRAFT_STATE_CONFLICT", "Creation draft changed", 409);
    await enqueue(context.env, { draftId, generation: nextGeneration });
    return context.json(success({ draftId, status: "processing", expiresAt: job.expires_at }), 202);
  });
}

async function processOne(env: Bindings, dependencies: CreationDraftDependencies, message: CreationDraftQueueMessage): Promise<void> {
  const claim = await env.DB.prepare(`UPDATE creation_draft_jobs SET status='processing',
    attempt_count=attempt_count+1, started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND generation=? AND status='queued' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(message.draftId, message.generation).run();
  if (!claim.meta.changes) return;

  const job = await env.DB.prepare("SELECT * FROM creation_draft_jobs WHERE id=? AND generation=?")
    .bind(message.draftId, message.generation).first<JobRow>();
  if (!job || !job.input_text) return;

  try {
    const startedAt = dependencies.now();
    const family = await familyContext(env, job.family_id);
    const requestingMember = family.members.find((member) => member.userId === job.requested_by_user_id);
    if (!requestingMember) throw new ApiError("FORBIDDEN", "Requesting member is no longer active", 403);
    const provider: CreationProvider = dependencies.createCreationProvider(env);
    const providerResult: CreationProviderResult = await provider.generate({
      text: job.input_text,
      currentInstant: startedAt.toISOString(),
      familyTimezone: family.familyTimezone,
      viewingTimezone: job.viewing_timezone,
      supportedKinds: CREATION_KINDS,
      members: family.members.map(({ ref, name }) => ({ ref, name })),
      requestingMemberRef: requestingMember.ref,
      ...(job.target_kind ? { targetKind: job.target_kind } : {}),
    });
    const normalized = normalizeCreationDraftOutput(providerResult.output, {
      members: family.members,
      familyToday: familyToday(family.familyTimezone, startedAt),
      supportedKinds: CREATION_KINDS,
      ...(job.target_kind ? { targetKind: job.target_kind } : {}),
    });
    const finalStatus = normalized.status === "choose_kind" ? "choose_kind" : "ready";
    await env.DB.prepare(`UPDATE creation_draft_jobs SET status=?, result_json=?, error_code=NULL,
      input_text=CASE WHEN ?='ready' THEN NULL ELSE input_text END,
      completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND generation=? AND status='processing'`)
      .bind(finalStatus, JSON.stringify(normalized), finalStatus, job.id, job.generation).run();
  } catch (error) {
    const code = providerErrorCode(error);
    await env.DB.prepare(`UPDATE creation_draft_jobs SET status='failed', result_json=NULL, error_code=?, input_text=NULL,
      completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND generation=? AND status='processing'`).bind(code, job.id, job.generation).run();
  }
}

export async function processCreationDraftQueue(
  batch: MessageBatch<CreationDraftQueueMessage>,
  env: Bindings,
  dependencies: CreationDraftDependencies,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processOne(env, dependencies, message.body);
      message.ack();
    } catch (error) {
      console.error("Creation draft queue message failed", { draftId: message.body.draftId, generation: message.body.generation, error });
      message.retry();
    }
  }
}
