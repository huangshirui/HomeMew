/**
 * 待办页「成员负责人范围」持久化。
 *
 * 按 (familyId, userId) 维度记住用户上次选择的查看范围：
 * - 'all'：全家待办
 * - 'me'：我的待办
 * - 其他：指定家庭成员的 HomeMew userId
 *
 * 与日程页的 eventsScope 相互独立：在日程页切换成员不会改变待办页的选择。
 * 首页「待办提醒」读取同一份偏好，实现与待办页联动。
 *
 * 该值只是界面偏好，不是权限凭据；成员是否可查由 Core 校验。
 */

import { STORAGE_KEYS } from '../services/config';

export type TasksScope = 'all' | 'me' | string;

function scopeKey(familyId: string, userId: string): string {
  return `${STORAGE_KEYS.tasksScope}:${familyId}:${userId || 'anon'}`;
}

/** 读取上次选择的范围；无记录时默认 'me' */
export function loadTasksScope(familyId: string, userId: string): TasksScope {
  try {
    const v = wx.getStorageSync(scopeKey(familyId, userId)) as string | undefined;
    return typeof v === 'string' && v ? v : 'me';
  } catch {
    return 'me';
  }
}

/** 保存本次选择的范围 */
export function saveTasksScope(familyId: string, userId: string, scope: TasksScope): void {
  try {
    wx.setStorageSync(scopeKey(familyId, userId), scope);
  } catch {
    // 存储失败不影响功能，下次进入回落默认值
  }
}

/** scope -> 接口 assigneeId 参数（'all' 不传） */
export function assigneeParamOf(scope: TasksScope): string | undefined {
  if (scope === 'all') return undefined;
  if (scope === 'me') return 'me';
  return scope;
}
