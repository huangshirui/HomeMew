/**
 * 一次性凭证内存缓冲
 *
 * 用于在“详情页创建凭证”与“凭证结果展示页”之间传递完整明文（Client Secret / API Token）。
 *
 * 安全约束（见 SPEC 三、小程序不保存外部系统 Secret）：
 * - 仅存于内存，不写入本地缓存、日志或持久化状态；
 * - 不通过页面 URL 传递，避免被日志记录；
 * - 结果页读取后立即清空（take 语义），离开页面即失效。
 */

import { ClientSecretCreated, ApiTokenCreated } from '../types/index';

export interface CredentialResultPayload {
  kind: 'oauth' | 'api_token';
  /** 外部系统名称，用于展示 */
  systemName: string;
  clientSecret?: ClientSecretCreated;
  apiToken?: ApiTokenCreated;
}

let buffer: CredentialResultPayload | null = null;

/** 写入一次性凭证结果 */
export function setCredentialResult(payload: CredentialResultPayload): void {
  buffer = payload;
}

/** 读取并清空一次性凭证结果（只能被消费一次） */
export function takeCredentialResult(): CredentialResultPayload | null {
  const value = buffer;
  buffer = null;
  return value;
}

/** 主动清空（离开结果页时调用） */
export function clearCredentialResult(): void {
  buffer = null;
}
