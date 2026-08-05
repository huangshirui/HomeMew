import type { CreationDraftResult, CreationKind } from './index';

export interface CreateCreationDraftJobRequest {
  text: string;
  viewingTimezone: string;
}

export interface ChooseCreationDraftKindRequest {
  targetKind: CreationKind;
}

export interface CreationDraftJobProcessing {
  draftId: string;
  status: 'processing';
  expiresAt: string;
}

export interface CreationDraftJobChooseKind {
  draftId: string;
  status: 'choose_kind';
  expiresAt: string;
  candidateKinds: CreationKind[];
}

export type CreationDraftJobReady = Extract<CreationDraftResult, { status: 'ready' }> & {
  draftId: string;
  expiresAt: string;
};

export interface CreationDraftJobFailed {
  draftId: string;
  status: 'failed';
  expiresAt: string;
  error: { code: string };
}

export type CreationDraftJob =
  | CreationDraftJobProcessing
  | CreationDraftJobChooseKind
  | CreationDraftJobReady
  | CreationDraftJobFailed;
