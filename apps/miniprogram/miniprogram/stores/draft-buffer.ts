/**
 * 喵一下草稿缓冲区
 *
 * 解析结果（CreationDraftResult）通过模块级单例一次性转交给对应创建页，
 * 避免经 query 字符串传递导致超长、丢失 null/数组字段或编码错误。
 *
 * 生命周期：meow 页在跳转前 setPendingDraft，创建页 onLoad/成员加载完成后
 * consumePendingDraft；离开 meow 页（onUnload）若未消费则 clearPendingDraft。
 */

import { CreationDraftResult, CreationKind } from '../types/index';

type PendingEntry = {
  kind: CreationKind;
  result: CreationDraftResult;
};

let _pending: PendingEntry | null = null;

/** 暂存待交接的草稿（同 kind 覆盖） */
export function setPendingDraft(kind: CreationKind, result: CreationDraftResult): void {
  _pending = { kind, result };
}

/** 取出并清空对应 kind 的草稿；kind 不符或无草稿返回 null */
export function consumePendingDraft(kind: CreationKind): CreationDraftResult | null {
  if (!_pending || _pending.kind !== kind) return null;
  const result = _pending.result;
  _pending = null;
  return result;
}

/** 清空暂存的草稿（离开 meow 页未消费时调用） */
export function clearPendingDraft(): void {
  _pending = null;
}
