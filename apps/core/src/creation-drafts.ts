import type { Context, Hono } from "hono";
import { CREATION_KINDS, CreationDraftInvalidResponseError, normalizeCreationDraftOutput, type ActiveMemberRef, type CreationKind } from "./creation-draft-model";
import { familyToday } from "./day-calculation";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireActiveUser, requireFamilyMember } from "./family-access";
import { success } from "./http";
import { createOpenAICompatibleProvider, OpenAICompatibleProviderError, type CreationProviderResult } from "./openai-compatible-provider";
import { requireObject, timezone } from "./validation";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;

export type CreationProvider = ReturnType<typeof createOpenAICompatibleProvider>;

export type CreationDraftDependencies = {
  now: () => Date;
  createCreationProvider: (env: Bindings) => CreationProvider;
};

export function defaultCreationProvider(env: Bindings): CreationProvider {
  return createOpenAICompatibleProvider({
    baseUrl: env.AI_BASE_URL ?? "",
    apiKey: env.AI_API_KEY ?? "",
    model: env.AI_MODEL ?? "",
    promptAppendix: env.AI_PROMPT_APPENDIX,
  });
}

async function body(context: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    return requireObject(await context.req.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

function parseInput(input: Record<string, unknown>): { text: string; viewingTimezone: string; targetKind?: CreationKind } {
  if (Object.keys(input).some((field) => !["text", "viewingTimezone", "targetKind"].includes(field))) {
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
  if (input.targetKind !== undefined && !CREATION_KINDS.includes(input.targetKind as CreationKind)) {
    throw new ApiError("INVALID_REQUEST", "targetKind is invalid", 400);
  }
  return {
    text: input.text.trim(),
    viewingTimezone,
    ...(input.targetKind === undefined ? {} : { targetKind: input.targetKind as CreationKind }),
  };
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
    members: rows.results.map((member, index) => ({
      ref: `m${index + 1}`, userId: member.user_id, name: member.display_name,
    })),
  };
}

function providerApiError(error: unknown): ApiError {
  if (error instanceof OpenAICompatibleProviderError) {
    if (error.code === "AI_NOT_CONFIGURED") return new ApiError("AI_NOT_CONFIGURED", "AI creation is not configured", 503);
    if (error.code === "AI_TIMEOUT") return new ApiError("AI_PROVIDER_TIMEOUT", "AI provider timed out", 504);
    if (error.code === "AI_RATE_LIMITED" || error.status === 429) return new ApiError("AI_RATE_LIMITED", "AI creation rate limit reached", 429);
    if (error.code === "AI_INVALID_RESPONSE") return new ApiError("AI_INVALID_RESPONSE", "AI provider returned an invalid response", 502);
  }
  return new ApiError("AI_PROVIDER_UNAVAILABLE", "AI provider is unavailable", 502);
}

export function registerCreationDraftRoutes(app: App, dependencies: CreationDraftDependencies): void {
  app.post("/api/v1/families/:familyId/creation-drafts/interpret", async (context) => {
    const principal = context.get("currentPrincipal");
    if (principal.type !== "user") throw new ApiError("FORBIDDEN", "Only family members can interpret creation drafts", 403);
    await requireActiveUser(context.env, principal.id);
    const familyId = context.req.param("familyId");
    await requireFamilyMember(context.env, familyId, principal.id);

    const input = parseInput(await body(context));
    const family = await familyContext(context.env, familyId);
    const rateLimit = await context.env.AI_RATE_LIMITER.limit({ key: principal.id });
    if (!rateLimit.success) throw new ApiError("AI_RATE_LIMITED", "AI creation rate limit reached", 429);

    const startedAt = dependencies.now();
    let providerResult: CreationProviderResult | undefined;
    let resolvedStatus: "ready" | "choose_kind" | undefined;
    let resolvedKind: CreationKind | undefined;
    let upstreamStatus: number | undefined;
    let errorCategory: string | null = null;
    try {
      const provider = dependencies.createCreationProvider(context.env);
      providerResult = await provider.generate({
        text: input.text,
        currentInstant: startedAt.toISOString(),
        familyTimezone: family.familyTimezone,
        viewingTimezone: input.viewingTimezone,
        supportedKinds: CREATION_KINDS,
        members: family.members.map(({ ref, name }) => ({ ref, name })),
        ...(input.targetKind ? { targetKind: input.targetKind } : {}),
      });
      let normalized;
      try {
        normalized = normalizeCreationDraftOutput(providerResult.output, {
          members: family.members,
          familyToday: familyToday(family.familyTimezone, startedAt),
          supportedKinds: CREATION_KINDS,
          ...(input.targetKind ? { targetKind: input.targetKind } : {}),
        });
      } catch (error) {
        if (error instanceof CreationDraftInvalidResponseError) {
          throw new ApiError("AI_INVALID_RESPONSE", "AI provider returned an invalid response", 502);
        }
        throw new ApiError("AI_INVALID_RESPONSE", "AI provider returned an invalid response", 502);
      }
      resolvedStatus = normalized.status;
      resolvedKind = normalized.status === "ready" ? normalized.kind : undefined;
      return context.json(success(normalized));
    } catch (error) {
      const apiError = error instanceof ApiError ? error : providerApiError(error);
      if (error instanceof OpenAICompatibleProviderError) upstreamStatus = error.status;
      errorCategory = apiError.code;
      throw apiError;
    } finally {
      const usage = providerResult?.metadata.usage;
      console.info("AI creation draft call", {
        requestId: context.get("requestId"),
        status: resolvedStatus,
        kind: resolvedKind,
        durationMs: Math.max(0, dependencies.now().getTime() - startedAt.getTime()),
        upstreamStatus: providerResult?.metadata.providerStatus ?? upstreamStatus,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        errorCategory,
      });
    }
  });
}
