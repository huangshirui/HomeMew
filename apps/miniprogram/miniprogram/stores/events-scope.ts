/**
 * 日程页「成员日历范围」持久化。
 *
 * 按 (familyId, userId) 维度记住用户上次选择的查看范围：
 * - 'all'：全家日历
 * - 'me'：我的日历
 * - 其他：指定家庭成员的 HomeMew userId
 *
 * 首次使用默认「我的日历」，避免小朋友每次手动切换。
 * 该值只是界面偏好，不是权限凭据；成员是否可查由 Core 校验。
 */

import { STORAGE_KEYS } from '../services/config';

export type EventsScope = 'all' | 'me' | string;

function scopeKey(familyId: string, userId: string): string {
  return `${STORAGE_KEYS.eventsScope}:${familyId}:${userId || 'anon'}`;
}

/** 读取上次选择的范围；无记录时默认 'me' */
export function loadEventsScope(familyId: string, userId: string): EventsScope {
  try {
    const v = wx.getStorageSync(scopeKey(familyId, userId)) as string | undefined;
    return typeof v === 'string' && v ? v : 'me';
  } catch {
    return 'me';
  }
}

/** 保存本次选择的范围 */
export function saveEventsScope(familyId: string, userId: string, scope: EventsScope): void {
  try {
    wx.setStorageSync(scopeKey(familyId, userId), scope);
  } catch {
    // 存储失败不影响功能，下次进入回落默认值
  }
}
