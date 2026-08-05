/**
 * 喵一下（Creation Drafts）相关 API 服务
 *
 * POST /api/v1/families/{familyId}/creation-drafts/interpret
 *
 * 草稿只读、不落库，最终由用户在对应创建页补全后通过既有接口提交。
 * 该接口为写型（会产生 AI 调用副作用），显式 skipRetry: true 避免重复触发。
 */

import { request } from './api';
import {
  CreationDraftResult,
  InterpretCreationDraftRequest,
} from '../types/index';

/**
 * 调用喵一下解析接口。
 *
 * @param familyId 当前家庭 id
 * @param payload 用户输入文本 + 查看时区（+ 可选 targetKind）
 * @returns 解析结果：ready 草稿或 choose_kind 提示
 */
export function interpretCreationDraft(
  familyId: string,
  payload: InterpretCreationDraftRequest,
): Promise<CreationDraftResult> {
  return request<CreationDraftResult>(
    `/api/v1/families/${familyId}/creation-drafts/interpret`,
    {
      method: 'POST',
      data: payload as unknown as Record<string, unknown>,
      skipRetry: true,
      timeout: 30000,
    },
  );
}
