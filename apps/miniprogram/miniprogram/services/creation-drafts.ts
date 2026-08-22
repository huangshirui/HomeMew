/**
 * 喵一下（Creation Drafts）-> LifeSpace Registry Creation Drafts。
 * HomeMew 页面仍使用 kind 术语；平台侧使用 modelKey，在适配层做一一映射。
 */

import { request } from './api';
import { adaptLifeSpaceEventDraft } from './creation-draft-adapter';
import type { CreationKind, CreationDraftResult } from '../types/index';
import type {
  CreateCreationDraftJobRequest,
  CreationDraftJob,
  CreationDraftJobProcessing,
} from '../types/creation-draft-jobs';
import { spacePath } from './lifespace';

const KIND_TO_MODEL: Record<CreationKind, string> = {
  event: 'event',
  task: 'task',
  day_record: 'day_record',
  wish: 'wish',
};

const MODEL_TO_KIND: Record<string, CreationKind> = {
  event: 'event',
  task: 'task',
  day_record: 'day_record',
  wish: 'wish',
};

type LifeSpaceDraft = {
  draftId: string;
  status: 'processing' | 'choose_model' | 'ready' | 'failed';
  expiresAt: string;
  modelContractRevision?: string;
  candidateModels?: string[];
  modelKey?: string;
  kind?: CreationKind;
  draft?: unknown;
  missingFields?: string[];
  warnings?: unknown[];
  error?: { code: string };
};

function toHomeMewDraft(raw: LifeSpaceDraft, viewingTimezone: string): CreationDraftJob {
  if (raw.status === 'processing') {
    return { draftId: raw.draftId, status: 'processing', expiresAt: raw.expiresAt };
  }
  if (raw.status === 'choose_model') {
    return {
      draftId: raw.draftId,
      status: 'choose_kind',
      expiresAt: raw.expiresAt,
      candidateKinds: (raw.candidateModels ?? [])
        .map(model => MODEL_TO_KIND[model])
        .filter((kind): kind is CreationKind => Boolean(kind)),
    };
  }
  if (raw.status === 'failed') {
    return {
      draftId: raw.draftId,
      status: 'failed',
      expiresAt: raw.expiresAt,
      error: raw.error ?? { code: 'AI_PROVIDER_UNAVAILABLE' },
    };
  }

  const kind = raw.kind ?? (raw.modelKey ? MODEL_TO_KIND[raw.modelKey] : undefined);
  if (!kind) throw new Error('LifeSpace 返回了 HomeMew 不支持的模型草稿');
  const draft = kind === 'event'
    ? adaptLifeSpaceEventDraft(raw.draft, viewingTimezone)
    : raw.draft;
  return {
    draftId: raw.draftId,
    expiresAt: raw.expiresAt,
    status: 'ready',
    kind,
    draft,
    missingFields: raw.missingFields ?? [],
    warnings: raw.warnings ?? [],
  } as CreationDraftJob;
}

export async function createCreationDraftJob(
  familyId: string,
  payload: CreateCreationDraftJobRequest,
): Promise<CreationDraftJobProcessing> {
  const raw = await request<LifeSpaceDraft>(spacePath(familyId, 'creation-drafts'), {
    method: 'POST',
    data: payload as unknown as Record<string, unknown>,
    skipRetry: true,
    timeout: 10000,
  });
  return toHomeMewDraft(raw, payload.viewingTimezone) as CreationDraftJobProcessing;
}

export async function getCreationDraftJob(
  familyId: string,
  draftId: string,
  viewingTimezone: string,
): Promise<CreationDraftJob> {
  const raw = await request<LifeSpaceDraft>(
    `${spacePath(familyId, 'creation-drafts')}/${encodeURIComponent(draftId)}`,
    { method: 'GET', timeout: 10000 },
  );
  return toHomeMewDraft(raw, viewingTimezone);
}

export async function chooseCreationDraftKind(
  familyId: string,
  draftId: string,
  targetKind: CreationKind,
  viewingTimezone: string,
): Promise<CreationDraftJobProcessing> {
  const raw = await request<LifeSpaceDraft>(
    `${spacePath(familyId, 'creation-drafts')}/${encodeURIComponent(draftId)}/choose-model`,
    {
      method: 'POST',
      data: { targetModelKey: KIND_TO_MODEL[targetKind] },
      skipRetry: true,
      timeout: 10000,
    },
  );
  return toHomeMewDraft(raw, viewingTimezone) as CreationDraftJobProcessing;
}
