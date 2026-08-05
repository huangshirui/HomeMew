/**
 * 喵一下（Creation Drafts）异步任务 API。
 *
 * 创建和选择类型接口只负责排队，通常会在几百毫秒内返回；
 * 页面随后轮询 GET 状态，避免微信小程序的长请求超时。
 */

import { request } from './api';
import type { CreationKind } from '../types/index';
import type {
  CreateCreationDraftJobRequest,
  CreationDraftJob,
  CreationDraftJobProcessing,
} from '../types/creation-draft-jobs';

export function createCreationDraftJob(
  familyId: string,
  payload: CreateCreationDraftJobRequest,
): Promise<CreationDraftJobProcessing> {
  return request<CreationDraftJobProcessing>(
    `/api/v1/families/${familyId}/creation-drafts`,
    {
      method: 'POST',
      data: payload as unknown as Record<string, unknown>,
      skipRetry: true,
      timeout: 10000,
    },
  );
}

export function getCreationDraftJob(
  familyId: string,
  draftId: string,
): Promise<CreationDraftJob> {
  return request<CreationDraftJob>(
    `/api/v1/families/${familyId}/creation-drafts/${draftId}`,
    { method: 'GET', timeout: 10000 },
  );
}

export function chooseCreationDraftKind(
  familyId: string,
  draftId: string,
  targetKind: CreationKind,
): Promise<CreationDraftJobProcessing> {
  return request<CreationDraftJobProcessing>(
    `/api/v1/families/${familyId}/creation-drafts/${draftId}/choose-kind`,
    {
      method: 'POST',
      data: { targetKind },
      skipRetry: true,
      timeout: 10000,
    },
  );
}
